import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { z } from 'zod'
import {
	createApiClient,
	defineEndpoint,
	HttpResponseError,
	RequestAbortedError,
	RequestTimeoutError,
	ResponseValidationError
} from '.'
import { createMockResponse, mockFetch, originalFetch } from './test-helpers'
import { createMockFetch, jsonResponse } from './testing'
import { defaultShouldRetry, getRetryDelay } from './transport'

describe('createApiClient — retries & transport', () => {
	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	test('retries server errors by default but not client errors', async () => {
		let callCount = 0
		mockFetch(() => {
			callCount++
			if (callCount === 1) {
				return Promise.resolve(createMockResponse({}, { status: 500 }))
			}
			return Promise.resolve(createMockResponse({ ok: true }))
		})

		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			retryDelayMs: 0,
			endpoints: {
				getData: {
					method: 'GET',
					path: '/data',
					resSchema: z.object({ ok: z.boolean() })
				}
			}
		})

		const result = await api.request('getData')
		expect(result.retryCount).toBe(1)
		expect(callCount).toBe(2)

		mockFetch(() =>
			Promise.resolve(createMockResponse({ error: 'nope' }, { status: 404 }))
		)

		await expect(api.request('getData')).rejects.toBeInstanceOf(
			HttpResponseError
		)
		expect(globalThis.fetch).toHaveBeenCalledTimes(1)
	})

	test('RequestTimeoutError fires when request exceeds timeoutMs', async () => {
		mockFetch(
			(_url, options) =>
				new Promise((_resolve, reject) => {
					options?.signal?.addEventListener('abort', () => {
						const e = new Error('aborted')
						e.name = 'AbortError'
						reject(e)
					})
				})
		)

		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			timeoutMs: 10,
			retries: 0,
			endpoints: {
				slow: {
					method: 'GET',
					path: '/slow',
					resSchema: z.object({}).passthrough()
				}
			}
		})

		await expect(api.request('slow')).rejects.toBeInstanceOf(
			RequestTimeoutError
		)
	})

	test('user-provided signal cancels and does not retry', async () => {
		let callCount = 0
		mockFetch(
			(_url, options) =>
				new Promise((_resolve, reject) => {
					callCount++
					options?.signal?.addEventListener('abort', () => {
						const e = new Error('aborted')
						e.name = 'AbortError'
						reject(e)
					})
				})
		)

		const controller = new AbortController()
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			retries: 3,
			retryDelayMs: 0,
			endpoints: {
				getThing: {
					method: 'GET',
					path: '/thing',
					resSchema: z.object({}).passthrough()
				}
			}
		})

		const promise = api.request('getThing', { signal: controller.signal })
		setTimeout(() => controller.abort(), 5)
		await expect(promise).rejects.toBeInstanceOf(RequestAbortedError)
		expect(callCount).toBe(1)
	})

	test('respects Retry-After header on 429', async () => {
		const timestamps: number[] = []
		let calls = 0
		mockFetch(() => {
			timestamps.push(Date.now())
			calls++
			if (calls === 1) {
				return Promise.resolve(
					new Response('rate limited', {
						status: 429,
						headers: { 'retry-after': '0' }
					})
				)
			}
			return Promise.resolve(createMockResponse({ ok: true }))
		})

		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			retryDelayMs: 9999,
			endpoints: {
				ping: {
					method: 'GET',
					path: '/ping',
					resSchema: z.object({ ok: z.boolean() })
				}
			}
		})

		const result = await api.request('ping')
		expect(result.retryCount).toBe(1)
		// retry-after of 0 should beat the configured 9999ms delay.
		expect(timestamps[1]! - timestamps[0]!).toBeLessThan(500)
	})

	test('does not retry response validation errors', async () => {
		let calls = 0
		mockFetch(() => {
			calls++
			return Promise.resolve(createMockResponse({ id: 'wrong' }))
		})

		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			retries: 5,
			retryDelayMs: 0,
			endpoints: {
				getUser: {
					method: 'GET',
					path: '/user',
					resSchema: z.object({ id: z.number() })
				}
			}
		})

		await expect(api.request('getUser')).rejects.toBeInstanceOf(
			ResponseValidationError
		)
		expect(calls).toBe(1)
	})

	test('validation errors after retries include the correct attempt count', async () => {
		let calls = 0
		mockFetch(() => {
			calls++
			if (calls < 3) {
				return Promise.resolve(createMockResponse({}, { status: 500 }))
			}
			return Promise.resolve(createMockResponse({ id: 'wrong' }))
		})

		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			retryDelayMs: 0,
			endpoints: {
				getUser: {
					method: 'GET',
					path: '/user',
					resSchema: z.object({ id: z.number() })
				}
			}
		})

		try {
			await api.request('getUser')
			throw new Error('expected throw')
		} catch (err) {
			expect(err).toBeInstanceOf(ResponseValidationError)
			expect((err as ResponseValidationError).context.attempt).toBe(2)
		}
		expect(calls).toBe(3)
	})

	test('onRetry is invoked with retry context', async () => {
		let calls = 0
		mockFetch(() => {
			calls++
			if (calls < 3) {
				return Promise.resolve(createMockResponse({}, { status: 500 }))
			}
			return Promise.resolve(createMockResponse({ ok: true }))
		})

		const retries: number[] = []
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			retryDelayMs: 0,
			onRetry: (ctx) => {
				retries.push(ctx.nextAttempt)
			},
			endpoints: {
				get: {
					method: 'GET',
					path: '/x',
					resSchema: z.object({ ok: z.boolean() })
				}
			}
		})

		await api.request('get')
		expect(retries).toEqual([1, 2])
	})

	test('default retry delay is exponential backoff with jitter', async () => {
		let calls = 0
		mockFetch(() => {
			calls++
			if (calls < 4) {
				return Promise.resolve(createMockResponse({}, { status: 500 }))
			}
			return Promise.resolve(createMockResponse({ ok: true }))
		})

		const delays: number[] = []
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			onRetry: (ctx) => {
				delays.push(ctx.delayMs)
			},
			endpoints: {
				get: {
					method: 'GET',
					path: '/x',
					resSchema: z.object({ ok: z.boolean() })
				}
			}
		})

		// Full jitter scales 300 * 2^n by Math.random(); 0.01 keeps the test fast.
		const random = spyOn(Math, 'random').mockReturnValue(0.01)
		try {
			await api.request('get')
		} finally {
			random.mockRestore()
		}
		expect(delays).toEqual([3, 6, 12])
	})

	test('aborting during the retry sleep throws RequestAbortedError', async () => {
		let calls = 0
		mockFetch(() => {
			calls++
			return Promise.resolve(createMockResponse({}, { status: 500 }))
		})

		const controller = new AbortController()
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			retryDelayMs: 10_000,
			onRetry: () => {
				setTimeout(() => controller.abort(), 5)
			},
			endpoints: {
				get: {
					method: 'GET',
					path: '/x',
					resSchema: z.object({ ok: z.boolean() })
				}
			}
		})

		const startedAt = Date.now()
		await expect(
			api.request('get', { signal: controller.signal })
		).rejects.toBeInstanceOf(RequestAbortedError)
		expect(Date.now() - startedAt).toBeLessThan(1000)
		expect(calls).toBe(1)
	})

	test('invalid Retry-After falls back to the configured delay and cap', () => {
		for (const status of [429, 503]) {
			const response = new Response('', {
				status,
				headers: { 'retry-after': 'invalid' }
			})
			expect(getRetryDelay({ response, attempt: 2, retryDelay: 2000 })).toBe(
				2000
			)
			expect(
				getRetryDelay({
					response,
					attempt: 2,
					retryDelay: (attempt) => attempt * 1000
				})
			).toBe(2000)
			expect(
				getRetryDelay({
					response,
					attempt: 2,
					retryDelay: 2000,
					maxRetryDelayMs: 500
				})
			).toBe(500)
		}
	})

	test('caps Retry-After delay to maxRetryDelayMs', async () => {
		const timestamps: number[] = []
		let calls = 0
		mockFetch(() => {
			timestamps.push(Date.now())
			calls++
			if (calls === 1) {
				return Promise.resolve(
					new Response('rate limited', {
						status: 429,
						headers: { 'retry-after': '3600' }
					})
				)
			}
			return Promise.resolve(createMockResponse({ ok: true }))
		})

		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			maxRetryDelayMs: 50,
			endpoints: {
				ping: {
					method: 'GET',
					path: '/ping',
					resSchema: z.object({ ok: z.boolean() })
				}
			}
		})

		const result = await api.request('ping')
		expect(result.retryCount).toBe(1)
		expect(timestamps[1]! - timestamps[0]!).toBeLessThan(500)
	})

	test('error context url matches the actual request url including query params', async () => {
		mockFetch(() =>
			Promise.resolve(createMockResponse({ error: 'nope' }, { status: 404 }))
		)

		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			retries: 0,
			endpoints: {
				search: {
					method: 'GET',
					path: '/search',
					reqQuerySchema: z.object({ q: z.string() }),
					resSchema: z.object({ ok: z.boolean() })
				}
			}
		})

		try {
			await api.request('search', { reqQuery: { q: 'hello world' } })
			throw new Error('expected throw')
		} catch (err) {
			expect(err).toBeInstanceOf(HttpResponseError)
			expect((err as HttpResponseError).context.url).toBe(
				'https://api.example.com/search?q=hello+world'
			)
			expect(globalThis.fetch).toHaveBeenCalledWith(
				'https://api.example.com/search?q=hello+world',
				expect.anything()
			)
		}
	})
})

