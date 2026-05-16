import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
	createApiClient,
	type HttpResponseError,
	isHttpResponseError,
	RequestValidationError,
	ResponseValidationError
} from '.'
import { createMockResponse, mockFetch, originalFetch } from './test-helpers'

describe('createApiClient — validation & HTTP errors', () => {
	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	test('throws ResponseValidationError for invalid responses', async () => {
		mockFetch(() => Promise.resolve(createMockResponse({ id: 'bad' })))

		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			endpoints: {
				getUser: {
					method: 'GET',
					path: '/users/1',
					resSchema: z.object({ id: z.number() })
				}
			}
		})

		await expect(api.request('getUser')).rejects.toThrow(
			ResponseValidationError
		)
	})

	test('ResponseValidationError gives rich, structured issue context', async () => {
		mockFetch(() =>
			Promise.resolve(
				createMockResponse({
					id: 'oops',
					tags: ['a', 42, 'c'],
					nested: { count: 'not-a-number' }
				})
			)
		)

		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			endpoints: {
				getThing: {
					method: 'GET',
					path: '/thing',
					resSchema: z.object({
						id: z.number(),
						tags: z.array(z.string()),
						nested: z.object({ count: z.number() })
					})
				}
			}
		})

		try {
			await api.request('getThing')
			throw new Error('expected throw')
		} catch (err) {
			expect(err).toBeInstanceOf(ResponseValidationError)
			const e = err as ResponseValidationError
			const byPath = Object.fromEntries(e.issues.map((i) => [i.path, i]))

			expect(byPath.id).toBeDefined()
			expect(byPath.id!.received).toBe('string')
			expect(byPath.id!.expected).toBeDefined()
			expect(byPath.id!.value).toBe('oops')
			expect(byPath.id!.valuePreview).toBe('"oops"')

			expect(byPath['tags[1]']).toBeDefined()
			expect(byPath['tags[1]']!.value).toBe(42)

			expect(byPath['nested.count']).toBeDefined()
			expect(byPath['nested.count']!.value).toBe('not-a-number')

			expect(e.message).toContain('Response validation failed')
			expect(e.message).toContain('id')
			expect(e.message).toContain('value:')
			expect(e.context.url).toBe('https://api.example.com/thing')

			const json = e.toJSON()
			expect(Array.isArray(json.issues)).toBe(true)
		}
	})

	test('ResponseValidationError fires when response body is not valid JSON', async () => {
		mockFetch(() =>
			Promise.resolve(
				new Response('<html>oops</html>', {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			)
		)

		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			retries: 0,
			endpoints: {
				getThing: {
					method: 'GET',
					path: '/thing',
					resSchema: z.object({ ok: z.boolean() })
				}
			}
		})

		try {
			await api.request('getThing')
			throw new Error('expected throw')
		} catch (err) {
			expect(err).toBeInstanceOf(ResponseValidationError)
			expect((err as ResponseValidationError).message).toContain(
				'not valid JSON'
			)
		}
	})

	test('RequestValidationError includes the offending input value', async () => {
		mockFetch(() => Promise.resolve(createMockResponse({ ok: true })))

		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			endpoints: {
				createUser: {
					method: 'POST',
					path: '/users',
					reqBodyFormat: 'json',
					reqBodySchema: z.object({
						name: z.string(),
						age: z.number()
					}),
					resSchema: z.object({ ok: z.boolean() })
				}
			}
		})

		try {
			await api.request('createUser', {
				reqBody: {
					name: 123 as unknown as string,
					age: 'old' as unknown as number
				}
			})
			throw new Error('expected throw')
		} catch (err) {
			expect(err).toBeInstanceOf(RequestValidationError)
			const e = err as RequestValidationError
			expect(e.target).toBe('body')
			const paths = e.issues.map((i) => i.path)
			expect(paths).toContain('name')
			expect(paths).toContain('age')
			const nameIssue = e.issues.find((i) => i.path === 'name')!
			expect(nameIssue.value).toBe(123)
			expect(nameIssue.received).toBe('number')
			expect(e.message).toContain('Request body validation failed')
		}
	})

	test('HttpResponseError carries request context, headers, and parsed body', async () => {
		mockFetch(() =>
			Promise.resolve(
				new Response(JSON.stringify({ error: { code: 'nope' } }), {
					status: 404,
					headers: {
						'content-type': 'application/json',
						'x-request-id': 'req-123'
					}
				})
			)
		)

		const api = createApiClient({
			name: 'svc',
			baseApiUrls: { default: 'https://api.example.com' },
			endpoints: {
				getItem: {
					method: 'GET',
					path: '/items/:id',
					reqParamsSchema: z.object({ id: z.number() }),
					resSchema: z.object({ ok: z.boolean() })
				}
			}
		})

		try {
			await api.request('getItem', { reqParams: { id: 9 } })
			throw new Error('expected throw')
		} catch (err) {
			expect(isHttpResponseError(err)).toBe(true)
			const e = err as HttpResponseError
			expect(e.status).toBe(404)
			expect(e.requestId).toBe('req-123')
			expect(e.bodyJson).toEqual({ error: { code: 'nope' } })
			expect(e.context.endpoint).toBe('svc.getItem')
			expect(e.context.method).toBe('GET')
			expect(e.context.url).toBe('https://api.example.com/items/9')
			expect(e.context.attempt).toBeGreaterThanOrEqual(0)
			expect(e.toJSON()).toMatchObject({
				name: 'HttpResponseError',
				status: 404,
				requestId: 'req-123'
			})
		}
	})

	test('throws RequestValidationError for bad request body/query', async () => {
		mockFetch(() => Promise.resolve(createMockResponse({ ok: true })))

		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			endpoints: {
				createUser: {
					method: 'POST',
					path: '/users',
					reqBodyFormat: 'json',
					reqBodySchema: z.object({ name: z.string() }),
					resSchema: z.object({ ok: z.boolean() })
				}
			}
		})

		try {
			await api.request('createUser', {
				reqBody: { name: 123 as unknown as string }
			})
			throw new Error('expected throw')
		} catch (err) {
			expect(err).toBeInstanceOf(RequestValidationError)
			expect((err as RequestValidationError).target).toBe('body')
		}
	})
})
