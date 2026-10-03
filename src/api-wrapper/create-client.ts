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
	ApiMiddlewareContext,
	ApiWrapperResponse,
	RequestInput
} from './types'
import type { PathParams, QueryParams } from './shared'
import type { ApiErrorContext } from './shared'
import {
	buildHeaders,
	buildPathParams,
	buildQueryParams,
	buildRequestBody,
	buildUrl
} from './builders'
import { err, exponentialBackoff, ok } from '../promise'
import { createActionCache, makeDefineAction } from './actions-impl'
import { reportApiError } from './error-reporting'
import {
	ActionError,
	ApiError,
	ApiResponseError,
	ConfigError,
	RequestValidationError
} from './errors'
import { calculateSizeInMb } from './size'
import {
	defaultShouldRetry,
	makeRequestWithRetry,
	type RequestConfig,
	validateAndTransformResponse
} from './transport'

type AnyApiAction = ApiAction<unknown, unknown>

// The actions overload comes first: TypeScript fixes a context-sensitive
// `actions` factory's parameter types on the first overload it tries.
export interface CreateApiClientFn {
	<T extends Record<string, ApiEndpoint>, A extends Record<string, ApiAction>>(
		apiConfig: ApiClientConfigWithActions<T, A>
	): ApiClient<T, A>
	<T extends Record<string, ApiEndpoint>>(
		apiConfig: ApiClientConfigNoActions<T>
	): ApiClient<T, Record<string, never>>
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

function resolveActionInvocation(
	action: AnyApiAction,
	actionName: string,
	first: unknown,
	second?: ActionInvokeOptions
): { input: unknown; options: ActionInvokeOptions } {
	if (!action.noRuntimeInput) {
		return { input: first, options: second ?? {} }
	}

	if (first === undefined || first === null) {
		return { input: undefined, options: second ?? {} }
	}
	if (second !== undefined) {
		return { input: undefined, options: second }
	}
	if (isActionInvokeOptionsOnly(first)) {
		return { input: undefined, options: first }
	}

	throw new ConfigError(
		`Action "${actionName}" does not accept input; pass only optional { signal, meta }`,
		{
			endpoint: actionName,
			method: 'GET',
			url: '',
			attempt: 0,
			maxRetries: 0,
			elapsedMs: 0
		}
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
		// Until the full URL is built, errors (e.g. input validation) show the path template.
		if (typeof endpoint.path === 'string') baseContext.url = endpoint.path

		let pathParams: PathParams | undefined
		let queryParams: QueryParams
		let body: unknown
		let headers: Record<string, string>
		try {
			pathParams = buildPathParams(endpoint, rawInput.reqParams, ctx)
			queryParams = buildQueryParams(endpoint, rawInput.reqQuery, ctx)
			body = buildRequestBody(endpoint, rawInput.reqBody, ctx)
			const defaultHeaders =
				typeof apiConfig.defaultHeaders === 'function'
					? await apiConfig.defaultHeaders()
					: apiConfig.defaultHeaders
			headers = buildHeaders(
				endpoint,
				rawInput.reqHeaders,
				defaultHeaders ?? {},
				ctx
			)
		} catch (e) {
			if (e instanceof ApiError) throw await reportApiError(e, apiConfig)
			throw e
		}

		let fullUrl: string
		try {
			const built = buildUrl({
				endpoint,
				params: pathParams,
				queryParams,
				baseApiUrls: apiConfig.baseApiUrls,
				defaultBaseApiUrl: apiConfig.defaultBaseApiUrl,
				url: input.url,
				doNotEncodeQueryParams: endpoint.doNotEncodeQueryParams,
				configError: (msg) => new ConfigError(msg, ctx())
			})
			fullUrl = built.fullUrl
		} catch (e) {
			if (e instanceof ApiError) throw await reportApiError(e, apiConfig)
			throw e
		}

		baseContext.url = fullUrl
		baseContext.requestHeaders = headers
		baseContext.requestBody = body

		const execute = async (): Promise<
			ApiWrapperResponse<z.infer<T[K]['resSchema']>>
		> => {
			if (apiConfig.onRequest) {
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
			}

			const config: RequestConfig = {
				method: endpoint.method,
				fullUrl,
				body,
				headers,
				timeoutMs: input.timeoutMs ?? apiConfig.timeoutMs,
				fetchFn: input.fetch ?? apiConfig.fetch ?? fetch,
				userSignal: input.signal
			}

			const result = await makeRequestWithRetry({
				config,
				maxRetries,
				retryDelay:
					apiConfig.retryDelayMs ??
					((attempt) =>
						exponentialBackoff(attempt + 1, {
							baseMs: 300,
							maxMs: apiConfig.maxRetryDelayMs
						})),
				maxRetryDelayMs: apiConfig.maxRetryDelayMs,
				validateFn: async (response, attempt) => {
					const validated = await validateAndTransformResponse(
						endpoint,
						response,
						(over) => ctx({ attempt, ...over })
					)
					await runCheckResponse(validated.data, response.status, attempt)
					return validated
				},
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

			return {
				data: result.validatedData.data as z.infer<T[K]['resSchema']>,
				requestBodySizeMb: calculateSizeInMb(config.body),
				responseSizeMb: result.validatedData.responseSizeBytes / (1024 * 1024),
				responseTimeMs: elapsed(),
				httpStatus: result.httpStatus,
				retryCount: result.retryCount,
				headers: result.validatedData.headers
			}
		}

		const runCheckResponse = async (
			data: unknown,
			httpStatus: number,
			attempt: number
		) => {
			// An endpoint's own check (or `false`) replaces the client's.
			const checkResponse =
				endpoint.checkResponse === undefined
					? apiConfig.checkResponse
					: endpoint.checkResponse
			if (!checkResponse) return
			try {
				await checkResponse(data, {
					endpoint: endpointName,
					method: endpoint.method,
					url: fullUrl,
					httpStatus,
					attempt,
					meta: input.meta
				})
			} catch (error) {
				if (error instanceof ApiError) throw error
				throw new ApiResponseError(
					error instanceof Error ? error.message : String(error),
					data,
					ctx({ attempt }),
					error
				)
			}
		}

		// Innermost step: errors are redacted and passed to onError before any
		// middleware sees them.
		const run = async () => {
			try {
				return await execute()
			} catch (error) {
				if (error instanceof ApiError) {
					throw await reportApiError(error, apiConfig)
				}
				throw error
			}
		}

		const middleware = apiConfig.use ?? []
		if (middleware.length === 0) return run()

		const middlewareContext: ApiMiddlewareContext = {
			client: apiConfig.name,
			endpoint: String(endpointKey),
			method: endpoint.method,
			url: fullUrl,
			headers,
			meta: input.meta
		}
		const dispatch = (
			index: number
		): Promise<ApiWrapperResponse<z.infer<T[K]['resSchema']>>> => {
			const current = middleware[index]
			if (!current) return run()
			return current(middlewareContext, () => dispatch(index + 1)) as Promise<
				ApiWrapperResponse<z.infer<T[K]['resSchema']>>
			>
		}
		return dispatch(0)
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

		let parsedInput = inputForHandler
		if (action.input) {
			const parsed = await action.input.safeParseAsync(rawInput)
			if (!parsed.success) {
				throw await reportApiError(
					new RequestValidationError(parsed.error, 'input', rawInput, ctx()),
					apiConfig
				)
			}
			parsedInput = parsed.data
		}

		try {
			const result = await action.handler({
				input: parsedInput,
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

	async function dispatchAction(
		name: string,
		first?: unknown,
		second?: ActionInvokeOptions
	): Promise<unknown> {
		const action = actions[name]!
		const { input, options } = resolveActionInvocation(
			action,
			name,
			first,
			second
		)
		return invokeAction(name, input, options)
	}

	const request = (async (
		key: string,
		input?: unknown,
		options?: ActionInvokeOptions
	): Promise<unknown> => {
		if (key in actions) {
			return dispatchAction(key, input, options)
		}
		return invokeEndpoint(
			key as keyof T,
			(input ?? {}) as RequestInput<T[keyof T]>
		)
	}) as unknown as ApiClient<T, A>['request']

	// Resolves to `Result` instead of throwing ApiErrors; other errors still throw.
	const safe = new Proxy(
		{},
		{
			get(_target, prop) {
				if (typeof prop !== 'string') return undefined
				if (!(prop in apiConfig.endpoints) && !(prop in actions)) {
					return undefined
				}
				return async (...args: unknown[]) => {
					try {
						const method = Reflect.get(proxy, prop) as (
							...a: unknown[]
						) => Promise<unknown>
						return ok(await method(...args))
					} catch (error) {
						if (error instanceof ApiError) return err(error)
						throw error
					}
				}
			}
		}
	)

	const client = { request, cache, safe } as unknown as ApiClient<T, A>
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
				return (first?: unknown, second?: ActionInvokeOptions) =>
					dispatchAction(prop, first, second)
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

	const reserved = [
		...Object.keys(apiConfig.endpoints),
		...Object.keys(actions)
	].filter((key) => key in client)
	if (reserved.length > 0) {
		throw new ConfigError(
			`Endpoint/action name(s) are reserved by the client: ${reserved.join(', ')}`,
			{
				endpoint: reserved[0]!,
				method: 'GET',
				url: '',
				attempt: 0,
				maxRetries: 0,
				elapsedMs: 0
			}
		)
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
