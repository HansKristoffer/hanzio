import { z } from 'zod'
import { createApiClient } from '../api-wrapper'
import type { SecretSetLoaderContext } from '.'

const defaultFetch = globalThis.fetch

const infisicalAuthResponseSchema = z.object({
	accessToken: z.string()
})

const infisicalSecretSchema = z.object({
	secretKey: z.string(),
	secretValue: z.string()
})

const infisicalSecretsResponseSchema = z.object({
	secrets: z.array(infisicalSecretSchema)
})

export async function loadInfisicalSecrets<SecretKey extends string>({
	keys,
	projectId,
	environment,
	siteUrl,
	clientIdEnvKey,
	clientSecretEnvKey
}: SecretSetLoaderContext<SecretKey>): Promise<
	Partial<Record<SecretKey, string>>
> {
	const clientId = process.env[clientIdEnvKey]
	const clientSecret = process.env[clientSecretEnvKey]

	if (!clientId || !clientSecret) {
		throw new Error('Missing Infisical credentials')
	}

	const infisical = createInfisicalApiClient(siteUrl)
	const { data: auth } = await infisical.request('login', {
		reqBody: {
			clientId,
			clientSecret
		}
	})
	const { data } = await infisical.request('listSecrets', {
		reqHeaders: {
			Authorization: `Bearer ${auth.accessToken}`
		},
		reqQuery: {
			environment,
			projectId,
			secretPath: '/',
			viewSecretValue: true,
			expandSecretReferences: true,
			includeImports: true
		}
	})

	const wantedKeys = new Set<string>(keys)
	return Object.fromEntries(
		data.secrets
			.filter((secret) => wantedKeys.has(secret.secretKey))
			.map((secret) => [secret.secretKey, secret.secretValue])
	) as Partial<Record<SecretKey, string>>
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
	return globalThis.fetch ?? defaultFetch
}
