import { SecretLoadError } from './errors'

export type SecretEnvironment = 'dev' | 'staging' | 'prod'

export type SecretEnvironmentOption =
	| SecretEnvironment
	| { readonly slug: string }
	| (() => SecretEnvironment | { readonly slug: string })

export type EnvironmentVariables = Record<string, string | undefined>

export function getProcessEnvironment(): EnvironmentVariables | undefined {
	return typeof process === 'undefined' ? undefined : process.env
}

export function resolveSecretEnvironment(
	option?: SecretEnvironmentOption,
	env?: EnvironmentVariables
): string {
	// Resolve callbacks once; every reload stays in the same environment.
	const explicit = typeof option === 'function' ? option() : option

	if (typeof explicit === 'object' && explicit !== null) {
		if (
			typeof explicit.slug !== 'string' ||
			!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(explicit.slug)
		) {
			throw new SecretLoadError(
				'CONFIGURATION',
				'Custom secret environment requires a valid slug.'
			)
		}

		return explicit.slug
	}

	// Explicit configuration is strict. Typos must not silently select dev.
	const selected = explicit ?? env?.SECRETS_ENV

	if (selected !== undefined) {
		if (selected === 'production' || selected === 'prod') {
			return 'prod'
		}

		if (selected === 'development' || selected === 'dev') {
			return 'dev'
		}

		if (selected === 'staging') {
			return 'staging'
		}

		throw new SecretLoadError(
			'CONFIGURATION',
			'Invalid secret environment. Use dev, staging, prod, or an explicit { slug } option.'
		)
	}

	// NODE_ENV retains the conventional development/test fallback.
	if (env?.NODE_ENV === 'production' || env?.NODE_ENV === 'prod') {
		return 'prod'
	}

	if (env?.NODE_ENV === 'staging') {
		return 'staging'
	}

	return 'dev'
}
