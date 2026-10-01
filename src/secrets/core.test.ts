import { describe, expect, mock, test } from 'bun:test'
import { z } from 'zod'
import { createSecretSet, defineSecretSet, type SecretSetLoader } from './core'
import { resolveSecretEnvironment } from './environment'
import { processEnvLoader } from './loaders'
import { getViteDefine } from './vite'
import { cloudflareWorkerEnvLoader } from './worker-loader'

const quiet = { logger: false as const }

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((done) => {
		resolve = done
	})

	return { promise, resolve }
}

describe('secret ownership and reload', () => {
	test('loads keys that also exist on Object.prototype', async () => {
		const set = await defineSecretSet(['constructor', 'toString'], {
			...quiet,
			loader: async () => ({
				constructor: 'constructor-value',
				toString: 'string-value'
			})
		})

		expect(set.secrets()).toEqual({
			constructor: 'constructor-value',
			toString: 'string-value'
		})
	})

	test('preserves original environment values on reload', async () => {
		const env = { A: 'local' }
		const loader = mock(processEnvLoader)
		const set = await defineSecretSet(['A'], { ...quiet, loader }, env)

		await set.reload()

		expect(set.secret('A')).toBe('local')
		expect(loader).not.toHaveBeenCalled()
		expect(set.sources()).toEqual({ A: 'process.env' })
	})

	test('does not accept another set’s mirrored values as local overrides', async () => {
		const env: Record<string, string> = {}
		const dev = await defineSecretSet(
			['A'],
			{ ...quiet, environment: 'dev', loader: async () => ({ A: 'dev' }) },
			env
		)
		const fetchProd = mock(async () => ({ A: 'prod' }))
		const prod = await defineSecretSet(
			['A'],
			{ ...quiet, environment: 'prod', loader: fetchProd },
			env
		)

		expect(fetchProd).toHaveBeenCalledTimes(1)
		expect(prod.secret('A')).toBe('prod')
		expect(dev.secret('A')).toBe('dev')

		await dev.reload()

		expect(dev.secret('A')).toBe('dev')
		expect(prod.secret('A')).toBe('prod')
	})

	test('isolated sets keep values out of the environment', async () => {
		const env = { A: 'override' }
		const set = await defineSecretSet(
			['A', 'B'],
			{
				...quiet,
				writeToProcessEnv: false,
				loader: async () => ({ B: 'remote' })
			},
			env
		)

		expect(set.secrets()).toEqual({ A: 'override', B: 'remote' })
		expect(env).toEqual({ A: 'override' })

		await set.reload()

		expect(env).toEqual({ A: 'override' })
	})

	test('preserves local overrides even when equal to fetched values', async () => {
		const env = { A: 'same' }
		const loader = mock(async () => ({ A: 'changed' }))
		const set = await defineSecretSet(['A'], { ...quiet, loader }, env)

		await set.reload()

		expect(set.secret('A')).toBe('same')
		expect(loader).not.toHaveBeenCalled()
	})

	test('shares concurrent reload work and retains cache on failed refresh', async () => {
		let calls = 0
		const refresh = deferred<{ A: string }>()
		const loader: SecretSetLoader<'A'> = async () => {
			calls++

			if (calls === 1) {
				return { A: 'old' }
			}

			if (calls === 2) {
				return refresh.promise
			}

			throw new Error('private error')
		}
		const env = {}
		const set = await defineSecretSet(['A'], { ...quiet, loader }, env)
		const first = set.reload()
		const second = set.reload()

		expect(calls).toBe(2)
		expect(set.secret('A')).toBe('old')

		refresh.resolve({ A: 'new' })
		await Promise.all([first, second])

		expect(set.secret('A')).toBe('new')

		await expect(set.reload()).rejects.toThrow('Secret loader failed.')

		expect(set.secret('A')).toBe('new')
		expect(env).toEqual({ A: 'new' })
	})

	test('honors environment overrides made during a fetch', async () => {
		const env: Record<string, string> = {}
		const pending = deferred<{ A: string }>()
		const loading = defineSecretSet(
			['A'],
			{ ...quiet, loader: () => pending.promise },
			env
		)

		env.A = 'new override'
		pending.resolve({ A: 'remote' })

		const set = await loading

		expect(set.secret('A')).toBe('new override')
		expect(set.sources()).toEqual({ A: 'process.env' })
	})
})

