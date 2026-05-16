import type { z } from 'zod'
import type {
	ActionInvokeOptions,
	ActionsFactoryHelpers,
	ApiAction,
	ApiClient,
	ApiClientConfig,
	ApiClientConfigNoActions,
	ApiClientConfigWithActions,
	ApiEndpoint,
	ApiWrapperResponse,
	RequestInput
} from './types'
import type { PathParams, QueryParams } from './shared'
import type { ApiErrorContext } from './shared'
import {
	buildHeaders,
	buildQueryParams,
	buildRequestBody,
	buildUrl
} from './builders'
import { createActionCache, makeDefineAction } from './actions-impl'
import { reportApiError } from './error-reporting'
import { ActionError, ApiError, ConfigError } from './errors'
import { calculateSizeInMb } from './size'
import {
	defaultShouldRetry,
	makeRequestWithRetry,
	type RequestConfig,
	validateAndTransformResponse
} from './transport'

type AnyApiAction = ApiAction<unknown, unknown>

export interface CreateApiClientFn {
	<T extends Record<string, ApiEndpoint>>(
		apiConfig: ApiClientConfigNoActions<T>
	): ApiClient<T, Record<string, never>>
	<T extends Record<string, ApiEndpoint>, A extends Record<string, ApiAction>>(
		apiConfig: ApiClientConfigWithActions<T, A>
	): ApiClient<T, A>
}

function isActionInvokeOptionsOnly(
	value: unknown
): value is ActionInvokeOptions {
	if (value === null || value === undefined) return false
	if (typeof value !== 'object' || Array.isArray(value)) return false
	return Object.keys(value as object).every(
		(k) => k === 'signal' || k === 'meta'
	)
}

function createApiClientImpl<
	T extends Record<string, ApiEndpoint>,
	A extends Record<string, ApiAction> = Record<string, never>
