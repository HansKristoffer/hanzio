import { z } from 'zod'
import { createApiClient, HttpResponseError } from '../api-wrapper'
import { withSecretDeadline } from './deadline'
import { getProcessEnvironment } from './environment'
import { SecretLoadError } from './errors'
import { readInfisicalCliToken } from './infisical-cli'
import { validateInfisicalScope, type InfisicalScope } from './infisical-config'
import { parseInfisicalSessionToken } from './infisical-session'

export const DEFAULT_INFISICAL_SITE_URL = 'https://eu.infisical.com'

export type InfisicalAuthMode = 'auto' | 'http' | 'cli'

const defaultFetch = globalThis.fetch

// Validate provider responses before exposing any values to a secret set.
const infisicalAuthResponseSchema = z.object({ accessToken: z.string() })
const infisicalSecretSchema = z.object({
	secretKey: z.string(),
	secretValue: z.string()
})

const infisicalSecretsResponseSchema = z.object({
	secrets: z.array(infisicalSecretSchema)
})

export async function fetchInfisicalSecrets<K extends string>(
	options: InfisicalScope<K> & {
		readonly clientId: string
		readonly clientSecret: string
	}
): Promise<Partial<Record<K, string>>> {
	validateInfisicalScope(options)

	return withSecretDeadline(options, async (signal) => {
		let operation = 'login'

		try {
			const infisical = createInfisicalApiClient(options.siteUrl)
			const { data: auth } = await infisical.request('login', {
				signal,
				reqBody: {
					clientId: options.clientId,
					clientSecret: options.clientSecret
				}
			})

			// Authentication and fetching share a deadline. Do not start a second
			// request if the caller cancelled while authentication was in progress.
			signal.throwIfAborted()
			operation = 'listSecrets'

			return await listInfisicalSecrets(infisical, auth.accessToken, {
				...options,
				signal
			})
		} catch (error) {
			throwInfisicalHttpError(error, operation, signal)
		}
	})
}

export type LoadInfisicalSecretsFromEnvOptions<K extends string> =
	InfisicalScope<K> & {
		readonly clientIdEnvKey: string
		readonly clientSecretEnvKey: string
		readonly auth?: InfisicalAuthMode
		readonly reportSource?: (source: string) => void
	}

export async function loadInfisicalSecrets<K extends string>(
	options: LoadInfisicalSecretsFromEnvOptions<K>
): Promise<Partial<Record<K, string>>> {
	validateInfisicalScope(options)

	const env = getProcessEnvironment()
	const clientId = env?.[options.clientIdEnvKey]
	const clientSecret = env?.[options.clientSecretEnvKey]
	const mode = options.auth ?? 'auto'

	if (!['auto', 'http', 'cli'].includes(mode)) {
		throw new SecretLoadError('CONFIGURATION', 'Invalid Infisical auth mode.')
	}

	// Explicit modes take precedence. Auto mode uses HTTP only when both
	// credentials exist; a failed HTTP request must not switch accounts.
	const useHttp =
		mode === 'http' || (mode === 'auto' && Boolean(clientId && clientSecret))

	if (useHttp) {
		if (!clientId || !clientSecret) {
			throw new SecretLoadError(
				'AUTHENTICATION',
				'Infisical HTTP authentication requires both client credentials.'
			)
		}

		options.reportSource?.('Infisical HTTP')

		return fetchInfisicalSecrets({ ...options, clientId, clientSecret })
	}

	options.reportSource?.(
		`Infisical CLI session (organization=${options.organizationId} project=${options.projectId} environment=${options.environment})`
	)

	return withSecretDeadline(options, (signal) =>
		fetchInfisicalSessionSecrets({ ...options, signal })
	)
}

async function fetchInfisicalSessionSecrets<K extends string>(
	options: InfisicalScope<K> & { signal: AbortSignal }
): Promise<Partial<Record<K, string>>> {
	const { signal } = options
	let token = await readInfisicalCliToken(options)

	signal.throwIfAborted()

	const session = parseInfisicalSessionToken(token)
	const infisical = createInfisicalApiClient(options.siteUrl)
	let operation = 'selectOrganization'

	try {
		// JWT claims only guide routing; Infisical verifies authentication and access.
		// An already scoped session needs no exchange (or additional MFA challenge).
		if (session.organizationId !== options.organizationId) {
			const { data } = await infisical.request('selectOrganization', {
				signal,
				reqHeaders: {
					Authorization: `Bearer ${token}`,
					'User-Agent': 'hanzio/secrets'
				},
				reqBody: { organizationId: options.organizationId }
			})

			signal.throwIfAborted()

			if (data.isMfaEnabled) {
				throw new SecretLoadError(
					'AUTHENTICATION',
					'Infisical requires MFA for this organization. Complete infisical login for the target organization and configured domain before loading secrets.',
					{ operation }
				)
			}

			const scopedSession = parseInfisicalSessionToken(data.token)

			if (scopedSession.organizationId !== options.organizationId) {
				throw new SecretLoadError(
					'AUTHENTICATION',
					'Infisical returned a session for a different organization.',
					{ operation }
				)
			}

			// Keep the exchanged token local: concurrent sets must never share or
			// overwrite the CLI's persisted session or another organization's token.
			token = data.token
		}

		signal.throwIfAborted()
		operation = 'listSecrets'

		return await listInfisicalSecrets(infisical, token, options)
	} catch (error) {
		throwInfisicalHttpError(error, operation, signal)
	}
}