describe('validation, deadlines, and reporting', () => {
	test.each([
		'production-typo',
		'',
		'preview'
	])('rejects unknown explicit SECRETS_ENV: %s', (value) => {
		expect(() =>
			resolveSecretEnvironment(undefined, {
				SECRETS_ENV: value,
				NODE_ENV: 'production'
			})
		).toThrow('Invalid secret environment')
	})
	test('supports explicit custom slugs and environment callbacks', async () => {
		const loader = mock(async () => ({ A: 'value' }))

		await defineSecretSet(['A'], {
			...quiet,
			environment: () => ({ slug: 'preview-123' }),
			loader
		})

		expect(loader.mock.calls[0]).toMatchObject([{ environment: 'preview-123' }])
		expect(() => resolveSecretEnvironment({ slug: '../invalid' })).toThrow()
		expect(resolveSecretEnvironment(undefined, { NODE_ENV: 'test' })).toBe(
			'dev'
		)
	})

	test('validates and returns typed parsed values without changing raw secrets', async () => {
		const env = {}
		const set = await defineSecretSet(
			['URL', 'PORT', 'JSON'],
			{
				...quiet,
				loader: async () => ({
					URL: 'https://example.com',
					PORT: '5432',
					JSON: '{"enabled":true}'
				}),
				schema: z.object({
					URL: z.url(),
					PORT: z.coerce.number().int().positive(),
					JSON: z
						.string()
						.transform((value) => JSON.parse(value) as { enabled: boolean })
				})
			},
			env
		)
		const port: number = set.parsed().PORT

		expect(port).toBe(5432)
		expect(set.secret('PORT')).toBe('5432')

		const copy = set.parsed()

		copy.JSON.enabled = false

		expect(set.parsed().JSON.enabled).toBe(true)
	})

	test('does not commit failed schema validation or leak validation messages', async () => {
		const env = {}
		let value = 'good'
		const set = await defineSecretSet(
			['A'],
			{
				...quiet,
				loader: async () => ({ A: value }),
				schema: z.object({
					A: z.literal('good', { error: 'private validation value' })
				})
			},
			env
		)

		value = 'private bad value'
		await expect(set.reload()).rejects.toThrow(
			'Secret schema validation failed.'
		)

		expect(set.secret('A')).toBe('good')
		expect(env).toEqual({ A: 'good' })
	})

	test('times out ignored cancellation without committing a late result', async () => {
		const env = {}
		const pending = deferred<{ A: string }>()
		const result = defineSecretSet(
			['A'],
			{ ...quiet, timeoutMs: 10, loader: () => pending.promise },
			env
		)

		await expect(result).rejects.toMatchObject({ code: 'TIMEOUT' })
		pending.resolve({ A: 'too late' })
		await new Promise((resolve) => setTimeout(resolve, 5))

		expect(env).toEqual({})
	})

	test('cancellation never exposes user-provided abort reasons', async () => {
		const controller = new AbortController()
		const loader = mock(async () => ({ A: 'value' }))

		controller.abort(new Error('private abort reason'))
		await expect(
			defineSecretSet(['A'], { ...quiet, loader, signal: controller.signal })
		).rejects.toMatchObject({
			code: 'ABORTED',
			message: 'Secret loading was cancelled.'
		})

		expect(loader).not.toHaveBeenCalled()
	})

	test('reload accepts a fresh cancellation signal', async () => {
		const set = await defineSecretSet(['A'], {
			...quiet,
			loader: async () => ({ A: 'value' })
		})
		const controller = new AbortController()

		controller.abort()
		await expect(
			set.reload({ signal: controller.signal })
		).rejects.toMatchObject({ code: 'ABORTED' })

		expect(set.secret('A')).toBe('value')

		await set.reload()
	})

	test('reports final source counts only after success, with sanitized failures', async () => {
		const logger = { info: mock(() => {}), error: mock(() => {}) }
		const pending = deferred<{ A: string; B: string }>()
		const env = { A: 'local-private' }
		const loading = defineSecretSet(
			['A', 'B'],
			{
				logger,
				loader: async (ctx) => {
					ctx.reportSource?.('selected source')

					return pending.promise
				}
			},
			env
		)

		expect(logger.info).not.toHaveBeenCalled()

		pending.resolve({ A: 'unused-private', B: 'remote-private' })

		const set = await loading

		expect(logger.info.mock.calls[0]).toMatchObject([
			'Loaded secrets',
			{ count: 2, sources: { 'process.env': 1, 'selected source': 1 } }
		])
		expect(set.sources()).toEqual({ A: 'process.env', B: 'selected source' })

		await expect(
			defineSecretSet(['A'], {
				logger,
				loader: async () => {
					throw new Error('failure-private')
				}
			})
		).rejects.toThrow()

		expect(logger.error.mock.calls[0]).toMatchObject([
			'Secret loading failed',
			{ code: 'LOADER' }
		])
		expect(
			JSON.stringify([logger.info.mock.calls, logger.error.mock.calls])
		).not.toContain('private')
	})

	test('supports disabled logging and logger failures do not affect results', async () => {
		const set = await defineSecretSet(['A'], {
			logger: {
				info: () => {
					throw new Error('logger failure')
				},
				error: () => {}
			},
			loader: async () => ({ A: 'value' })
		})

		expect(set.secret('A')).toBe('value')
	})

	test('Worker bindings run without an environment store and preserve isolation', async () => {
		const bindings = { A: 'first' }
		const set = await defineSecretSet(['A'], {
			...quiet,
			loader: cloudflareWorkerEnvLoader(bindings)
		})

		bindings.A = 'updated'
		await set.reload()

		expect(set.secret('A')).toBe('updated')
		expect(set.sources()).toEqual({ A: 'Cloudflare Worker bindings' })
	})
})

