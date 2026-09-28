import { describe, expect, test } from 'bun:test'
import { context, propagation, type Tracer, trace } from '@opentelemetry/api'
import { z } from 'zod'
import {
	type ApiEndpoint,
	createApiClient,
	describeApiError,
	isApiError,
	type OtelSpanLike,
	type OtelTracerLike,
	otelMiddleware
} from '.'
import { createMockFetch, jsonResponse } from './testing'

const getUser = {
	method: 'GET',
	path: '/users/:id',
	reqParamsSchema: z.object({ id: z.string().min(1) }),
	resSchema: z.object({ id: z.string(), age: z.number() })
} satisfies ApiEndpoint

type LoggedError = { message: string; attributes: Record<string, unknown> }

function clientWith(response: () => Response) {
	const logged: LoggedError[] = []
	const debug: unknown[] = []
	const api = createApiClient({
		name: 'users',
		baseApiUrls: { default: 'https://api.test' },
		endpoints: { getUser },
		defaultHeaders: { Authorization: 'Bearer secret-token' },
		retries: 0,
		fetch: createMockFetch(response),
		logger: {
			debug: (...args: unknown[]) => debug.push(args),
			error: (message: string, attributes: Record<string, unknown>) =>
				logged.push({ message, attributes })
		}
	})
	return { api, logged, debug }
}

describe('failure logging', () => {
	test('server errors say the API failed and show the response body', async () => {
		const { api, logged } = clientWith(() =>
			jsonResponse({ error: 'database down' }, { status: 503 })
		)
		await api.getUser({ reqParams: { id: '1' } }).catch(() => {})

		expect(logged[0]!.message).toStartWith(
			'✗ users.getUser failed: server error (HTTP 503)'
		)
		expect(logged[0]!.message).toContain('GET https://api.test/users/1')
		expect(logged[0]!.message).toContain('database down')
		expect(logged[0]!.attributes).toMatchObject({
			category: 'server_error',
			status: 503,
			endpoint: 'users.getUser'
		})
	})

	test('4xx errors point at the request', async () => {
		const { api, logged } = clientWith(() => jsonResponse({}, { status: 404 }))
		await api.getUser({ reqParams: { id: '1' } }).catch(() => {})

		expect(logged[0]!.message).toContain(
			'request rejected (HTTP 404): check the path'
		)
		expect(logged[0]!.attributes.category).toBe('client_error')
	})

	test('input validation says nothing was sent and names the schema', async () => {
		const fetch = createMockFetch(() => jsonResponse({}))
		const logged: string[] = []
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.test' },
			endpoints: { getUser },
			fetch,
			logger: {
				debug: () => {},
				error: (message: string) => logged.push(message)
			}
		})

		await api.getUser({ reqParams: { id: '' } }).catch(() => {})

		expect(fetch.calls).toHaveLength(0)
		expect(logged[0]).toContain(
			"input validation failed: the caller's params doesn't match reqParamsSchema (nothing was sent)"
		)
		expect(logged[0]).toContain('[1] id:')
		expect(logged[0]).toContain('GET /users/:id')
		expect(logged[0]).not.toContain('attempt')
	})

	test('output validation lists the mismatched fields and a fix', async () => {
		const { api, logged } = clientWith(() =>
			jsonResponse({ id: '1', age: 'old' })
		)
		await api.getUser({ reqParams: { id: '1' } }).catch(() => {})

		const { message, attributes } = logged[0]!
		expect(message).toContain(
			"output validation failed: the response doesn't match resSchema"
		)
		expect(message).toContain('[1] age:')
		expect(message).toContain('value: "old"')
		expect(message).toContain('fix: update resSchema')
		expect(attributes).toMatchObject({
			category: 'output_validation',
			issueCount: 1
		})
	})

	test('invalid JSON is reported as such', async () => {
		const { api, logged } = clientWith(
			() =>
				new Response('<html>oops</html>', {
					headers: { 'content-type': 'application/json' }
				})
		)
		await api.getUser({ reqParams: { id: '1' } }).catch(() => {})

		expect(logged[0]!.message).toContain('the response body is not valid JSON')
	})

	test('secrets stay out of logs, messages and debug output', async () => {
		const { api, logged, debug } = clientWith(() =>
			jsonResponse({}, { status: 500 })
		)
		const error = await api
			.getUser({
				reqParams: { id: '1' },
				url: 'https://api.test/users/:id?api_key=abc123&page=2'
			})
			.catch((e: unknown) => e)

		const everything = JSON.stringify([
			logged,
			debug,
			isApiError(error) ? [error.message, error.toJSON()] : error
		])
		expect(everything).not.toContain('abc123')
		expect(everything).not.toContain('secret-token')
		expect(everything).toContain('api_key=[REDACTED]&page=2')
	})
})