async function listInfisicalSecrets<K extends string>(
	infisical: ReturnType<typeof createInfisicalApiClient>,
	token: string,
	options: InfisicalScope<K> & { signal: AbortSignal }
): Promise<Partial<Record<K, string>>> {
	const { data } = await infisical.request('listSecrets', {
		signal: options.signal,
		reqHeaders: { Authorization: `Bearer ${token}` },
		reqQuery: {
			environment: options.environment,
			projectId: options.projectId,
			secretPath: options.secretPath ?? '/',
			viewSecretValue: true,
			expandSecretReferences: true,
			includeImports: true
		}
	})

	// Infisical lists the folder, but callers only receive their requested keys.
	const wantedKeys = new Set<string>(options.keys)

	return Object.fromEntries(
		data.secrets
			.filter((secret) => wantedKeys.has(secret.secretKey))
			.map((secret) => [secret.secretKey, secret.secretValue])
	) as Partial<Record<K, string>>
}

function throwInfisicalHttpError(
	error: unknown,
	operation: string,
	signal: AbortSignal
): never {
	if (signal.aborted) {
		throw signal.reason
	}

	if (error instanceof SecretLoadError) {
		throw error
	}

	// API-wrapper errors can retain request bodies and raw responses.
	// Copy safe metadata only; never preserve the original error as a cause.
	const status = error instanceof HttpResponseError ? error.status : undefined
	const guidance =
		operation === 'selectOrganization' && (status === 401 || status === 403)
			? ' Run infisical login for the target organization and configured domain, then verify your access.'
			: ''

	throw new SecretLoadError(
		'HTTP',
		`Infisical HTTP ${operation} failed${status ? ` (status ${status})` : ''}.${guidance}`,
		{ operation, status }
	)
}

function createInfisicalApiClient(siteUrl: string) {
	return createApiClient({
		name: 'infisical',
		baseApiUrls: {
			infisical: siteUrl
		},
		defaultBaseApiUrl: 'infisical',
		fetch: getFetch(),
		retries: 1,
		endpoints: {
			// Internal endpoint also used by Infisical CLI init. Keep its contract
			// isolated here so upstream authentication changes have one integration point.
			selectOrganization: {
				method: 'POST',
				path: '/api/v3/auth/select-organization',
				reqHeadersSchema: z.object({
					Authorization: z.string(),
					'User-Agent': z.string()
				}),
				reqBodySchema: z.object({ organizationId: z.string() }),
				resSchema: z.object({
					token: z.string().min(1),
					isMfaEnabled: z.boolean().optional()
				}),
				reqBodyFormat: 'json'
			},
			login: {
				method: 'POST',
				path: '/api/v1/auth/universal-auth/login',
				reqBodySchema: z.object({
					clientId: z.string(),
					clientSecret: z.string()
				}),
				resSchema: infisicalAuthResponseSchema,
				reqBodyFormat: 'json'
			},
			listSecrets: {
				method: 'GET',
				path: '/api/v4/secrets',
				reqHeadersSchema: z.object({
					Authorization: z.string()
				}),
				reqQuerySchema: z.object({
					projectId: z.string(),
					environment: z.string(),
					secretPath: z.string(),
					viewSecretValue: z.boolean(),
					expandSecretReferences: z.boolean(),
					includeImports: z.boolean()
				}),
				resSchema: infisicalSecretsResponseSchema
			}
		}
	})
}

function getFetch(): typeof fetch {
	const fetchFn = globalThis.fetch ?? defaultFetch

	// A retry may wake after the overall deadline; stop before issuing fetch.
	return ((input, init) => {
		init?.signal?.throwIfAborted()

		return fetchFn(input, init)
	}) as typeof fetch
}
