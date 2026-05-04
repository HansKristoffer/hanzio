import { InfisicalSDK } from '@infisical/sdk'
import { networkInterfaces } from 'node:os'
import { colorize, createCoolLogger } from '../cool-console-log'

const DEFAULT_INFISICAL_SITE_URL = 'https://eu.infisical.com'
const LOCAL_IP_VALUE = 'LOCAL_IP'
const VPN_INTERFACE_RE = /^(utun|tun|tailscale|wg|ipsec|ppp)/i
const logger = createCoolLogger()

export type SecretEnvironment = 'dev' | 'staging' | 'prod'

export type DefineSecretSetOptions<SecretKey extends string> = {
	readonly projectId: string
	readonly siteUrl?: string
	readonly environment?: SecretEnvironment | (() => SecretEnvironment)
	readonly clientIdEnvKey?: string
	readonly clientSecretEnvKey?: string
	readonly loader?: SecretSetLoader<SecretKey>
	readonly getLocalIp?: () => string
}

export type SecretSetLoaderContext<SecretKey extends string> = {
	readonly keys: readonly SecretKey[]
	readonly projectId: string
	readonly environment: SecretEnvironment
	readonly siteUrl: string
	readonly clientIdEnvKey: string
	readonly clientSecretEnvKey: string
}

export type SecretSetLoader<SecretKey extends string> = (
	context: SecretSetLoaderContext<SecretKey>
) => Promise<Partial<Record<SecretKey, string>>>

export type SecretSet<SecretKey extends string> = {
	secret: (key: SecretKey) => string
	secrets: () => Record<SecretKey, string>
	reload: () => Promise<SecretSet<SecretKey>>
}

type InfisicalSecret = {
	secretKey: string
	secretValue: string
}

export * from './vite'

export function getSecretEnvironment(): SecretEnvironment {
	const env = process.env.SECRETS_ENV || process.env.NODE_ENV
	if (env === 'production' || env === 'prod') return 'prod'
	if (env === 'staging') return 'staging'
	return 'dev'
}

export async function defineSecretSet<
	const SecretKeys extends readonly string[]
>(
	keys: SecretKeys,
	options: DefineSecretSetOptions<SecretKeys[number]>
): Promise<SecretSet<SecretKeys[number]>> {
	type SecretKey = SecretKeys[number]

	const keySet = [...new Set(keys)] as SecretKey[]
	const loader = options.loader ?? loadInfisicalSecrets
	const getLocalIp = options.getLocalIp ?? getLocalIpAddress
	let cachedSecrets: Record<SecretKey, string> | null = null

	const resolveValue = (value: string) => {
		if (value === LOCAL_IP_VALUE) return getLocalIp()
		return value
	}

	const loadSecrets = async (force = false) => {
		const envSecrets = readEnvSecrets(keySet, force ? cachedSecrets : null)
		const keysMissingFromEnv = keySet.filter((key) => !envSecrets[key])
		const environment = resolveEnvironment(options.environment)

		logSecretEnvironment(environment, keySet.length)

		const loadedSecrets: Partial<Record<SecretKey, string>> =
			keysMissingFromEnv.length === 0 && !force
				? {}
				: await loader({
						keys: keySet,
						projectId: options.projectId,
						environment,
						siteUrl: options.siteUrl ?? DEFAULT_INFISICAL_SITE_URL,
						clientIdEnvKey: options.clientIdEnvKey ?? 'INFISICAL_CLIENT_ID',
						clientSecretEnvKey:
							options.clientSecretEnvKey ?? 'INFISICAL_CLIENT_SECRET'
					})

		const missingKeys = keySet.filter(
			(key) => !(envSecrets[key] ?? loadedSecrets[key])
		)
		if (missingKeys.length > 0) {
			throw new Error(`Missing secrets: ${missingKeys.join(', ')}`)
		}

		const nextSecrets = Object.fromEntries(
			keySet.map((key) => [
				key,
				resolveValue((envSecrets[key] ?? loadedSecrets[key]) as string)
			])
		) as Record<SecretKey, string>

		for (const [key, value] of Object.entries(nextSecrets)) {
			process.env[key] = value as string
		}
		cachedSecrets = nextSecrets
		return nextSecrets
	}

	const secretSet: SecretSet<SecretKey> = {
		secret(key) {
			const value = cachedSecrets?.[key] ?? process.env[key]
			if (!value) {
				throw new Error(`Secret ${key} not found`)
			}
			return resolveValue(value)
		},
		secrets() {
			if (!cachedSecrets) {
				throw new Error('Secrets not initialized.')
			}
			return cachedSecrets
		},
		async reload() {
			await loadSecrets(true)
			return secretSet
		}
	}

	await loadSecrets()
	return secretSet
}

async function loadInfisicalSecrets<SecretKey extends string>({
	keys,
	projectId,
	environment,
	siteUrl,
	clientIdEnvKey,
	clientSecretEnvKey
}: SecretSetLoaderContext<SecretKey>): Promise<
	Partial<Record<SecretKey, string>>
> {
	const clientId = process.env[clientIdEnvKey]
	const clientSecret = process.env[clientSecretEnvKey]

	if (!clientId || !clientSecret) {
		throw new Error('Missing Infisical credentials')
	}

	const client = new InfisicalSDK({ siteUrl })

	await client.auth().universalAuth.login({
		clientId,
		clientSecret
	})

	const { secrets } = (await client.secrets().listSecrets({
		environment,
		projectId
	})) as { secrets: InfisicalSecret[] }

	const wantedKeys = new Set<string>(keys)
	return Object.fromEntries(
		secrets
			.filter((secret) => wantedKeys.has(secret.secretKey))
			.map((secret) => [secret.secretKey, secret.secretValue])
	) as Partial<Record<SecretKey, string>>
}

function resolveEnvironment(
	environment: DefineSecretSetOptions<string>['environment']
): SecretEnvironment {
	if (typeof environment === 'function') return environment()
	return environment ?? getSecretEnvironment()
}

function logSecretEnvironment(
	environment: SecretEnvironment,
	secretCount: number
): void {
	logger.info(colorize('Loading secrets', 'cyan', 'bold'), {
		environment: colorize(environment, 'brightCyan', 'bold'),
		count: secretCount
	})
}

function readEnvSecrets<SecretKey extends string>(
	keys: readonly SecretKey[],
	previousSecrets: Record<SecretKey, string> | null = null
): Partial<Record<SecretKey, string>> {
	return Object.fromEntries(
		keys
			.filter((key) => {
				const value = process.env[key]
				return value && value !== previousSecrets?.[key]
			})
			.map((key) => [key, process.env[key] as string])
	) as Partial<Record<SecretKey, string>>
}

function getLocalIpAddress(): string {
	const interfaces = networkInterfaces()

	for (const name of Object.keys(interfaces)) {
		if (VPN_INTERFACE_RE.test(name)) continue
		const nets = interfaces[name]
		if (!nets) continue

		for (const net of nets) {
			if (net.family === 'IPv4' && !net.internal) {
				return net.address
			}
		}
	}

	return '127.0.0.1'
}
