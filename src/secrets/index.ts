import {
	createSecretSet as createCoreSecretSet,
	type LazySecretSet,
	type CommonSecretSetOptions,
	type CustomLoaderDefineSecretSetOptions,
	type SecretSet,
	type SecretSetLoader
} from './core'
import {
	getProcessEnvironment,
	resolveSecretEnvironment,
	type SecretEnvironment
} from './environment'
import {
	DEFAULT_INFISICAL_SITE_URL,
	loadInfisicalSecrets,
	type InfisicalAuthMode
} from './infisical'
import {
	validateInfisicalOrganizationId,
	type InfisicalProjectOptions
} from './infisical-config'

export * from './core'
export * from './infisical'
export * from './loaders'
export * from './vite'
export type { SecretRequestOptions } from './deadline'

export type InfisicalDefineSecretSetOptions<
	K extends string = string,
	Parsed = Record<K, string>
> = CommonSecretSetOptions<K, Parsed> &
	InfisicalProjectOptions & {
		readonly auth?: InfisicalAuthMode
		readonly clientIdEnvKey?: string
		readonly clientSecretEnvKey?: string
		readonly loader?: undefined
	}

export type DefineSecretSetOptions<
	K extends string,
	Parsed = Record<K, string>
> =
	| InfisicalDefineSecretSetOptions<K, Parsed>
	| CustomLoaderDefineSecretSetOptions<K, Parsed>

export function getSecretEnvironment(): SecretEnvironment {
	return resolveSecretEnvironment(
		undefined,
		getProcessEnvironment()
	) as SecretEnvironment
}

export function createSecretSet<
	const Keys extends readonly string[],
	Parsed = Record<Keys[number], string>
>(
	keys: Keys,
	options: DefineSecretSetOptions<Keys[number], Parsed>
): LazySecretSet<Keys[number], Parsed> {
	let loader: SecretSetLoader<Keys[number]>

	if (!options.loader) {
		// Validate even when environment overrides satisfy every key.
		validateInfisicalOrganizationId(options.organizationId)
		loader = createDefaultInfisicalLoader(options)
	} else {
		loader = options.loader
	}

	// Supply process.env only from this Node/Bun entry point, keeping the core portable.
	return createCoreSecretSet(
		keys,
		{ ...options, loader },
		getProcessEnvironment()
	)
}

function createDefaultInfisicalLoader<K extends string, Parsed>(
	options: InfisicalDefineSecretSetOptions<K, Parsed>
): SecretSetLoader<K> {
	return (context) =>
		loadInfisicalSecrets({
			...context,
			projectId: options.projectId,
			organizationId: options.organizationId,
			siteUrl: options.siteUrl ?? DEFAULT_INFISICAL_SITE_URL,
			secretPath: options.secretPath,
			auth: options.auth,
			clientIdEnvKey: options.clientIdEnvKey ?? 'INFISICAL_CLIENT_ID',
			clientSecretEnvKey:
				options.clientSecretEnvKey ?? 'INFISICAL_CLIENT_SECRET'
		})
}

/** Compatibility API: load immediately and fail before application startup. */
export async function defineSecretSet<
	const Keys extends readonly string[],
	Parsed = Record<Keys[number], string>
>(
	keys: Keys,
	options: DefineSecretSetOptions<Keys[number], Parsed>
): Promise<SecretSet<Keys[number], Parsed>> {
	return createSecretSet(keys, options).load()
}
