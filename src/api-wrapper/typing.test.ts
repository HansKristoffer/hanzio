import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
	type AnyApiClient,
	type ApiEndpoint,
	type ApiError,
	createApiClient,
	defineEndpoint,
	type EndpointRequest,
	type EndpointResponse,
	type InferRequest,
	type InferResponse,
	type PathParamNames,
	RequestValidationError
} from '.'
import { createMockFetch, jsonResponse } from './testing'

// Typed meta via module augmentation. Optional so other tests stay unaffected.
declare module '.' {
	interface ApiRequestMeta {
		traceId?: string
	}
}

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false
const assertType = <T extends true>(_value?: T) => {}

const list = defineEndpoint({
	method: 'GET',
	path: '/items',
	reqQuerySchema: z.object({
		page: z.number().default(1),
		q: z.string().optional()
	}),
	resSchema: z.object({ total: z.string().transform(Number) }),
	resFormatter: (data) => ({ total: String((data as { count: number }).count) })
})

const byId = defineEndpoint({
	method: 'GET',
	path: '/items/:itemId/parts/:partId.json',
	resSchema: z.object({ id: z.string() })
})

const create = defineEndpoint({
	method: 'POST',
	path: '/items',
	reqBodySchema: z.object({ price: z.string().transform(Number) }),
	resSchema: z.object({ id: z.string() })
})

const legacy = {
	method: 'GET',
	path: '/legacy/:id',
	resSchema: z.object({ id: z.string() })
} satisfies ApiEndpoint

function client() {
	const fetch = createMockFetch((request) => {
		if (/\/(items|legacy)\//.test(request.url)) {
			return jsonResponse({ id: 'i1' })
		}
		if (request.method === 'POST') return jsonResponse({ id: 'new' })
		return jsonResponse({ count: 7 })
	})
	const api = createApiClient({
		baseApiUrls: { default: 'https://api.test' },
		endpoints: { list, byId, create, legacy },
		fetch,
		actions: ({ defineAction }) => ({
			rename: defineAction({
				input: z.object({ name: z.string().trim().min(1) }),
				handler: ({ input }) => input.name.toUpperCase()
			})
		})
	})
	return { api, fetch }
}

describe('request typing', () => {
	test('callers pass schema inputs: defaults optional, pre-transform types', async () => {
		const { api, fetch } = client()
		await api.list({ reqQuery: {} })
		await api.create({ reqBody: { price: '9.99' } })
		// @ts-expect-error the body schema takes the pre-transform string
		api.create({ reqBody: { price: 9.99 } }).catch(() => {})

		expect(fetch.calls[0]!.url).toBe('https://api.test/items?page=1')
		expect(await fetch.calls[1]!.json()).toEqual({ price: 9.99 })
	})

	test('path params are required and typed from a literal path', async () => {
		const { api, fetch } = client()
		await api.byId({ reqParams: { itemId: 'a', partId: 2 } })
		// @ts-expect-error missing path params
		api.byId().catch(() => {})
		// @ts-expect-error wrong param name
		api.byId({ reqParams: { id: 'a', partId: 2 } }).catch(() => {})
		// `satisfies` widens the path, so params fall back to optional records
		await api.legacy({ reqParams: { id: '1' } })

		expect(fetch.calls[0]!.url).toBe('https://api.test/items/a/parts/2.json')
		assertType<
			Equal<
				PathParamNames<'/a/:b/:c_1.json?x=:y&port=:8080'>,
				'b' | 'c_1' | 'y'
			>
		>()
		assertType<Equal<PathParamNames<string>, never>>()
	})

	test('resFormatter must return the response schema input', () => {
		defineEndpoint({
			method: 'GET',
			path: '/x',
			resSchema: z.object({ id: z.string() }),
			// @ts-expect-error resFormatter must return { id: string }
			resFormatter: () => 42
		})
	})
})

describe('type helpers', () => {
	test('infer responses and requests from endpoints and clients', async () => {
		const { api } = client()
		type Api = typeof api
		assertType<Equal<EndpointResponse<typeof list>, { total: number }>>()
		assertType<Equal<InferResponse<Api, 'list'>, { total: number }>>()
		assertType<Equal<InferResponse<Api, 'rename'>, string>>()
		assertType<
			Equal<EndpointRequest<typeof create>['reqBody'], { price: string }>
		>()
		assertType<
			Equal<
				InferRequest<Api, 'byId'>['reqParams'],
				Record<'itemId' | 'partId', string | number>
			>
		>()
		const { data } = await api.list({ reqQuery: {} })
		expect(data.total).toBe(7)
	})

	test('any client is assignable to AnyApiClient', () => {
		const { api } = client()
		const general: AnyApiClient = api
		expect(typeof general.request).toBe('function')
	})
})

describe('api.safe', () => {
	test('resolves to Result for endpoints and actions', async () => {
		const fetch = createMockFetch(() =>
			jsonResponse({ nope: true }, { status: 404 })
		)
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.test' },
			endpoints: { byId },
			retries: 0,
			fetch
		})

		const result = await api.safe.byId({
			reqParams: { itemId: 'x', partId: 1 }
		})
		expect(result.ok).toBe(false)
		if (!result.ok) {
			const error: ApiError = result.error
			expect(error.category).toBe('client_error')
		}

		const { api: withActions } = client()
		const renamed = await withActions.safe.rename({ name: ' ada ' })
		expect(renamed).toEqual({ ok: true, data: 'ADA', error: null })
	})

	test('non-ApiErrors still throw', async () => {
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.test' },
			endpoints: { byId },
			defaultHeaders: () => {
				throw new TypeError('bug in header factory')
			}
		})
		await expect(
			api.safe.byId({ reqParams: { itemId: 'x', partId: 1 } })
		).rejects.toThrow('bug in header factory')
	})
})

describe('action input schemas', () => {
	test('validate at runtime; handlers get parsed output', async () => {
		const { api, fetch } = client()
		expect(await api.rename({ name: '  ada ' })).toBe('ADA')

		const error = await api.rename({ name: '   ' }).catch((e: unknown) => e)
		expect(error).toBeInstanceOf(RequestValidationError)
		expect((error as RequestValidationError).target).toBe('input')
		expect((error as RequestValidationError).category).toBe('input_validation')
		// @ts-expect-error input is typed from the schema
		api.rename({ nope: 1 }).catch(() => {})
		expect(fetch.calls).toHaveLength(0)
	})
})

describe('client names', () => {
	test('endpoints named request, cache or safe are rejected', () => {
		expect(() =>
			createApiClient({
				baseApiUrls: { default: 'https://api.test' },
				endpoints: { safe: byId }
			})
		).toThrow('reserved by the client: safe')
	})
})

describe('typed meta', () => {
	test('augmented ApiRequestMeta types meta on calls', async () => {
		const { api } = client()
		await api.list({ reqQuery: {}, meta: { traceId: 't1' } })
		// @ts-expect-error traceId is typed as string
		api.list({ reqQuery: {}, meta: { traceId: 1 } }).catch(() => {})
	})
})
