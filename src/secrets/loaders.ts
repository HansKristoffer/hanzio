import { DEFAULT_INFISICAL_SITE_URL, fetchInfisicalSecrets } from './infisical'
import {
	validateInfisicalOrganizationId,
	type InfisicalProjectOptions
} from './infisical-config'
import type { SecretSetLoader, SecretSetLoaderContext } from './core'

export { cloudflareWorkerEnvLoader } from './worker-loader'

export function infisicalLoader<SecretKey extends string>(
	config: InfisicalProjectOptions & {
		readonly clientId: string
		readonly clientSecret: string
		readonly timeoutMs?: number
	}
): SecretSetLoader<SecretKey> {
	validateInfisicalOrganizationId(config.organizationId)

	const loader: SecretSetLoader<SecretKey> = async (ctx) =>
		fetchInfisicalSecrets({
			keys: ctx.keys,
			projectId: config.projectId,
			organizationId: config.organizationId,
			environment: ctx.environment,
			siteUrl: config.siteUrl ?? DEFAULT_INFISICAL_SITE_URL,
			clientId: config.clientId,
			clientSecret: config.clientSecret,
			secretPath: config.secretPath,
			timeoutMs: config.timeoutMs ?? ctx.timeoutMs,
			signal: ctx.signal
		})

	return Object.assign(loader, { source: 'Infisical HTTP' })
}

export async function processEnvLoader<SecretKey extends string>(
	_ctx: SecretSetLoaderContext<SecretKey>
): Promise<Partial<Record<SecretKey, string>>> {
	// The core has already read environment overrides; there is no remote source.
	return {}
}

Object.assign(processEnvLoader, { source: 'process.env' })