// Sends headers and the first chunk, then never finishes the body.
const stalledBody = () =>
	new Response(
		new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"ok":'))
			}
		}),
		{ headers: { 'content-type': 'application/json' } }
	)

const okEndpoint = {
	method: 'GET',
	path: '/x',
	resSchema: z.object({ ok: z.boolean() })
} as const

describe('timeoutMs covers the response body', () => {
	test('a stalled body throws RequestTimeoutError', async () => {
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.test' },
			timeoutMs: 30,
			retries: 0,
			fetch: createMockFetch(() => stalledBody()),
			endpoints: { get: okEndpoint }
		})

		const startedAt = Date.now()
		await expect(api.get()).rejects.toBeInstanceOf(RequestTimeoutError)
		expect(Date.now() - startedAt).toBeLessThan(500)
	})

	test('a stalled body from a real server is retried like any timeout', async () => {
		let calls = 0
		const server = Bun.serve({
			port: 0,
			fetch: () =>
				++calls === 1
					? new Response(
							new ReadableStream({
								async pull(controller) {
									controller.enqueue(new TextEncoder().encode('{"ok":'))
									await Bun.sleep(2000)
								}
							}),
							{ headers: { 'content-type': 'application/json' } }
						)
					: Response.json({ ok: true })
		})
		try {
			const api = createApiClient({
				baseApiUrls: { default: server.url.origin },
				timeoutMs: 100,
				retryDelayMs: 0,
				endpoints: { get: okEndpoint }
			})
			const result = await api.get()
			expect(result.data).toEqual({ ok: true })
			expect(result.retryCount).toBe(1)
		} finally {
			server.stop(true)
		}
	})

	test('aborting during the body read throws RequestAbortedError', async () => {
		const controller = new AbortController()
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.test' },
			timeoutMs: 5000,
			fetch: createMockFetch(() => {
				setTimeout(() => controller.abort(), 5)
				return stalledBody()
			}),
			endpoints: { get: okEndpoint }
		})

		await expect(api.get({ signal: controller.signal })).rejects.toBeInstanceOf(
			RequestAbortedError
		)
	})

	test('the timer stops once the attempt is done', async () => {
		const signals: AbortSignal[] = []
		const fetch = async (
			_input: string | URL | Request,
			init?: RequestInit
		) => {
			signals.push(init!.signal!)
			return signals.length === 1
				? jsonResponse({}, { status: 404 })
				: jsonResponse({ ok: true })
		}
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.test' },
			timeoutMs: 20,
			fetch,
			endpoints: { get: okEndpoint }
		})

		await expect(api.get()).rejects.toBeInstanceOf(HttpResponseError)
		await api.get()
		await Bun.sleep(40)
		expect(signals.map((signal) => signal.aborted)).toEqual([false, false])
	})
})