>(apiConfig: ApiClientConfig<T, A>): ApiClient<T, A> {
	let actions: Record<string, AnyApiAction> = {}

	const cache = createActionCache()

	const invokeEndpoint = async <K extends keyof T>(
		endpointKey: K,
		input: RequestInput<T[K]> = {} as RequestInput<T[K]>
	): Promise<ApiWrapperResponse<z.infer<T[K]['resSchema']>>> => {
		const endpoint = apiConfig.endpoints[endpointKey]
		const rawInput = input as RequestInput<T[K]> & {
			reqBody?: unknown
			reqParams?: PathParams
			reqQuery?: QueryParams
			reqHeaders?: Record<string, string>
		}
		const endpointName = apiConfig.name
			? `${apiConfig.name}.${String(endpointKey)}`
			: String(endpointKey)
		const startedAt = Date.now()
		const maxRetries = input.retries ?? apiConfig.retries ?? 3

		const baseContext: ApiErrorContext = {
			endpoint: endpointName,
			method: endpoint?.method ?? 'GET',
			url: '',
			attempt: 0,
			maxRetries,
			elapsedMs: 0,
			meta: input.meta
		}

		const elapsed = () => Date.now() - startedAt
		const ctx = (over: Partial<ApiErrorContext> = {}): ApiErrorContext => ({
			...baseContext,
			elapsedMs: elapsed(),
			...over
		})

		if (!endpoint) {
			throw await reportApiError(
				new ConfigError(`Unknown API endpoint: ${String(endpointKey)}`, ctx()),
				apiConfig
			)
		}

		baseContext.method = endpoint.method

		let finalUrl: string
		let fullUrl: string
		try {
			const built = buildUrl(
				endpoint,
				rawInput.reqParams,
				rawInput.reqQuery,
				apiConfig.baseApiUrls,
				apiConfig.defaultBaseApiUrl,
				input.url,
				(msg) => new ConfigError(msg, ctx())
			)
			finalUrl = built.finalUrl
			fullUrl = built.fullUrl
		} catch (e) {
			if (e instanceof ApiError) throw await reportApiError(e, apiConfig)
			throw e
		}

		baseContext.url = fullUrl

		let queryParams: Record<string, string>
		let body: unknown
		let headers: Record<string, string>
		try {
			queryParams = buildQueryParams(endpoint, rawInput.reqQuery, ctx)
			body = buildRequestBody(endpoint, rawInput.reqBody, ctx)
			headers = buildHeaders(
				endpoint,
				rawInput.reqHeaders,
				apiConfig.defaultHeaders ?? {},
				ctx
			)
		} catch (e) {
			if (e instanceof ApiError) throw await reportApiError(e, apiConfig)
			throw e
		}

		baseContext.requestHeaders = headers
		baseContext.requestBody = body

		if (apiConfig.onRequest) {
			try {
				const result = await apiConfig.onRequest({
					endpoint: endpointName,
					method: endpoint.method,
					url: fullUrl,
					headers,
					body,
					meta: input.meta
				})
				if (result?.headers) headers = result.headers
				if (result && 'body' in result) body = result.body
			} catch (e) {
				if (e instanceof ApiError) throw await reportApiError(e, apiConfig)
				throw e
			}
		}

		const config: RequestConfig = {
			method: endpoint.method,
			url: finalUrl,
			queryParams,
			body,
			headers,
			doNotEncodeQueryParams: endpoint.doNotEncodeQueryParams,
			timeoutMs: input.timeoutMs ?? apiConfig.timeoutMs,
			fetchFn: input.fetch ?? apiConfig.fetch ?? fetch,
			userSignal: input.signal
		}

		try {
			const result = await makeRequestWithRetry({
				config,
				maxRetries,
				retryDelay: apiConfig.retryDelayMs ?? 300,
				validateFn: (response) =>
					validateAndTransformResponse(endpoint, response, ctx),
				shouldRetry: apiConfig.shouldRetry ?? defaultShouldRetry,
				logger: apiConfig.logger,
				ctx,
				endpointName,
				method: endpoint.method,
				fullUrl,
				meta: input.meta,
				onResponse: apiConfig.onResponse,
				onRetry: apiConfig.onRetry
			})

			const responseTimeMs = elapsed()
			const responseSizeMb = calculateSizeInMb(result.validatedData)
			const requestBodySizeMb = calculateSizeInMb(config.body)

			return {
				data: result.validatedData as z.infer<T[K]['resSchema']>,
				requestBodySizeMb,
				responseSizeMb,
				responseTimeMs,
				httpStatus: result.httpStatus,
				retryCount: result.retryCount
			}
		} catch (error) {
			if (error instanceof ApiError)
				throw await reportApiError(error, apiConfig)
			throw error
		}
	}

	async function invokeAction(
		name: string,
		rawInput: unknown,
		options: ActionInvokeOptions = {}
	): Promise<unknown> {
		const action = actions[name]!
		const inputForHandler = action.noRuntimeInput ? undefined : rawInput
		const actionName = apiConfig.name ? `${apiConfig.name}.${name}` : name
		const startedAt = Date.now()
		const baseContext: ApiErrorContext = {
			endpoint: actionName,
			method: 'GET',
			url: '',
			attempt: 0,
			maxRetries: 0,
			elapsedMs: 0,
			meta: options.meta,
			requestBody: action.noRuntimeInput ? undefined : rawInput
		}
		const ctx = (over: Partial<ApiErrorContext> = {}): ApiErrorContext => ({
			...baseContext,
			elapsedMs: Date.now() - startedAt,
			...over
		})

		apiConfig.logger?.debug?.('Action start', { action: actionName })

		try {
			const result = await action.handler({
				input: inputForHandler,
				api: proxy,
				signal: options.signal,
				meta: options.meta,
				logger: apiConfig.logger,
				cache
			})
			apiConfig.logger?.debug?.('Action end', {
				action: actionName,
				elapsedMs: Date.now() - startedAt
			})
			return result
		} catch (error) {
			if (error instanceof ApiError) {
				throw await reportApiError(error, apiConfig)
			}
			const wrapped = new ActionError(
				`Action ${actionName} failed: ${error instanceof Error ? error.message : String(error)}`,
				ctx(),
				error
			)
			throw await reportApiError(wrapped, apiConfig)
		}
	}

	const request = (async (
		key: string,
		input?: unknown,
		options?: ActionInvokeOptions
	): Promise<unknown> => {
		if (key in actions) {
			const action = actions[key]!
			if (action.noRuntimeInput) {
				if (input === undefined || input === null) {
					return invokeAction(key, undefined, options ?? {})
				}
				if (options !== undefined) {
					return invokeAction(key, undefined, options)
				}
				if (isActionInvokeOptionsOnly(input)) {
					return invokeAction(key, undefined, input)
				}
				return invokeAction(key, undefined, {})
			}
			return invokeAction(key, input, options)
		}
		return invokeEndpoint(
			key as keyof T,
			(input ?? {}) as RequestInput<T[keyof T]>
		)
	}) as unknown as ApiClient<T, A>['request']

	const client = { request, cache } as ApiClient<T, A>
	const proxy: ApiClient<T, A> = new Proxy(client, {
		get(target, prop, receiver) {
			if (prop in target || typeof prop !== 'string') {
				return Reflect.get(target, prop, receiver)
			}
			if (prop in apiConfig.endpoints) {
				return (input?: RequestInput<T[keyof T]>) =>
					invokeEndpoint(
						prop as keyof T,
						input ?? ({} as RequestInput<T[keyof T]>)
					)
			}
			if (prop in actions) {
				const action = actions[prop]!
				if (action.noRuntimeInput) {
					return (
						first?: unknown,
						second?: ActionInvokeOptions
					): Promise<unknown> => {
						if (first === undefined || first === null) {
							return invokeAction(prop, undefined, second ?? {})
						}
						if (second !== undefined) {
							return invokeAction(prop, undefined, second)
						}
						if (isActionInvokeOptionsOnly(first)) {
							return invokeAction(prop, undefined, first)
						}
						return invokeAction(prop, undefined, {})
					}
				}
				return (input?: unknown, opt?: ActionInvokeOptions) =>
					invokeAction(prop, input, opt)
			}
			return undefined
		}
	})

	const rawActions = apiConfig.actions
	if (typeof rawActions === 'function') {
		actions = (
			rawActions as (
				helpers: ActionsFactoryHelpers<T, A>
			) => Record<string, AnyApiAction>
		)({
			api: proxy,
			defineAction: makeDefineAction<ApiClient<T, A>>()
		}) as Record<string, AnyApiAction>
	} else if (rawActions) {
		actions = rawActions as Record<string, AnyApiAction>
	}

	const collisions = Object.keys(actions).filter(
		(key) => key in apiConfig.endpoints
	)
	if (collisions.length > 0) {
		throw new ConfigError(
			`Action name(s) collide with endpoint name(s): ${collisions.join(', ')}`,
			{
				endpoint: collisions[0]!,
				method: 'GET',
				url: '',
				attempt: 0,
				maxRetries: 0,
				elapsedMs: 0
			}
		)
	}

	return proxy
}

export const createApiClient: CreateApiClientFn = ((apiConfig: unknown) =>
	createApiClientImpl(
		apiConfig as ApiClientConfig<
			Record<string, ApiEndpoint>,
			Record<string, ApiAction>
		>
	)) as CreateApiClientFn
