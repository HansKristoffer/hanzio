import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
	cloudflareWorkerEnvLoader,
	createSecretSet,
	defineSecretSet,
	getSecretEnvironment,
	infisicalLoader,
	processEnvLoader
} from '.'
import type { SecretSetLoader } from '.'
import { getViteDefine, viteSecretSetPlugin } from './vite'

const ENV_KEYS = [
	'APP_SECRET',
	'DATABASE_URL',
	'INFISICAL_CLIENT_ID',
	'INFISICAL_CLIENT_SECRET',
	'LOCAL_ONLY',
	'MISSING_SECRET',
	'OTHER_MISSING_SECRET',
	'NODE_ENV',
	'OPTIONAL_SET',
	'OPTIONAL_UNSET',
	'REMOTE_ONLY',
	'SECRETS_ENV'
] as const

const originalEnv = Object.fromEntries(
	ENV_KEYS.map((key) => [key, process.env[key]])
)

const originalConsoleError = console.error
const originalFetch = globalThis.fetch

afterEach(() => {
	console.error = originalConsoleError
	globalThis.fetch = originalFetch

	for (const key of ENV_KEYS) {
		const value = originalEnv[key]

		if (value === undefined) {
			delete process.env[key]
		} else {
			process.env[key] = value
		}
	}
})