describe('public Vite values', () => {
	test('rejects private keys by default and exports only explicitly selected keys', async () => {
		const set = await defineSecretSet(['PRIVATE', 'VITE_PUBLIC'], {
			...quiet,
			loader: async () => ({
				PRIVATE: 'private-fixture',
				VITE_PUBLIC: 'public-fixture'
			})
		})

		expect(() => getViteDefine(set)).toThrow('VITE_')
		expect(getViteDefine(set, { publicKeys: ['VITE_PUBLIC'] })).toEqual({
			'import.meta.env.VITE_PUBLIC': '"public-fixture"'
		})
		expect(getViteDefine(set, { publicKeys: [] })).toEqual({})
	})
	test('allows VITE_ keys by default', async () => {
		const set = await defineSecretSet(['VITE_PUBLIC'], {
			...quiet,
			loader: async () => ({ VITE_PUBLIC: 'public' })
		})

		expect(getViteDefine(set)).toEqual({
			'import.meta.env.VITE_PUBLIC': '"public"'
		})
	})
})

describe('explicit initialization', () => {
	test('declaration and unreadable getters never run a loader or environment callback', async () => {
		const loader = mock(async () => ({ KEY: 'value' }))
		const environment = mock(() => 'dev' as const)
		const set = createSecretSet(['KEY'], { ...quiet, loader, environment })

		for (const read of [
			() => set.secret('KEY'),
			set.secrets,
			set.parsed,
			set.sources
		]) {
			expect(read).toThrow('Await load()')
		}

		expect(loader).not.toHaveBeenCalled()
		expect(environment).not.toHaveBeenCalled()

		await Promise.all([set.load(), set.load()])
		await set.load()

		expect(loader).toHaveBeenCalledTimes(1)
		expect(environment).toHaveBeenCalledTimes(1)
		expect(set.secret('KEY')).toBe('value')

		await set.reload()

		expect(loader).toHaveBeenCalledTimes(2)
	})

	test('retries failed initialization and validates the complete snapshot', async () => {
		let calls = 0
		const set = createSecretSet(['KEY'], {
			...quiet,
			loader: async () => (++calls === 1 ? {} : { KEY: 'valid' }),
			schema: z.object({ KEY: z.literal('valid') })
		})

		await expect(set.load()).rejects.toThrow('Missing secrets: KEY')
		expect(set.secrets).toThrow('Await load()')
		await set.load()
		expect(set.parsed()).toEqual({ KEY: 'valid' })
	})
})
