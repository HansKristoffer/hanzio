import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
	createApiClient,
	HttpResponseError,
	RequestAbortedError,
	RequestTimeoutError,
	ResponseValidationError
} from '.'
import { createMockResponse, mockFetch, originalFetch } from './test-helpers'

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
})
