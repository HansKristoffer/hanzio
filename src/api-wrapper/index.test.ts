import { afterEach, describe, expect, mock, test } from 'bun:test'
import { z } from 'zod'
import { createApiClient, HttpResponseError, ResponseValidationError } from '.'

const originalFetch = globalThis.fetch

const createMockResponse = (
	body: unknown,
	options: { status?: number; contentType?: string } = {}
) => {
	const { status = 200, contentType = 'application/json' } = options
	return new Response(
		contentType.includes('application/json')
			? JSON.stringify(body)
			: String(body),
		{
			status,
			headers: { 'content-type': contentType }
		}
	)
}

const mockFetch = (
	fn: (url: string, options?: RequestInit) => Promise<Response>
) => {
	globalThis.fetch = mock(fn) as unknown as typeof fetch
}

describe('createApiClient', () => {
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

		const assertRequestParamTypes = async () => {
			// @ts-expect-error endpoint request params are inferred from reqParamsSchema.
			await api.request('getUser', { reqParams: { id: '1' } })
		}

		expect(assertRequestParamTypes).toBeInstanceOf(Function)
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

	test('throws for unknown endpoints', async () => {
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			endpoints: {}
		})

		// @ts-expect-error testing runtime behavior for invalid endpoint keys
		await expect(api.request('missing')).rejects.toThrow('Unknown API endpoint')
	})
})
