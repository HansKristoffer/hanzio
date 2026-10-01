import type { SecretSet } from './core'
import { SecretLoadError } from './errors'

/**
 * Read only explicitly listed public values. No process globals, secret loader,
 * environment writes, or async initialization; safe in frontend tooling.
 * Validate application-specific formats with your schema after secrets().
 */
export function readPublicConfig<const Keys extends readonly string[]>(
	keys: Keys,
	values: Readonly<Record<string, string | undefined>>
): Pick<SecretSet<Keys[number]>, 'secret' | 'secrets'> {
	type K = Keys[number]

	const snapshot = Object.fromEntries(
		keys.map((key) => [
			key,
			Object.hasOwn(values, key) ? values[key] : undefined
		])
	)
	const missing = keys.filter(
		(key) => typeof snapshot[key] !== 'string' || !snapshot[key]
	)

	if (missing.length) {
		throw new SecretLoadError(
			'MISSING_SECRETS',
			`Missing required public configuration: ${missing.join(', ')}`
		)
	}

	const configured = snapshot as Record<K, string>

	return {
		secret(key) {
			if (!Object.hasOwn(configured, key)) {
				throw new SecretLoadError(
					'CONFIGURATION',
					`Public key ${key} is not configured.`
				)
			}

			return configured[key]
		},
		secrets: () => ({ ...configured })
	}
}
