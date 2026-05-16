import type { z } from 'zod'
import type { ApiError } from './errors'
import type {
	ApiErrorContext,
	BaseApiUrl,
	HttpMethod,
	PathParams,
	QueryParams,
	RequestBodyFormat
} from './shared'

export interface ApiEndpoint<
	TReqBody extends z.ZodType | undefined = z.ZodType | undefined,
	TReqParams extends z.ZodType | undefined = z.ZodType | undefined,
	TReqQuery extends z.ZodType | undefined = z.ZodType | undefined,
	TReqHeaders extends z.ZodType | undefined = z.ZodType | undefined,
	TResponse extends z.ZodType = z.ZodType
> {
	method: HttpMethod
	path: string | ((baseUrl: string) => string)
	reqBodySchema?: TReqBody
	reqParamsSchema?: TReqParams
	reqQuerySchema?: TReqQuery
	reqHeadersSchema?: TReqHeaders
	resSchema: TResponse
	baseApiUrl?: string
	reqBodyFormat?: RequestBodyFormat
	defaultHeaders?: Record<string, string>
	resFormatter?: (
		data: unknown,
		headers: Record<string, string>
	) => z.infer<TResponse>
	reqDefaultQueryParams?: QueryParams
	doNotEncodeQueryParams?: boolean
}

export interface ApiWrapperResponse<T> {
	data: T
	requestBodySizeMb: number
	responseSizeMb: number
	responseTimeMs: number
	httpStatus: number
	retryCount: number
}

export type RetryContext = {
	error?: unknown
	response?: Response
	retryCount: number
	maxRetries: number
	endpoint?: string
	method?: HttpMethod
	url?: string
}

export type OnRetryContext = RetryContext & {
	delayMs: number
	nextAttempt: number
}

export type RequestInterceptorResult =
	| {
			headers?: Record<string, string>
			body?: unknown
	  }
	| void
	| undefined

export type OnRequestContext = {
	endpoint: string
	method: HttpMethod
	url: string
	headers: Record<string, string>
	body: unknown
	meta?: Record<string, unknown>
}

export type OnResponseContext = {
	endpoint: string
	method: HttpMethod
	url: string
	response: Response
	attempt: number
	meta?: Record<string, unknown>
}

export type ActionCache = {
	<T>(
		key: string,
		fn: () => Promise<T> | T,
		options?: { ttlMs?: number }
	): Promise<T>
	get<T>(key: string): T | undefined
	set<T>(key: string, value: T, options?: { ttlMs?: number }): void
	invalidate(key: string): void
	clear(): void
}

export type ActionInvokeOptions = {
	signal?: AbortSignal
	meta?: Record<string, unknown>
}

// biome-ignore lint/suspicious/noExplicitAny: TApi defaults to any so plain ApiAction stays open
export type ActionContext<TInput, TApi = any> = {
	input: TInput
	api: TApi
	signal?: AbortSignal
	meta?: Record<string, unknown>
	logger?: Pick<Console, 'debug' | 'error'>
	cache: ActionCache
}

// biome-ignore lint/suspicious/noExplicitAny: variance-friendly bounds
export interface ApiAction<TInput = any, TOutput = any> {
	handler: (ctx: ActionContext<TInput>) => Promise<TOutput> | TOutput
	/** When true, the action accepts only optional `{ signal, meta }`; input is always `undefined`. */
	readonly noRuntimeInput?: boolean
}

type ActionDefinition<TInput, TOutput, TApi> = {
	handler: (ctx: ActionContext<TInput, TApi>) => Promise<TOutput> | TOutput
}

export type DefineAction<TApi> = {
	<TOutput>(
		def: ActionDefinition<undefined, TOutput, TApi>
	): ApiAction<undefined, TOutput>
	<TInput>(): <TOutput>(
		def: ActionDefinition<TInput, TOutput, TApi>
	) => ApiAction<TInput, TOutput>
}

// biome-ignore lint/suspicious/noExplicitAny: variance-friendly inference
type ActionInput<A> = A extends ApiAction<infer I, any> ? I : never
// biome-ignore lint/suspicious/noExplicitAny: variance-friendly inference
export type ActionOutput<A> = A extends ApiAction<any, infer O> ? O : never

export type ActionArgs<A> = [ActionInput<A>] extends [undefined]
	? [options?: ActionInvokeOptions]
	: [input: ActionInput<A>, options?: ActionInvokeOptions]

