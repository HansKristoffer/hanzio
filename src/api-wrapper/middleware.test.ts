import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
	type ApiEndpoint,
	type ApiMiddleware,
	type ApiResponseError,
	createApiClient,
	defineEndpoint,
	HttpResponseError,
	isApiResponseError,
	isResponseValidationError,
	type ResponseValidationError
} from '.'
import { createMockFetch, jsonResponse } from './testing'

const getUser = {
	method: 'GET',
	path: '/users/:id',
	reqParamsSchema: z.object({ id: z.string() }),
	resSchema: z.object({ id: z.string() })
} satisfies ApiEndpoint

const ok = createMockFetch((request) =>
	jsonResponse({ id: request.url.split('/').pop() })
)

describe('URL building', () => {
	test('a full url with a port only substitutes path params', async () => {
		const fetch = createMockFetch(() => jsonResponse({ id: '7' }))
		const api = createApiClient({
			baseApiUrls: { default: 'http://unused' },
			endpoints: { getUser },
			fetch
		})

		await api.getUser({
			reqParams: { id: '7' },
			url: 'http://localhost:8001/users/:id?x=:y'
		})

		expect(fetch.calls[0]!.url).toBe('http://localhost:8001/users/7?x=:y')
	})

	test('base url with a port keeps the port', async () => {
		const fetch = createMockFetch(() => jsonResponse({ id: '1' }))
		const api = createApiClient({
			baseApiUrls: { default: 'http://localhost:8001' },
			endpoints: { getUser },
			fetch
		})

		await api.getUser({ reqParams: { id: '1' } })

		expect(fetch.calls[0]!.url).toBe('http://localhost:8001/users/1')
	})

	test('joins base and path with exactly one slash', async () => {
		const fetch = createMockFetch(() => jsonResponse({}))
		const api = createApiClient({
			baseApiUrls: { default: 'https://x.com/base/' },
			endpoints: {
				leading: { method: 'GET', path: '/users', resSchema: z.object({}) },
				bare: { method: 'GET', path: 'users', resSchema: z.object({}) },
				empty: { method: 'GET', path: '', resSchema: z.object({}) },
				query: { method: 'GET', path: '?a=1', resSchema: z.object({}) }
			},
			fetch
		})

		await api.leading()
		await api.bare()
		await api.empty()
		await api.query()

		expect(fetch.calls.map((call) => call.url)).toEqual([
			'https://x.com/base/users',
			'https://x.com/base/users',
			'https://x.com/base/',
			'https://x.com/base/?a=1'
		])
	})
})

describe('defaultHeaders', () => {
	test('a function is resolved on every request', async () => {
		let token = 0
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.test' },
			endpoints: { getUser },
			defaultHeaders: async () => ({ Authorization: `Bearer ${++token}` }),
			fetch: ok
		})

		await api.getUser({ reqParams: { id: 'a' } })
		await api.getUser({ reqParams: { id: 'b' } })

		expect(
			ok.calls.slice(-2).map((call) => call.headers.get('authorization'))
		).toEqual(['Bearer 1', 'Bearer 2'])
	})
})

describe('fetch option', () => {
	test('accepts a plain function without preconnect', async () => {
		const fetch = async (input: string | URL | Request) =>
			jsonResponse({ id: String(input).split('/').pop() })
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.test' },
			endpoints: { getUser },
			fetch
		})

		const { data } = await api.getUser({ reqParams: { id: 'z' } })
		expect(data.id).toBe('z')
	})
})

