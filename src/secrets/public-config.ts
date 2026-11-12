import type { SecretSet } from './core'
import { SecretLoadError } from './errors'

/**
 * Read only explicitly listed public values. No process globals, secret loader,
 * environment writes, or async initialization; safe in frontend tooling.
 * Validate application-specific formats with your schema after secrets().
 */
export function readPublicConfig<
	const Keys extends readonly string[],
	const O extends string = never
>(
	keys: Keys,
	values: Readonly<Record<string, string | undefined>>,
	options: { readonly optional?: readonly O[] } = {}
): Pick<
	SecretSet<Keys[number], Record<Keys[number], string>, O>,
	'secret' | 'secrets' | 'optional' | 'sources'
> {
	type K = Keys[number]

	const optionalKeys: readonly string[] = options.optional ?? []
	const both = optionalKeys.filter((key) => keys.includes(key))

	if (both.length) {
		throw new SecretLoadError(
			'CONFIGURATION',
			`Public keys cannot be both required and optional: ${both.join(', ')}`
		)
	}

	// Read each listed key once, so getters cannot change between check and use.
	const snapshot = Object.fromEntries(
		[...keys, ...optionalKeys].flatMap((key) => {
			const value = Object.hasOwn(values, key) ? values[key] : undefined

			return typeof value === 'string' && value ? [[key, value]] : []
		})
	) as Record<string, string>
	const missing = keys.filter((key) => !Object.hasOwn(snapshot, key))

	if (missing.length) {
		throw new SecretLoadError(
			'MISSING_SECRETS',
			`Missing required public configuration: ${missing.join(', ')}`
		)
	}

	const configured = Object.fromEntries(
		keys.map((key) => [key, snapshot[key]])
	) as Record<K, string>

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
		optional(key) {
			if (!optionalKeys.includes(key)) {
				throw new SecretLoadError(
					'CONFIGURATION',
					`Public key ${key} is not declared in optional.`
				)
			}

			return Object.hasOwn(snapshot, key) ? snapshot[key] : undefined
		},
		secrets: () => ({ ...configured }),
		sources: () =>
			Object.fromEntries(
				Object.keys(snapshot).map((key) => [key, 'public config'])
			) as Record<K, string>
	}
}