test('a response that will be retried has its body cancelled', async () => {
	let cancelled = false
	const api = createApiClient({
		baseApiUrls: { default: 'https://api.test' },
		retryDelayMs: 0,
		fetch: createMockFetch([
			new Response(
				new ReadableStream({
					cancel() {
						cancelled = true
					}
				}),
				{ status: 503 }
			),
			jsonResponse({ ok: true })
		]),
		endpoints: { get: okEndpoint }
	})

	await api.get()
	expect(cancelled).toBe(true)
})

describe('idempotent', () => {
	const post = { ...okEndpoint, method: 'POST' } as const
	const client = (
		fetch: ReturnType<typeof createMockFetch>,
		endpoint: { method: 'POST' | 'PATCH'; idempotent?: boolean }
	) =>
		createApiClient({
			baseApiUrls: { default: 'https://api.test' },
			retryDelayMs: 0,
			timeoutMs: 20,
			fetch,
			endpoints: { send: { ...okEndpoint, ...endpoint } }
		})

	test('POST and PATCH are not retried on 5xx, network errors or timeouts', async () => {
		for (const method of ['POST', 'PATCH'] as const) {
			const fetch = createMockFetch([jsonResponse({}, { status: 503 })])
			await expect(client(fetch, { method }).send()).rejects.toBeInstanceOf(
				HttpResponseError
			)
			expect(fetch.calls).toHaveLength(1)
		}

		const failing = createMockFetch(() => {
			throw new TypeError('connection reset')
		})
		await expect(client(failing, post).send()).rejects.toThrow(
			'connection reset'
		)
		expect(failing.calls).toHaveLength(1)

		const stalled = createMockFetch(() => stalledBody())
		await expect(client(stalled, post).send()).rejects.toBeInstanceOf(
			RequestTimeoutError
		)
		expect(stalled.calls).toHaveLength(1)
	})

	test('POST is retried on 429', async () => {
		const fetch = createMockFetch([
			jsonResponse({}, { status: 429 }),
			jsonResponse({ ok: true })
		])
		const result = await client(fetch, post).send()
		expect(result.retryCount).toBe(1)
	})

	test('idempotent: true gives POST the full policy', async () => {
		const fetch = createMockFetch([
			jsonResponse({}, { status: 503 }),
			() => {
				throw new TypeError('connection reset')
			},
			jsonResponse({ ok: true })
		])
		const contexts: boolean[] = []
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.test' },
			retryDelayMs: 0,
			fetch,
			onRetry: (ctx) => {
				contexts.push(ctx.idempotent!)
			},
			endpoints: {
				send: defineEndpoint({ ...post, idempotent: true })
			}
		})
		const result = await api.send()
		expect(result.retryCount).toBe(2)
		expect(contexts).toEqual([true, true])
	})

	test('a custom shouldRetry overrides the method default', async () => {
		const fetch = createMockFetch([
			jsonResponse({}, { status: 503 }),
			jsonResponse({ ok: true })
		])
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.test' },
			retryDelayMs: 0,
			fetch,
			shouldRetry: () => true,
			endpoints: { send: post }
		})
		expect((await api.send()).retryCount).toBe(1)
	})

	test('defaultShouldRetry reads the method when idempotent is unset', () => {
		const response = new Response(null, { status: 500 })
		const base = { response, retryCount: 0, maxRetries: 3 }
		expect(defaultShouldRetry({ ...base, method: 'POST' })).toBe(false)
		expect(defaultShouldRetry({ ...base, method: 'PUT' })).toBe(true)
		expect(
			defaultShouldRetry({ ...base, method: 'POST', idempotent: true })
		).toBe(true)
	})
})
