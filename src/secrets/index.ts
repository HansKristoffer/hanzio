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
	validateInfisicalProjectId,
	type InfisicalProjectOptions
} from './infisical-config'

export * from './core'
export * from './infisical'
export * from './loaders'
export type { SecretRequestOptions } from './deadline'

export type InfisicalDefineSecretSetOptions<
	K extends string = string,
	Parsed = Record<K, string>,
	O extends string = never
> = CommonSecretSetOptions<K, Parsed, O> &
	InfisicalProjectOptions & {
		readonly auth?: InfisicalAuthMode
		readonly clientIdEnvKey?: string
		readonly clientSecretEnvKey?: string
		/** Replaces Infisical, for example `processEnvLoader` in tests. */
		readonly loader?: SecretSetLoader<NoInfer<K | O>>
	}

export type DefineSecretSetOptions<
	K extends string,
	Parsed = Record<K, string>,
	O extends string = never
> =
	| InfisicalDefineSecretSetOptions<K, Parsed, O>
	| CustomLoaderDefineSecretSetOptions<K, Parsed, O>

export function getSecretEnvironment(): SecretEnvironment {
	return resolveSecretEnvironment(
		undefined,
		getProcessEnvironment()
	) as SecretEnvironment
}

export function createSecretSet<
	const Keys extends readonly string[],
	Parsed = Record<Keys[number], string>,
	const O extends string = never
>(
	keys: Keys,
	options: DefineSecretSetOptions<Keys[number], Parsed, O>
): LazySecretSet<Keys[number], Parsed, O> {
	let loader = options.loader

	if (!loader) {
		// Without a loader only the Infisical variant fits. Validate even when
		// environment overrides satisfy every key.
		const infisical = options as InfisicalDefineSecretSetOptions<
			Keys[number],
			Parsed,
			O
		>

		validateInfisicalOrganizationId(infisical.organizationId)
		validateInfisicalProjectId(infisical.projectId)
		loader = createDefaultInfisicalLoader(infisical)
	}

	// Supply process.env only from this Node/Bun entry point, keeping the core portable.
	return createCoreSecretSet(
		keys,
		{ ...options, loader },
		getProcessEnvironment()
	)
}

function createDefaultInfisicalLoader<
	K extends string,
	Parsed,
	O extends string
>(
	options: InfisicalDefineSecretSetOptions<K, Parsed, O>
): SecretSetLoader<K | O> {
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
	Parsed = Record<Keys[number], string>,
	const O extends string = never
>(
	keys: Keys,
	options: DefineSecretSetOptions<Keys[number], Parsed, O>
): Promise<SecretSet<Keys[number], Parsed, O>> {
	return createSecretSet(keys, options).load()
}
