import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
	defineSecretSet,
	getSecretEnvironment,
	getViteDefine,
	viteSecretSetPlugin
} from '.'
import type { SecretSetLoader } from '.'

const ENV_KEYS = [
	'APP_SECRET',
	'DATABASE_URL',
	'INFISICAL_CLIENT_ID',
	'INFISICAL_CLIENT_SECRET',
	'LOCAL_ONLY',
	'MISSING_SECRET',
	'OTHER_MISSING_SECRET',
	'NODE_ENV',
	'REMOTE_ONLY',
	'SECRETS_ENV'
] as const

const originalEnv = Object.fromEntries(
	ENV_KEYS.map((key) => [key, process.env[key]])
)

const originalConsoleInfo = console.info
const originalConsoleLog = console.log
const originalFetch = globalThis.fetch

afterEach(() => {
	console.info = originalConsoleInfo
	console.log = originalConsoleLog
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
		console.log = mock(() => {})
		const loader: SecretSetLoader<
			'APP_SECRET' | 'DATABASE_URL'
		> = async () => ({
			APP_SECRET: 'app-secret',
			DATABASE_URL: 'postgres://db'
		})

		const backendSecrets = await defineSecretSet(
			['APP_SECRET', 'DATABASE_URL'] as const,
			{
				projectId: 'project-id',
				loader
			}
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
		console.log = mock(() => {})
		process.env.LOCAL_ONLY = 'from-env'
		let calls = 0

		const secretSet = await defineSecretSet(['LOCAL_ONLY'] as const, {
			projectId: 'project-id',
			loader: async () => {
				calls++
				return { LOCAL_ONLY: 'from-loader' }
			}
		})

		expect(calls).toBe(0)
		expect(secretSet.secret('LOCAL_ONLY')).toBe('from-env')
	})

	test('process.env values override loaded values', async () => {
		console.log = mock(() => {})
		process.env.APP_SECRET = 'from-env'

		const secretSet = await defineSecretSet(
			['APP_SECRET', 'REMOTE_ONLY'] as const,
			{
				projectId: 'project-id',
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
		console.log = mock(() => {})

		await expect(
			defineSecretSet(['MISSING_SECRET', 'OTHER_MISSING_SECRET'] as const, {
				projectId: 'project-id',
				loader: async () => ({})
			})
		).rejects.toThrow('Missing secrets: MISSING_SECRET, OTHER_MISSING_SECRET')
	})

	test('caches secrets and can reload them', async () => {
		console.log = mock(() => {})
		let calls = 0

		const secretSet = await defineSecretSet(['REMOTE_ONLY'] as const, {
			projectId: 'project-id',
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

	test('exposes loaded secrets as Vite define values', async () => {
		console.log = mock(() => {})

		const secretSet = await defineSecretSet(['APP_SECRET'] as const, {
			projectId: 'project-id',
			loader: async () => ({ APP_SECRET: 'app-secret' })
		})

		expect(getViteDefine(secretSet)).toEqual({
			'import.meta.env.APP_SECRET': JSON.stringify('app-secret')
		})
	})

	test('creates a Vite plugin that returns define config', async () => {
		console.log = mock(() => {})

		const secretSet = await defineSecretSet(['APP_SECRET'] as const, {
			projectId: 'project-id',
			loader: async () => ({ APP_SECRET: 'app-secret' })
		})

		const plugin = viteSecretSetPlugin(secretSet)

		expect(plugin.name).toBe('hanzio-secret-set')
		expect(plugin.config()).toEqual({
			define: {
				'import.meta.env.APP_SECRET': JSON.stringify('app-secret')
			}
		})
	})

	test('logs the selected secrets environment without secret values', async () => {
		const log = mock(() => {})
		console.log = log

		await defineSecretSet(['APP_SECRET', 'DATABASE_URL'] as const, {
			projectId: 'project-id',
			environment: 'staging',
			loader: async () => ({
				APP_SECRET: 'app-secret',
				DATABASE_URL: 'postgres://db'
			})
		})

		const output = log.mock.calls.join(' ')
		expect(output).toContain('Loading secrets')
		expect(output).toContain('environment=')
		expect(output).toContain('staging')
		expect(output).toContain('count=')
		expect(output).toContain('2')
		expect(output).not.toContain('app-secret')
		expect(output).not.toContain('postgres://db')
	})

	test('loads missing secrets from Infisical over direct HTTP', async () => {
		console.log = mock(() => {})
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
			projectId: 'project-id'
		})

		expect(secretSet.secret('APP_SECRET')).toBe('from-infisical')
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