describe('use (middleware)', () => {
	test('runs in order around the whole request, including retries', async () => {
		const events: string[] = []
		let calls = 0
		const fetch = createMockFetch(() =>
			++calls === 1
				? jsonResponse({}, { status: 503 })
				: jsonResponse({ id: '1' })
		)
		const trace =
			(name: string): ApiMiddleware =>
			async (ctx, next) => {
				events.push(`${name}:start ${ctx.client}.${ctx.endpoint} ${ctx.url}`)
				const result = await next()
				events.push(`${name}:end retries=${result.retryCount}`)
				return result
			}

		const api = createApiClient({
			name: 'users',
			baseApiUrls: { default: 'https://api.test' },
			endpoints: { getUser },
			retryDelayMs: 0,
			use: [trace('outer'), trace('inner')],
			fetch
		})

		await api.getUser({ reqParams: { id: '1' } })

		expect(events).toEqual([
			'outer:start users.getUser https://api.test/users/1',
			'inner:start users.getUser https://api.test/users/1',
			'inner:end retries=1',
			'outer:end retries=1'
		])
	})

	test('sees errors after redaction and onError', async () => {
		const order: string[] = []
		let seen: unknown
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.test' },
			endpoints: { getUser },
			defaultHeaders: { Authorization: 'Bearer secret' },
			retries: 0,
			fetch: createMockFetch(() => jsonResponse({}, { status: 404 })),
			onError: () => {
				order.push('onError')
			},
			use: [
				async (_ctx, next) => {
					try {
						return await next()
					} catch (error) {
						order.push('middleware')
						seen = error
						throw error
					}
				}
			]
		})

		await expect(
			api.getUser({ reqParams: { id: '1' } })
		).rejects.toBeInstanceOf(HttpResponseError)
		expect(order).toEqual(['onError', 'middleware'])
		expect(
			(seen as HttpResponseError).context.requestHeaders?.Authorization
		).not.toBe('Bearer secret')
	})

	test('actions go through middleware via their endpoint calls', async () => {
		const endpoints: string[] = []
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.test' },
			endpoints: { getUser },
			fetch: ok,
			use: [
				(ctx, next) => {
					endpoints.push(ctx.endpoint)
					return next()
				}
			],
			actions: ({ defineAction }) => ({
				getTwo: defineAction({
					handler: async ({ api }) => {
						await api.getUser({ reqParams: { id: '1' } })
						await api.getUser({ reqParams: { id: '2' } })
					}
				})
			})
		})

		await api.getTwo()
		expect(endpoints).toEqual(['getUser', 'getUser'])
	})
})

describe('checkResponse', () => {
	const envelope = {
		method: 'GET',
		path: '/thing',
		resSchema: z.object({ success: z.boolean(), errors: z.array(z.string()) })
	} satisfies ApiEndpoint

	const checkResponse = (data: unknown) => {
		const body = data as { success: boolean; errors: string[] }
		if (!body.success) throw new Error(body.errors.join(', '))
	}

	test('wraps a rejected 200 as ApiResponseError with context and calls onError', async () => {
		let reported: unknown
		const fetch = createMockFetch(() =>
			jsonResponse({ success: false, errors: ['quota exceeded'] })
		)
		const api = createApiClient({
			name: 'cf',
			baseApiUrls: { default: 'https://api.test' },
			endpoints: { envelope },
			checkResponse,
			fetch,
			onError: (error) => {
				reported = error
			}
		})

		const error = await api.envelope().catch((e: unknown) => e)

		expect(isApiResponseError(error)).toBe(true)
		expect((error as ApiResponseError).message).toBe('quota exceeded')
		expect((error as ApiResponseError).context.endpoint).toBe('cf.envelope')
		expect((error as ApiResponseError).data).toEqual({
			success: false,
			errors: ['quota exceeded']
		})
		expect(reported).toBe(error)
		expect(fetch.calls).toHaveLength(1)
	})

	test('is not retried by default but a custom shouldRetry can opt in', async () => {
		let calls = 0
		const fetch = createMockFetch(() =>
			jsonResponse(
				++calls < 3
					? { success: false, errors: ['busy'] }
					: { success: true, errors: [] }
			)
		)
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.test' },
			endpoints: { envelope },
			checkResponse,
			retryDelayMs: 0,
			shouldRetry: ({ error }) => isApiResponseError(error),
			fetch
		})

		const { data, retryCount } = await api.envelope()
		expect(data.success).toBe(true)
		expect(retryCount).toBe(2)
	})

	test('passes successful responses through unchanged', async () => {
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.test' },
			endpoints: { envelope },
			checkResponse,
			fetch: createMockFetch(() => jsonResponse({ success: true, errors: [] }))
		})

		expect((await api.envelope()).data).toEqual({ success: true, errors: [] })
	})

	describe('per endpoint', () => {
		const plain = {
			method: 'GET',
			path: '/plain',
			resSchema: z.object({ id: z.string() })
		} satisfies ApiEndpoint
		const client = (endpoints: Record<string, ApiEndpoint>) => {
			const fetch = createMockFetch(() =>
				jsonResponse({ id: 'a' }, { status: 200 })
			)
			const api = createApiClient({
				baseApiUrls: { default: 'https://api.test' },
				endpoints,
				checkResponse,
				fetch
			})
			return { api, fetch }
		}

		test('false skips the client check', async () => {
			const { api } = client({ plain: { ...plain, checkResponse: false } })
			expect((await api.request('plain')).data).toEqual({ id: 'a' })
		})

		test('absent uses the client check', async () => {
			const { api } = client({ plain })
			expect(
				await api.request('plain').catch((e: unknown) => e)
			).toBeInstanceOf(Error)
		})

		test('a function replaces the client check and is not retried', async () => {
			const seen: unknown[] = []
			const { api, fetch } = client({
				plain: {
					...plain,
					checkResponse: (data, ctx) => {
						seen.push(data, ctx.endpoint)
						throw new Error('no thanks')
					}
				}
			})

			const error = await api.request('plain').catch((e: unknown) => e)

			expect(isApiResponseError(error)).toBe(true)
			expect((error as ApiResponseError).message).toBe('no thanks')
			expect(seen).toEqual([{ id: 'a' }, 'plain'])
			expect(fetch.calls).toHaveLength(1)
		})
	})
})