type RecordedSpan = {
	name: string
	options: { kind?: number; attributes?: Record<string, unknown> }
	attributes: Record<string, unknown>
	status?: { code: number; message?: string }
	exceptions: unknown[]
	ended: boolean
}

function fakeTracer() {
	const spans: RecordedSpan[] = []
	const tracer: OtelTracerLike = {
		startActiveSpan(name, options, fn) {
			const recorded: RecordedSpan = {
				name,
				options,
				attributes: {},
				exceptions: [],
				ended: false
			}
			spans.push(recorded)
			const span: OtelSpanLike = {
				setAttributes: (a) => Object.assign(recorded.attributes, a),
				setStatus: (s) => {
					recorded.status = s
				},
				recordException: (e) => recorded.exceptions.push(e),
				end: () => {
					recorded.ended = true
				}
			}
			return fn(span) as ReturnType<typeof fn>
		}
	}
	return { tracer, spans }
}

describe('otelMiddleware', () => {
	test('accepts a real @opentelemetry/api tracer (type-level)', () => {
		const tracer: Tracer = trace.getTracer('test')
		const middleware = otelMiddleware(tracer, {
			inject: (headers) => propagation.inject(context.active(), headers)
		})
		expect(typeof middleware).toBe('function')
	})

	test('records one client span per request with HTTP attributes', async () => {
		const { tracer, spans } = fakeTracer()
		let calls = 0
		const api = createApiClient({
			name: 'users',
			baseApiUrls: { default: 'https://api.test' },
			endpoints: { getUser },
			retryDelayMs: 0,
			use: [otelMiddleware(tracer)],
			fetch: createMockFetch(() =>
				++calls === 1
					? jsonResponse({}, { status: 503 })
					: jsonResponse({ id: '1', age: 3 })
			)
		})

		await api.getUser({ reqParams: { id: '1' } })

		expect(spans).toHaveLength(1)
		expect(spans[0]).toMatchObject({
			name: 'users.getUser',
			options: {
				kind: 2,
				attributes: {
					'http.request.method': 'GET',
					'url.full': 'https://api.test/users/1',
					'server.address': 'api.test',
					'api.endpoint': 'getUser'
				}
			},
			attributes: {
				'http.response.status_code': 200,
				'http.request.resend_count': 1
			},
			ended: true
		})
		expect(spans[0]!.status).toBeUndefined()
	})

	test('marks failures with error.type, category and ERROR status', async () => {
		const { tracer, spans } = fakeTracer()
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.test' },
			endpoints: { getUser },
			use: [otelMiddleware(tracer)],
			fetch: createMockFetch(() => jsonResponse({ id: 1 }))
		})

		await api.getUser({ reqParams: { id: '1' } }).catch(() => {})

		expect(spans[0]!.attributes).toMatchObject({
			'error.type': 'ResponseValidationError',
			'api.error.category': 'output_validation'
		})
		expect(spans[0]!.status).toEqual({
			code: 2,
			message: 'Response validation failed (GET https://api.test/users/1):'
		})
		expect(spans[0]!.exceptions).toHaveLength(1)
		expect(spans[0]!.ended).toBe(true)
	})

	test('redacts or drops the query string and injects headers', async () => {
		const { tracer, spans } = fakeTracer()
		const fetch = createMockFetch(() => jsonResponse({ id: '1', age: 1 }))
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.test' },
			endpoints: { getUser },
			fetch,
			use: [
				otelMiddleware(tracer, {
					inject: (headers) => {
						headers.traceparent = '00-abc-def-01'
					}
				}),
				otelMiddleware(tracer, { includeQuery: false })
			]
		})

		await api.getUser({
			reqParams: { id: '1' },
			url: 'https://api.test/users/:id?token=t0p&page=2'
		})

		expect(spans[0]!.options.attributes?.['url.full']).toBe(
			'https://api.test/users/1?token=[REDACTED]&page=2'
		)
		expect(spans[1]!.options.attributes?.['url.full']).toBe(
			'https://api.test/users/1'
		)
		expect(fetch.calls[0]!.headers.get('traceparent')).toBe('00-abc-def-01')
	})
})

describe('describeApiError', () => {
	test('is exported for custom loggers', () => {
		expect(typeof describeApiError).toBe('function')
	})
})
