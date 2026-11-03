import { z } from 'zod'
import {
	createApiClient,
	HttpResponseError,
	NetworkError,
	type OnRetryContext,
	RequestTimeoutError
} from '../api-wrapper'
import { exponentialBackoff } from '../promise'
import type { SecretRetry } from './core'
import { withSecretDeadline } from './deadline'
import { getProcessEnvironment } from './environment'
import { SecretLoadError } from './errors'
import { readInfisicalCliToken } from './infisical-cli'
import { validateInfisicalScope, type InfisicalScope } from './infisical-config'
import { readInfisicalIdentityFile } from './infisical-identity-file'
import { parseInfisicalSessionToken } from './infisical-session'

export const DEFAULT_INFISICAL_SITE_URL = 'https://eu.infisical.com'

export type InfisicalAuthMode = 'auto' | 'http' | 'cli'

type ReportRetry = { readonly reportRetry?: (retry: SecretRetry) => void }

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
	options: InfisicalScope<K> &
		ReportRetry & {
			readonly clientId: string
			readonly clientSecret: string
		}
): Promise<Partial<Record<K, string>>> {
	validateInfisicalScope(options)

	return withSecretDeadline(options, async (signal) => {
		let operation = 'login'

		try {
			const infisical = createInfisicalApiClient(
				options.siteUrl,
				options.reportRetry
			)
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
	InfisicalScope<K> &
		ReportRetry & {
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
	const mode = options.auth ?? 'auto'

	if (!['auto', 'http', 'cli'].includes(mode)) {
		throw new SecretLoadError('CONFIGURATION', 'Invalid Infisical auth mode.')
	}

	// Environment credentials win; with neither set, a machine identity file
	// stands in for them (see readInfisicalIdentityFile).
	const fromEnv = Boolean(
		env?.[options.clientIdEnvKey] || env?.[options.clientSecretEnvKey]
	)
	const file =
		mode === 'cli' || fromEnv
			? undefined
			: await readInfisicalIdentityFile(env, options.siteUrl)
	const clientId = fromEnv ? env?.[options.clientIdEnvKey] : file?.clientId
	const clientSecret = fromEnv
		? env?.[options.clientSecretEnvKey]
		: file?.clientSecret

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

		options.reportSource?.(
			file ? 'Infisical HTTP (identity file)' : 'Infisical HTTP'
		)

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
	options: InfisicalScope<K> & ReportRetry & { signal: AbortSignal }
): Promise<Partial<Record<K, string>>> {
	const { signal } = options
	// The CLI reads its local session, so only the HTTP calls below retry.
	let token = await readInfisicalCliToken(options)

	signal.throwIfAborted()

	const session = parseInfisicalSessionToken(token)
	const infisical = createInfisicalApiClient(
		options.siteUrl,
		options.reportRetry
	)
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

// A process that boots during a short network outage should wait it out, not
// crash. Network errors, per-attempt timeouts, 429 and 5xx retry with capped,
// jittered backoff until the caller's deadline aborts the signal. Other 4xx
// responses, such as a wrong client secret, fail on the first answer.
function createInfisicalApiClient(
	siteUrl: string,
	reportRetry?: (retry: SecretRetry) => void
) {
	return createApiClient({
		name: 'infisical',
		baseApiUrls: {
			infisical: siteUrl
		},
		defaultBaseApiUrl: 'infisical',
		fetch: getFetch(),
		retries: Number.POSITIVE_INFINITY,
		// A blackholed connection must not use up the whole deadline in one attempt.
		timeoutMs: 10_000,
		retryDelayMs: (attempt) =>
			exponentialBackoff(attempt + 1, { baseMs: 500, maxMs: 5_000 }),
		// Also caps a Retry-After header.
		maxRetryDelayMs: 5_000,
		onRetry: (context) =>
			reportRetry?.({
				operation: context.endpoint?.replace(/^infisical\./, '') ?? 'request',
				attempt: context.nextAttempt,
				delayMs: context.delayMs,
				reason: describeRetryReason(context)
			}),
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

// Raw errors can carry URLs, headers or bodies; keep a status, or a short code
// such as ECONNREFUSED (Node puts it on the cause, Bun on the error itself).
function describeRetryReason({ response, error }: OnRetryContext): string {
	if (response) {
		return `status ${response.status}`
	}

	if (error instanceof RequestTimeoutError) {
		return 'timeout'
	}

	const cause = error instanceof NetworkError ? error.cause : undefined
	const code =
		readErrorCode(cause) ?? readErrorCode((cause as { cause?: unknown })?.cause)

	return code ?? 'network error'
}

function readErrorCode(error: unknown): string | undefined {
	const code = (error as { code?: unknown } | null | undefined)?.code

	return typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code)
		? code
		: undefined
}

function getFetch(): typeof fetch {
	const fetchFn = globalThis.fetch ?? defaultFetch

	// A retry may wake after the overall deadline; stop before issuing fetch.
	return ((input, init) => {
		init?.signal?.throwIfAborted()

		return fetchFn(input, init)
	}) as typeof fetch
}
