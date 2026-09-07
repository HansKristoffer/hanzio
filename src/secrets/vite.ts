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

export function getViteDefine<K extends string>(
	secretSet: Pick<SecretSet<K, unknown>, 'secrets'>,
	options: ViteSecretSetOptions<K> = {}
): Record<string, string> {
	const values = secretSet.secrets()
	const keys = options.publicKeys ?? (Object.keys(values) as K[])

	// An explicit allowlist is required before exposing non-prefixed values.
	if (!options.publicKeys && keys.some((key) => !key.startsWith('VITE_'))) {
		throw new SecretLoadError(
			'CONFIGURATION',
			'Vite secret sets must contain only VITE_ keys, or provide an explicit publicKeys list.'
		)
	}

	for (const key of keys) {
		if (!Object.hasOwn(values, key) || !/^[A-Za-z_$][\w$]*$/.test(key)) {
			throw new SecretLoadError(
				'CONFIGURATION',
				'Vite publicKeys must reference configured keys with valid JavaScript identifiers.'
			)
		}

		if (['MODE', 'BASE_URL', 'PROD', 'DEV', 'SSR'].includes(key)) {
			throw new SecretLoadError(
				'CONFIGURATION',
				'Vite built-in environment constants cannot be overridden by secrets.'
			)
		}
	}

	// Only selected public values become browser-visible replacements.
	return Object.fromEntries(
		keys.map((key) => [`import.meta.env.${key}`, JSON.stringify(values[key])])
	)
}

export function viteSecretSetPlugin<K extends string>(
	secretSet: Pick<SecretSet<K, unknown>, 'secrets'>,
	options: ViteSecretSetOptions<K> = {}
): ViteSecretSetPlugin {
	return {
		name: 'hanzio-secret-set',
		config: () => ({ define: getViteDefine(secretSet, options) })
	}
}