describe('result in headers', () => {
	test('resFormatter reads headers and the response exposes them', async () => {
		const tusUploadPost = defineEndpoint({
			method: 'POST',
			path: '',
			reqDefaultQueryParams: { direct_user: 'true' },
			defaultHeaders: { 'Tus-Resumable': '1.0.0' },
			reqHeadersSchema: z.object({
				'Upload-Length': z.string(),
				'Upload-Metadata': z.string()
			}),
			resSchema: z.object({ tusEndpoint: z.string(), videoId: z.string() }),
			resFormatter: (_body, headers) => ({
				tusEndpoint: headers.location!,
				videoId: headers['stream-media-id']!
			}),
			checkResponse: false
		})
		const fetch = createMockFetch(
			() =>
				new Response(null, {
					status: 201,
					headers: { Location: 'https://tus.test/1', 'Stream-Media-Id': 'v1' }
				})
		)
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.test/accounts/1/stream' },
			endpoints: { tusUploadPost },
			checkResponse: () => {
				throw new Error('envelope missing')
			},
			fetch
		})

		const res = await api.tusUploadPost({
			reqHeaders: { 'Upload-Length': '10', 'Upload-Metadata': 'name dGVzdA==' }
		})

		expect(res.data).toEqual({
			tusEndpoint: 'https://tus.test/1',
			videoId: 'v1'
		})
		expect(res.headers['stream-media-id']).toBe('v1')
		const request = fetch.calls[0]!
		expect(request.url).toBe(
			'https://api.test/accounts/1/stream?direct_user=true'
		)
		expect(request.headers.get('tus-resumable')).toBe('1.0.0')
		expect(request.headers.get('upload-length')).toBe('10')
	})

	test('a missing header is an output validation error', async () => {
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.test' },
			endpoints: {
				created: defineEndpoint({
					method: 'POST',
					path: '',
					resSchema: z.object({ videoId: z.string() }),
					resFormatter: (_body, headers) => ({
						videoId: headers['stream-media-id']!
					})
				})
			},
			retries: 0,
			fetch: createMockFetch(() => new Response(null, { status: 201 }))
		})

		const error = await api.created().catch((e: unknown) => e)
		expect(isResponseValidationError(error)).toBe(true)
		expect((error as ResponseValidationError).category).toBe(
			'output_validation'
		)
	})
})

describe('createMockFetch', () => {
	test('records requests with readable bodies', async () => {
		const fetch = createMockFetch(() => jsonResponse({ ok: true }))
		await fetch('https://api.test/a', { method: 'POST', body: '{"x":1}' })

		expect(fetch.calls[0]!.method).toBe('POST')
		expect(await fetch.calls[0]!.json()).toEqual({ x: 1 })
	})
})
