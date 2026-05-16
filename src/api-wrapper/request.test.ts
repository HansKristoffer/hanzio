import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
	createApiClient,
	HttpResponseError,
	type ApiError,
	isApiError
} from '.'
import { createMockResponse, mockFetch, originalFetch } from './test-helpers'

describe('createApiClient — request & hooks', () => {
	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	test('makes a typed GET request and validates the response', async () => {
		mockFetch(() => Promise.resolve(createMockResponse({ id: 1, name: 'Ada' })))

		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			endpoints: {
				getUser: {
					method: 'GET',
					path: '/users/:id',
					reqParamsSchema: z.object({ id: z.number() }),
					resSchema: z.object({ id: z.number(), name: z.string() })
				}
			}
		})

		const result = await api.request('getUser', { reqParams: { id: 1 } })
		const typedData: { id: number; name: string } = result.data

		expect(typedData).toEqual({ id: 1, name: 'Ada' })
		expect(result.httpStatus).toBe(200)
		expect(globalThis.fetch).toHaveBeenCalledWith(
			'https://api.example.com/users/1',
			expect.objectContaining({ method: 'GET' })
		)
	})

	test('sends JSON bodies and query params', async () => {
		let capturedUrl = ''
		let capturedBody: RequestInit['body']
		mockFetch((url, options) => {
			capturedUrl = url
			capturedBody = options?.body
			return Promise.resolve(createMockResponse({ ok: true }))
		})

		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			endpoints: {
				createUser: {
					method: 'POST',
					path: '/users',
					reqBodyFormat: 'json',
					reqBodySchema: z.object({ name: z.string() }),
					reqQuerySchema: z.object({ dryRun: z.boolean() }),
					resSchema: z.object({ ok: z.boolean() })
				}
			}
		})

		await api.request('createUser', {
			reqBody: { name: 'Ada' },
			reqQuery: { dryRun: true }
		})

		expect(capturedUrl).toBe('https://api.example.com/users?dryRun=true')
		expect(capturedBody).toBe(JSON.stringify({ name: 'Ada' }))
	})

	test('does not manually set multipart content type for FormData', async () => {
		let capturedHeaders: RequestInit['headers']
		let capturedBody: RequestInit['body']
		mockFetch((_url, options) => {
			capturedHeaders = options?.headers
			capturedBody = options?.body
			return Promise.resolve(createMockResponse({ ok: true }))
		})

		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			endpoints: {
				upload: {
					method: 'POST',
					path: '/upload',
					reqBodyFormat: 'form-data',
					reqBodySchema: z.object({ name: z.string() }),
					resSchema: z.object({ ok: z.boolean() })
				}
			}
		})

		await api.request('upload', { reqBody: { name: 'file.txt' } })

		expect(capturedBody).toBeInstanceOf(FormData)
		expect(capturedHeaders).not.toEqual(
			expect.objectContaining({ 'Content-Type': 'multipart/form-data' })
		)
	})

	test('onRequest can mutate headers and body; onError fires on failure', async () => {
		let capturedHeaders: RequestInit['headers']
		let capturedBody: RequestInit['body']
		mockFetch((_url, options) => {
			capturedHeaders = options?.headers
			capturedBody = options?.body
			return Promise.resolve(
				new Response('boom', {
					status: 500,
					headers: { 'content-type': 'text/plain' }
				})
			)
		})

		const errors: ApiError[] = []
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			retries: 0,
			onRequest: ({ headers }) => ({
				headers: { ...headers, Authorization: 'Bearer token' },
				body: { name: 'override' }
			}),
			onError: (err) => {
				errors.push(err)
			},
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

		await expect(
			api.request('createUser', { reqBody: { name: 'orig' } })
		).rejects.toBeInstanceOf(HttpResponseError)
		expect(capturedBody).toBe(JSON.stringify({ name: 'override' }))
		expect((capturedHeaders as Record<string, string>).Authorization).toBe(
			'Bearer token'
		)
		expect(errors).toHaveLength(1)
		expect(isApiError(errors[0])).toBe(true)
	})

	test('proxy-based endpoint helpers call request', async () => {
		mockFetch(() => Promise.resolve(createMockResponse({ id: 7, name: 'Z' })))

		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			endpoints: {
				getUser: {
					method: 'GET',
					path: '/users/:id',
					reqParamsSchema: z.object({ id: z.number() }),
					resSchema: z.object({ id: z.number(), name: z.string() })
				}
			}
		})

		const result = await api.getUser({ reqParams: { id: 7 } })
		expect(result.data).toEqual({ id: 7, name: 'Z' })
	})

	test('throws for unknown endpoints', async () => {
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			endpoints: {}
		})

		await expect(
			(api.request as (key: string) => Promise<unknown>)('missing')
		).rejects.toThrow('Unknown API endpoint')
	})
})
