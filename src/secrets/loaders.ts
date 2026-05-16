import { DEFAULT_INFISICAL_SITE_URL, fetchInfisicalSecrets } from './infisical'
import type { SecretSetLoader, SecretSetLoaderContext } from './index'

/**
 * Reads secrets from a Cloudflare Worker `env` bindings object (or any similar
 * `Record`), for Workers where `process.env` is not populated. Pass the same
 * object you get as `env` in your fetch handler, or values you’d read from
 * `import { env } from "cloudflare:workers"` in your Worker bundle — this
 * package does not import that module.
 */
export function cloudflareWorkerEnvLoader<SecretKey extends string>(
	workerEnv: Record<string, unknown>
): SecretSetLoader<SecretKey> {
	return async (ctx) => {
		const out: Partial<Record<SecretKey, string>> = {}
		for (const key of ctx.keys) {
			const str = workerBindingToString(workerEnv[key])
			if (str !== undefined) {
				out[key] = str
			}
		}
		return out
	}
}

function workerBindingToString(value: unknown): string | undefined {
	if (value === undefined || value === null) {
		return undefined
	}
	if (typeof value === 'string') {
		return value === '' ? undefined : value
	}
	if (
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		typeof value === 'bigint'
	) {
		return String(value)
	}
	if (typeof value === 'object') {
		return JSON.stringify(value)
	}
	return String(value)
}

export function infisicalLoader<SecretKey extends string>(config: {
	readonly projectId: string
	readonly clientId: string
	readonly clientSecret: string
	readonly siteUrl?: string
}): SecretSetLoader<SecretKey> {
	return async (ctx) =>
		fetchInfisicalSecrets({
			keys: ctx.keys,
			projectId: config.projectId,
			environment: ctx.environment,
			siteUrl: config.siteUrl ?? DEFAULT_INFISICAL_SITE_URL,
			clientId: config.clientId,
			clientSecret: config.clientSecret
		})
}

export async function processEnvLoader<SecretKey extends string>(
	_ctx: SecretSetLoaderContext<SecretKey>
): Promise<Partial<Record<SecretKey, string>>> {
	return {}
}
