import type { SecretSetLoader } from './core'

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
	const loader: SecretSetLoader<SecretKey> = async (ctx) => {
		// A null prototype lets secret names safely overlap with object properties.
		const out: Partial<Record<SecretKey, string>> = Object.create(null)

		for (const key of ctx.keys) {
			const str = workerBindingToString(
				Object.hasOwn(workerEnv, key) ? workerEnv[key] : undefined
			)

			if (str !== undefined) {
				out[key] = str
			}
		}

		return out
	}

	return Object.assign(loader, { source: 'Cloudflare Worker bindings' })
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

	// JSON bindings remain strings until the optional schema parses them.
	if (typeof value === 'object') {
		return JSON.stringify(value)
	}

	return String(value)
}
