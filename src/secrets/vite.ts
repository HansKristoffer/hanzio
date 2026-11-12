import type { SecretSet } from './core'
import { SecretLoadError } from './errors'

export type ViteSecretSetPlugin = {
	name: string
	config: () => { define: Record<string, string> }
}

export type ViteSecretSetOptions<K extends string> = {
	/** Explicit acknowledgement that these values may be shipped to browsers. */
	readonly publicKeys?: readonly K[]
}

/** A secret set or `readPublicConfig` result. `sources` lists optional keys that have a value. */
export type ViteSecretSource<K extends string, O extends string = never> = Pick<
	SecretSet<K, unknown, O>,
	'secrets'
> &
	Partial<Pick<SecretSet<K, unknown, O>, 'optional' | 'sources'>>

export function getViteDefine<K extends string, O extends string = never>(
	secretSet: ViteSecretSource<K, O>,
	options: ViteSecretSetOptions<K | O> = {}
): Record<string, string> {
	const values = secretSet.secrets()
	const keys =
		options.publicKeys ??
		(Object.keys(secretSet.sources?.() ?? values) as (K | O)[])

	// An explicit allowlist is required before exposing non-prefixed values.
	if (!options.publicKeys && keys.some((key) => !key.startsWith('VITE_'))) {
		throw new SecretLoadError(
			'CONFIGURATION',
			'Vite secret sets must contain only VITE_ keys, or provide an explicit publicKeys list.'
		)
	}

	const unknownKey = () =>
		new SecretLoadError(
			'CONFIGURATION',
			'Vite publicKeys must reference configured keys with valid JavaScript identifiers.'
		)
	const define: Record<string, string> = {}

	for (const key of keys) {
		if (!/^[A-Za-z_$][\w$]*$/.test(key)) {
			throw unknownKey()
		}

		if (['MODE', 'BASE_URL', 'PROD', 'DEV', 'SSR'].includes(key)) {
			throw new SecretLoadError(
				'CONFIGURATION',
				'Vite built-in environment constants cannot be overridden by secrets.'
			)
		}

		let value: string | undefined

		if (Object.hasOwn(values, key)) {
			value = values[key as K]
		} else {
			if (!secretSet.optional) {
				throw unknownKey()
			}

			try {
				value = secretSet.optional(key as O)
			} catch {
				throw unknownKey()
			}
		}

		// An optional key without a value is left out of the bundle.
		if (value !== undefined) {
			define[`import.meta.env.${key}`] = JSON.stringify(value)
		}
	}

	return define
}

export function viteSecretSetPlugin<K extends string, O extends string = never>(
	secretSet: ViteSecretSource<K, O>,
	options: ViteSecretSetOptions<K | O> = {}
): ViteSecretSetPlugin {
	return {
		name: 'hanzio-secret-set',
		config: () => ({ define: getViteDefine(secretSet, options) })
	}
}

export { readPublicConfig } from './public-config'