type SchemaInputKeys<TEndpoint extends ApiEndpoint> =
	| (TEndpoint['reqBodySchema'] extends z.ZodType ? 'reqBody' : never)
	| (TEndpoint['reqParamsSchema'] extends z.ZodType ? 'reqParams' : never)
	| (TEndpoint['reqQuerySchema'] extends z.ZodType ? 'reqQuery' : never)
	| (TEndpoint['reqHeadersSchema'] extends z.ZodType ? 'reqHeaders' : never)

type SchemaInputs<TEndpoint extends ApiEndpoint> = {
	reqBody: TEndpoint['reqBodySchema'] extends z.ZodType
		? z.infer<TEndpoint['reqBodySchema']>
		: unknown
	reqParams: TEndpoint['reqParamsSchema'] extends z.ZodType
		? z.infer<TEndpoint['reqParamsSchema']>
		: PathParams
	reqQuery: TEndpoint['reqQuerySchema'] extends z.ZodType
		? z.infer<TEndpoint['reqQuerySchema']>
		: QueryParams
	reqHeaders: TEndpoint['reqHeadersSchema'] extends z.ZodType
		? z.infer<TEndpoint['reqHeadersSchema']>
		: Record<string, string>
}

type CommonRequestOptions = {
	url?: string
	signal?: AbortSignal
	timeoutMs?: number
	retries?: number
	fetch?: typeof fetch
	meta?: Record<string, unknown>
}

export type RequestInput<TEndpoint extends ApiEndpoint> = Pick<
	SchemaInputs<TEndpoint>,
	SchemaInputKeys<TEndpoint>
> &
	Partial<Omit<SchemaInputs<TEndpoint>, SchemaInputKeys<TEndpoint>>> &
	CommonRequestOptions

type RequestArgs<TEndpoint extends ApiEndpoint> =
	SchemaInputKeys<TEndpoint> extends never
		? [input?: RequestInput<TEndpoint>]
		: [input: RequestInput<TEndpoint>]

export type ApiClient<
	T extends Record<string, ApiEndpoint>,
	A extends Record<string, ApiAction> = Record<string, never>
> = {
	request: {
		<K extends keyof T>(
			endpointKey: K,
			...args: RequestArgs<T[K]>
		): Promise<ApiWrapperResponse<z.infer<T[K]['resSchema']>>>
		<K extends keyof A>(
			actionKey: K,
			...args: ActionArgs<A[K]>
		): Promise<ActionOutput<A[K]>>
	}
	cache: ActionCache
} & {
	[K in keyof T]: (
		...args: RequestArgs<T[K]>
	) => Promise<ApiWrapperResponse<z.infer<T[K]['resSchema']>>>
} & {
	[K in keyof A]: (...args: ActionArgs<A[K]>) => Promise<ActionOutput<A[K]>>
}

export type ActionsFactoryHelpers<
	T extends Record<string, ApiEndpoint>,
	A extends Record<string, ApiAction> = Record<string, never>
> = {
	api: ApiClient<T, A>
	defineAction: DefineAction<ApiClient<T, A>>
}

export interface ApiClientConfig<
	T extends Record<string, ApiEndpoint>,
	A extends Record<string, ApiAction> = Record<string, never>
> {
	name?: string
	baseApiUrls: Record<string, BaseApiUrl>
	defaultBaseApiUrl?: string
	endpoints: T
	defaultHeaders?: Record<string, string>
	timeoutMs?: number
	retries?: number
	retryDelayMs?: number | ((attempt: number) => number)
	shouldRetry?: (context: RetryContext) => boolean
	logger?: Pick<Console, 'debug' | 'error'>
	fetch?: typeof fetch
	onRequest?: (
		context: OnRequestContext
	) => RequestInterceptorResult | Promise<RequestInterceptorResult>
	onResponse?: (context: OnResponseContext) => void | Promise<void>
	onError?: (error: ApiError) => void | Promise<void>
	onRetry?: (context: OnRetryContext) => void | Promise<void>
	redact?: (context: ApiErrorContext) => ApiErrorContext
	actions?: A | ((helpers: ActionsFactoryHelpers<T, A>) => A)
}

export type ApiClientConfigNoActions<T extends Record<string, ApiEndpoint>> =
	Omit<ApiClientConfig<T, Record<string, never>>, 'actions'>

export type ApiClientConfigWithActions<
	T extends Record<string, ApiEndpoint>,
	A extends Record<string, ApiAction>
> = Omit<ApiClientConfig<T, Record<string, never>>, 'actions'> & {
	actions: A | ((helpers: ActionsFactoryHelpers<T, A>) => A)
}

export type {
	BaseApiUrl,
	HttpMethod,
	PathParams,
	QueryParams,
	RequestBodyFormat,
	ApiErrorContext
} from './shared'