describe('defineSecretSet', () => {
	test('loads all configured secrets before resolving', async () => {
		console.error = mock(() => {})

		const loader: SecretSetLoader<
			'APP_SECRET' | 'DATABASE_URL'
		> = async () => ({
			APP_SECRET: 'app-secret',
			DATABASE_URL: 'postgres://db'
		})

		const backendSecrets = await defineSecretSet(
			['APP_SECRET', 'DATABASE_URL'] as const,
			{ loader }
		)

		expect(backendSecrets.secret('APP_SECRET')).toBe('app-secret')
		expect(backendSecrets.secret('DATABASE_URL')).toBe('postgres://db')
		expect(backendSecrets.secrets()).toEqual({
			APP_SECRET: 'app-secret',
			DATABASE_URL: 'postgres://db'
		})
		expect(process.env.APP_SECRET).toBe('app-secret')
	})

	test('uses process.env values without calling the loader', async () => {
		console.error = mock(() => {})
		process.env.LOCAL_ONLY = 'from-env'

		let calls = 0

		const secretSet = await defineSecretSet(['LOCAL_ONLY'] as const, {
			loader: async () => {
				calls++

				return { LOCAL_ONLY: 'from-loader' }
			}
		})

		expect(calls).toBe(0)
		expect(secretSet.secret('LOCAL_ONLY')).toBe('from-env')
	})

	test('process.env values override loaded values', async () => {
		console.error = mock(() => {})
		process.env.APP_SECRET = 'from-env'

		const secretSet = await defineSecretSet(
			['APP_SECRET', 'REMOTE_ONLY'] as const,
			{
				loader: async () => ({
					APP_SECRET: 'from-loader',
					REMOTE_ONLY: 'from-loader'
				})
			}
		)

		expect(secretSet.secret('APP_SECRET')).toBe('from-env')
		expect(secretSet.secret('REMOTE_ONLY')).toBe('from-loader')
	})

	test('fails fast with all missing configured secrets', async () => {
		console.error = mock(() => {})

		await expect(
			defineSecretSet(['MISSING_SECRET', 'OTHER_MISSING_SECRET'] as const, {
				loader: async () => ({})
			})
		).rejects.toThrow('Missing secrets: MISSING_SECRET, OTHER_MISSING_SECRET')
	})

	test('caches secrets and can reload them', async () => {
		console.error = mock(() => {})

		let calls = 0

		const secretSet = await defineSecretSet(['REMOTE_ONLY'] as const, {
			loader: async () => {
				calls++

				return { REMOTE_ONLY: `value-${calls}` }
			}
		})

		expect(secretSet.secret('REMOTE_ONLY')).toBe('value-1')
		expect(secretSet.secret('REMOTE_ONLY')).toBe('value-1')
		expect(calls).toBe(1)

		await secretSet.reload()

		expect(secretSet.secret('REMOTE_ONLY')).toBe('value-2')
		expect(calls).toBe(2)
	})

	test('secrets returns a copy of cached values', async () => {
		console.error = mock(() => {})

		const secretSet = await defineSecretSet(['APP_SECRET'] as const, {
			loader: async () => ({ APP_SECRET: 'app-secret' })
		})

		const secrets = secretSet.secrets()

		secrets.APP_SECRET = 'mutated'

		expect(secretSet.secret('APP_SECRET')).toBe('app-secret')
		expect(secretSet.secrets()).toEqual({ APP_SECRET: 'app-secret' })
	})

	test('custom loaders receive only missing keys and environment', async () => {
		console.error = mock(() => {})
		process.env.APP_SECRET = 'from-env'

		const contexts: unknown[] = []

		await defineSecretSet(['APP_SECRET', 'REMOTE_ONLY'] as const, {
			environment: 'staging',
			loader: async (context) => {
				contexts.push(context)

				return { REMOTE_ONLY: 'from-loader' }
			}
		})

		expect(contexts).toMatchObject([
			{
				keys: ['REMOTE_ONLY'],
				environment: 'staging'
			}
		])
	})

	test('exposes loaded secrets as Vite define values', async () => {
		console.error = mock(() => {})

		const secretSet = await defineSecretSet(['APP_SECRET'] as const, {
			loader: async () => ({ APP_SECRET: 'app-secret' })
		})

		expect(getViteDefine(secretSet, { publicKeys: ['APP_SECRET'] })).toEqual({
			'import.meta.env.APP_SECRET': JSON.stringify('app-secret')
		})
	})

	test('creates a Vite plugin that returns define config', async () => {
		console.error = mock(() => {})

		const secretSet = await defineSecretSet(['APP_SECRET'] as const, {
			loader: async () => ({ APP_SECRET: 'app-secret' })
		})

		const plugin = viteSecretSetPlugin(secretSet, {
			publicKeys: ['APP_SECRET']
		})

		expect(plugin.name).toBe('hanzio-secret-set')
		expect(plugin.config()).toEqual({
			define: {
				'import.meta.env.APP_SECRET': JSON.stringify('app-secret')
			}
		})
	})

	test('logs the selected secrets environment without secret values', async () => {
		const log = mock(() => {})

		console.error = log

		await defineSecretSet(['APP_SECRET', 'DATABASE_URL'] as const, {
			environment: 'staging',
			loader: async () => ({
				APP_SECRET: 'app-secret',
				DATABASE_URL: 'postgres://db'
			})
		})

		const output = log.mock.calls.join(' ')

		expect(output).toContain('Loaded secrets')
		expect(output).toContain('environment=')
		expect(output).toContain('staging')
		expect(output).toContain('count=')
		expect(output).toContain('source=')
		expect(output).toContain('custom loader')
		expect(output).toContain('2')
		expect(output).not.toContain('app-secret')
		expect(output).not.toContain('postgres://db')
	})

	test('loads missing secrets from Infisical over direct HTTP', async () => {
		console.error = mock(() => {})
		process.env.INFISICAL_CLIENT_ID = 'client-id'
		process.env.INFISICAL_CLIENT_SECRET = 'client-secret'

		const fetchMock = mock(
			async (url: string | URL | Request, init: RequestInit = {}) => {
				const requestUrl = String(url)

				if (
					requestUrl ===
					'https://eu.infisical.com/api/v1/auth/universal-auth/login'
				) {
					expect(init?.method).toBe('POST')
					expect(JSON.parse(String(init.body))).toEqual({
						clientId: 'client-id',
						clientSecret: 'client-secret'
					})

					return Response.json({ accessToken: 'access-token' })
				}

				if (requestUrl.startsWith('https://eu.infisical.com/api/v4/secrets?')) {
					expect(init?.method).toBe('GET')
					expect(init?.headers).toMatchObject({
						Authorization: 'Bearer access-token'
					})

					const parsedUrl = new URL(requestUrl)

					expect(parsedUrl.searchParams.get('projectId')).toBe('project-id')
					expect(parsedUrl.searchParams.get('environment')).toBe('dev')
					expect(parsedUrl.searchParams.get('secretPath')).toBe('/')
					expect(parsedUrl.searchParams.get('viewSecretValue')).toBe('true')
					expect(parsedUrl.searchParams.get('expandSecretReferences')).toBe(
						'true'
					)
					expect(parsedUrl.searchParams.get('includeImports')).toBe('true')

					return Response.json({
						secrets: [
							{
								secretKey: 'APP_SECRET',
								secretValue: 'from-infisical'
							},
							{
								secretKey: 'IGNORED_SECRET',
								secretValue: 'ignored'
							}
						]
					})
				}

				throw new Error(`Unexpected request: ${requestUrl}`)
			}
		) as unknown as typeof fetch

		globalThis.fetch = fetchMock

		const secretSet = await defineSecretSet(['APP_SECRET'] as const, {
			organizationId: 'org-a',
			projectId: 'project-id'
		})

		expect(secretSet.secret('APP_SECRET')).toBe('from-infisical')
		expect(
			(console.error as ReturnType<typeof mock>).mock.calls.join(' ')
		).toContain('Infisical HTTP')
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	test('cloudflareWorkerEnvLoader reads from the passed Worker env object', async () => {
		console.error = mock(() => {})
		delete process.env.REMOTE_ONLY

		const fetchMock = mock(async () => {
			throw new Error('fetch should not be called')
		}) as unknown as typeof fetch

		globalThis.fetch = fetchMock

		const secretSet = await defineSecretSet(['REMOTE_ONLY'] as const, {
			loader: cloudflareWorkerEnvLoader({
				REMOTE_ONLY: 'from-worker-env'
			})
		})

		expect(secretSet.secret('REMOTE_ONLY')).toBe('from-worker-env')
		expect(fetchMock).toHaveBeenCalledTimes(0)
	})

	test('cloudflareWorkerEnvLoader is overridden by process.env when set', async () => {
		console.error = mock(() => {})
		process.env.REMOTE_ONLY = 'from-process'

		const secretSet = await defineSecretSet(['REMOTE_ONLY'] as const, {
			loader: cloudflareWorkerEnvLoader({
				REMOTE_ONLY: 'from-worker-env'
			})
		})

		expect(secretSet.secret('REMOTE_ONLY')).toBe('from-process')
	})

	test('processEnvLoader resolves from process.env only without fetch', async () => {
		console.error = mock(() => {})
		process.env.REMOTE_ONLY = 'from-env-direct'

		const fetchMock = mock(async () => {
			throw new Error('fetch should not be called')
		}) as unknown as typeof fetch

		globalThis.fetch = fetchMock

		const secretSet = await defineSecretSet(['REMOTE_ONLY'] as const, {
			loader: processEnvLoader
		})

		expect(secretSet.secret('REMOTE_ONLY')).toBe('from-env-direct')
		expect(fetchMock).toHaveBeenCalledTimes(0)
	})

	test('infisicalLoader uses explicit client credentials', async () => {
		console.error = mock(() => {})
		delete process.env.INFISICAL_CLIENT_ID
		delete process.env.INFISICAL_CLIENT_SECRET

		const fetchMock = mock(
			async (url: string | URL | Request, init: RequestInit = {}) => {
				const requestUrl = String(url)

				if (
					requestUrl ===
					'https://eu.infisical.com/api/v1/auth/universal-auth/login'
				) {
					expect(JSON.parse(String(init.body))).toEqual({
						clientId: 'explicit-id',
						clientSecret: 'explicit-secret'
					})

					return Response.json({ accessToken: 'access-token' })
				}

				if (requestUrl.startsWith('https://eu.infisical.com/api/v4/secrets?')) {
					return Response.json({
						secrets: [
							{
								secretKey: 'APP_SECRET',
								secretValue: 'from-infisical-explicit'
							}
						]
					})
				}

				throw new Error(`Unexpected request: ${requestUrl}`)
			}
		) as unknown as typeof fetch

		globalThis.fetch = fetchMock

		const secretSet = await defineSecretSet(['APP_SECRET'] as const, {
			loader: infisicalLoader({
				organizationId: 'org-a',
				projectId: 'project-id',
				clientId: 'explicit-id',
				clientSecret: 'explicit-secret'
			})
		})

		expect(secretSet.secret('APP_SECRET')).toBe('from-infisical-explicit')
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})
})

describe('getSecretEnvironment', () => {
	test('uses SECRETS_ENV before NODE_ENV', () => {
		process.env.SECRETS_ENV = 'staging'
		process.env.NODE_ENV = 'production'

		expect(getSecretEnvironment()).toBe('staging')
	})

	test('maps production to prod and defaults to dev', () => {
		process.env.NODE_ENV = 'production'

		expect(getSecretEnvironment()).toBe('prod')

		delete process.env.NODE_ENV

		expect(getSecretEnvironment()).toBe('dev')
	})
})

describe('optional keys and loaders alongside Infisical options', () => {
	const infisical = { organizationId: 'org-a', projectId: 'project-id' }

	test('a loader replaces Infisical, whose options are then not validated', async () => {
		process.env.APP_SECRET = 'from-env'
		globalThis.fetch = mock(async () => {
			throw new Error('fetch should not be called')
		}) as unknown as typeof fetch

		const isTest = true as boolean
		const secrets = await defineSecretSet(['APP_SECRET'], {
			...infisical,
			projectId: '',
			logger: false,
			loader: isTest ? processEnvLoader : undefined
		})

		expect(secrets.secret('APP_SECRET')).toBe('from-env')
		expect(globalThis.fetch).not.toHaveBeenCalled()

		delete process.env.APP_SECRET
		await expect(
			defineSecretSet(['APP_SECRET'], {
				...infisical,
				logger: false,
				loader: processEnvLoader
			})
		).rejects.toThrow('Missing secrets: APP_SECRET')
	})

	test('rejects a missing projectId at declaration without a loader', () => {
		expect(() =>
			createSecretSet(['APP_SECRET'], { ...infisical, projectId: ' ' })
		).toThrow('Infisical projectId is required')
	})

	test('optional keys share the fetch, mirror only set values, and never fail', async () => {
		process.env.OPTIONAL_SET = 'local-optional'

		let remote: Record<string, string> = {
			APP_SECRET: 'app',
			OPTIONAL_UNSET: ''
		}
		const contexts: (readonly string[])[] = []
		const secrets = await defineSecretSet(['APP_SECRET'], {
			logger: false,
			optional: ['OPTIONAL_SET', 'OPTIONAL_UNSET'],
			loader: async (context) => {
				contexts.push(context.keys)

				return remote
			}
		})

		expect(contexts).toEqual([['APP_SECRET', 'OPTIONAL_UNSET']])
		expect(secrets.secret('APP_SECRET')).toBe('app')
		expect(secrets.optional('OPTIONAL_SET')).toBe('local-optional')
		expect(secrets.optional('OPTIONAL_UNSET')).toBeUndefined()
		expect(secrets.secrets()).toEqual({ APP_SECRET: 'app' })
		expect(secrets.parsed()).toEqual({ APP_SECRET: 'app' })
		expect(secrets.sources()).toEqual({
			APP_SECRET: 'custom loader',
			OPTIONAL_SET: 'process.env'
		})
		expect('OPTIONAL_UNSET' in process.env).toBe(false)

		// A key added upstream later appears after reload.
		remote = { APP_SECRET: 'app', OPTIONAL_UNSET: 'added' }
		await secrets.reload()

		expect(secrets.optional('OPTIONAL_UNSET')).toBe('added')
		expect(process.env.OPTIONAL_UNSET).toBe('added')

		// Removed upstream: the value and its mirror go away.
		remote = { APP_SECRET: 'app' }
		await secrets.reload()

		expect(secrets.optional('OPTIONAL_UNSET')).toBeUndefined()
		expect('OPTIONAL_UNSET' in process.env).toBe(false)
	})

	test('rejects a key that is both required and optional at declaration', () => {
		expect(() =>
			createSecretSet(['APP_SECRET', 'DATABASE_URL'], {
				...infisical,
				optional: ['DATABASE_URL']
			})
		).toThrow('both required and optional: DATABASE_URL')
	})

	test('types: optional keys stay separate from required ones', () => {
		const _typeCheck = async () => {
			const secrets = await defineSecretSet(['DATABASE_URL', 'APP_SECRET'], {
				...infisical,
				optional: ['RESEND_API_KEY', 'EXA_API_KEY']
			})
			const url: string = secrets.secret('DATABASE_URL')
			const resend: string | undefined = secrets.optional('RESEND_API_KEY')
			const sources: { RESEND_API_KEY?: string; DATABASE_URL: string } =
				secrets.sources()

			// @ts-expect-error An optional key is not a required secret.
			secrets.secret('RESEND_API_KEY')
			// @ts-expect-error Only declared optional keys are accepted.
			secrets.optional('DATABASE_URL')
			// @ts-expect-error The optional result may be undefined.
			const notString: string = secrets.optional('EXA_API_KEY')

			const isTest = Boolean(process.env.CI)

			await defineSecretSet(['DATABASE_URL'], {
				...infisical,
				optional: ['RESEND_API_KEY'],
				loader: isTest ? processEnvLoader : undefined
			})

			return [url, resend, sources, notString]
		}

		expect(_typeCheck).toBeInstanceOf(Function)
	})
})
