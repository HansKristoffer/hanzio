import { colorize, createCoolLogger } from '../cool-console-log'
import { DEFAULT_INFISICAL_SITE_URL, loadInfisicalSecrets } from './infisical'
const logger = createCoolLogger()

export type SecretEnvironment = 'dev' | 'staging' | 'prod'
export type SecretEnvironmentOption =
	| SecretEnvironment
	| (() => SecretEnvironment)

export type InfisicalDefineSecretSetOptions = {
	readonly projectId: string
	readonly siteUrl?: string
	readonly environment?: SecretEnvironmentOption
	readonly clientIdEnvKey?: string
	readonly clientSecretEnvKey?: string
	readonly loader?: undefined
}

export type CustomLoaderDefineSecretSetOptions<SecretKey extends string> = {
	readonly loader: SecretSetLoader<SecretKey>
	readonly environment?: SecretEnvironmentOption
}

export type DefineSecretSetOptions<SecretKey extends string> =
	| InfisicalDefineSecretSetOptions
	| CustomLoaderDefineSecretSetOptions<SecretKey>

export type SecretSetLoaderContext<SecretKey extends string> = {
	readonly keys: readonly SecretKey[]
	readonly environment: SecretEnvironment
}

export type SecretSetLoader<SecretKey extends string> = (
	context: SecretSetLoaderContext<SecretKey>
) => Promise<Partial<Record<SecretKey, string>>>

type ResolvedSecretSetOptions<SecretKey extends string> = {
	readonly loader: SecretSetLoader<SecretKey>
	readonly environment: SecretEnvironment
}

export type SecretSet<SecretKey extends string> = {
	secret: (key: SecretKey) => string
	secrets: () => Record<SecretKey, string>
	reload: () => Promise<SecretSet<SecretKey>>
}

export * from './infisical'
export * from './loaders'
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
	const resolvedOptions = resolveSecretSetOptions(options)
	let cachedSecrets: Record<SecretKey, string> | null = null

	const loadSecrets = async (force = false) => {
		const nextSecrets = await loadAndMergeSecrets({
			keySet,
			cachedSecrets,
			force,
			...resolvedOptions
		})
		cachedSecrets = nextSecrets
		return nextSecrets
	}

	const secretSet = createSecretSet({
		getCachedSecrets: () => cachedSecrets,
		reload: loadSecrets
	})

	await loadSecrets()
	return secretSet
}

function resolveSecretSetOptions<SecretKey extends string>(
	options: DefineSecretSetOptions<SecretKey>
): ResolvedSecretSetOptions<SecretKey> {
	const environment = resolveEnvironment(options.environment)
	const loader: SecretSetLoader<SecretKey> = options.loader
		? options.loader
		: (context) =>
				loadInfisicalSecrets({
					...context,
					projectId: options.projectId,
					siteUrl: options.siteUrl ?? DEFAULT_INFISICAL_SITE_URL,
					clientIdEnvKey: options.clientIdEnvKey ?? 'INFISICAL_CLIENT_ID',
					clientSecretEnvKey:
						options.clientSecretEnvKey ?? 'INFISICAL_CLIENT_SECRET'
				})

	return {
		loader,
		environment
	}
}

async function loadAndMergeSecrets<SecretKey extends string>({
	keySet,
	cachedSecrets,
	loader,
	environment,
	force
}: {
	readonly keySet: readonly SecretKey[]
	readonly cachedSecrets: Record<SecretKey, string> | null
	readonly loader: SecretSetLoader<SecretKey>
	readonly environment: SecretEnvironment
	readonly force: boolean
}): Promise<Record<SecretKey, string>> {
	const processEnvSecrets = readProcessEnvSecrets(
		keySet,
		force ? cachedSecrets : null
	)
	const keysMissingFromEnv = keySet.filter((key) => !processEnvSecrets[key])

	logSecretEnvironment(environment, keySet.length)

	const loaderKeys = force ? keySet : keysMissingFromEnv
	const loadedSecrets: Partial<Record<SecretKey, string>> =
		loaderKeys.length === 0
			? {}
			: await loader({
					keys: loaderKeys,
					environment
				})

	const missingKeys = keySet.filter(
		(key) => !(processEnvSecrets[key] ?? loadedSecrets[key])
	)
	if (missingKeys.length > 0) {
		throw new Error(`Missing secrets: ${missingKeys.join(', ')}`)
	}

	const nextSecrets = Object.fromEntries(
		keySet.map((key) => [
			key,
			(processEnvSecrets[key] ?? loadedSecrets[key]) as string
		])
	) as Record<SecretKey, string>

	for (const [key, value] of Object.entries(nextSecrets)) {
		process.env[key] = value as string
	}

	return nextSecrets
}

function createSecretSet<SecretKey extends string>({
	getCachedSecrets,
	reload
}: {
	readonly getCachedSecrets: () => Record<SecretKey, string> | null
	readonly reload: (force?: boolean) => Promise<Record<SecretKey, string>>
}): SecretSet<SecretKey> {
	const secretSet: SecretSet<SecretKey> = {
		secret(key) {
			const value = getCachedSecrets()?.[key] ?? process.env[key]
			if (!value) {
				throw new Error(`Secret ${key} not found`)
			}
			return value
		},
		secrets() {
			const cachedSecrets = getCachedSecrets()
			if (!cachedSecrets) {
				throw new Error('Secrets not initialized.')
			}
			return { ...cachedSecrets }
		},
		async reload() {
			await reload(true)
			return secretSet
		}
	}

	return secretSet
}

function resolveEnvironment(
	environment?: SecretEnvironmentOption
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

function readProcessEnvSecrets<SecretKey extends string>(
	keys: readonly SecretKey[],
	previousSecrets: Record<SecretKey, string> | null = null
): Partial<Record<SecretKey, string>> {
	// On forced reloads, skip cached values so the loader can refresh them.
	return Object.fromEntries(
		keys
			.filter((key) => {
				const value = process.env[key]
				return value && value !== previousSecrets?.[key]
			})
			.map((key) => [key, process.env[key] as string])
	) as Partial<Record<SecretKey, string>>
}
