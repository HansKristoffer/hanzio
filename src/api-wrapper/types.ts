import type { z } from 'zod'
import type { Result } from '../promise'
import type { ApiError } from './errors'
import type {
	ApiErrorContext,
	BaseApiUrl,
	HttpMethod,
	PathParams,
	QueryParams,
	RequestBodyFormat,
	RequestMeta
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
	/** Reshapes the raw body before `resSchema` parses it, so it returns the schema's input type. */
	resFormatter?: (
		data: unknown,
		headers: Record<string, string>
	) => z.input<TResponse>
	reqDefaultQueryParams?: QueryParams
	doNotEncodeQueryParams?: boolean
	/**
	 * Replaces the client's `checkResponse` for this endpoint; `false` skips it.
	 * `defineEndpoint` types `data` as the parsed `resSchema` output.
	 */
	checkResponse?:
		| ((
				// biome-ignore lint/suspicious/noExplicitAny: typed per endpoint by defineEndpoint
				data: any,
				context: CheckResponseContext
		  ) => void | Promise<void>)
		| false
}

export interface ApiWrapperResponse<T> {
	data: T
	requestBodySizeMb: number
	responseSizeMb: number
	responseTimeMs: number
	httpStatus: number
	retryCount: number
	/** Response headers of the final attempt, keyed by lowercase name. */
	headers: Record<string, string>
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
	meta?: RequestMeta
}

export type OnResponseContext = {
	endpoint: string
	method: HttpMethod
	url: string
	response: Response
	attempt: number
	meta?: RequestMeta
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
	meta?: RequestMeta
}

// biome-ignore lint/suspicious/noExplicitAny: TApi defaults to any so plain ApiAction stays open
export type ActionContext<TInput, TApi = any> = {
	input: TInput
	api: TApi
	signal?: AbortSignal
	meta?: RequestMeta
	logger?: Pick<Console, 'debug' | 'error'>
	cache: ActionCache
}

// biome-ignore lint/suspicious/noExplicitAny: variance-friendly bounds
export interface ApiAction<TInput = any, TOutput = any> {
	handler: (ctx: ActionContext<TInput>) => Promise<TOutput> | TOutput
	/** Validates the caller's input at runtime; `handler` receives the parsed output. */
	readonly input?: z.ZodType
	/** When true, the action accepts only optional `{ signal, meta }`; input is always `undefined`. */
	readonly noRuntimeInput?: boolean
}

type ActionDefinition<TInput, TOutput, TApi> = {
	handler: (ctx: ActionContext<TInput, TApi>) => Promise<TOutput> | TOutput
}

type SchemaActionDefinition<TSchema extends z.ZodType, TOutput, TApi> = {
	input: TSchema
	handler: (
		ctx: ActionContext<z.output<TSchema>, TApi>
	) => Promise<TOutput> | TOutput
}

export type DefineAction<TApi> = {
	/** Input validated by a Zod schema: callers pass `z.input`, the handler gets `z.output`. */
	<TSchema extends z.ZodType, TOutput>(
		def: SchemaActionDefinition<TSchema, TOutput, TApi>
	): ApiAction<z.input<TSchema>, TOutput>
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

// Tail-recursive (accumulator) to stay under TypeScript's recursion limit.
type CharsOf<
	S extends string,
	Acc extends string = never
> = S extends `${infer C}${infer Rest}` ? CharsOf<Rest, Acc | C> : Acc
type IdentStart =
	CharsOf<'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_'>
type WordChar = IdentStart | CharsOf<'0123456789'>
type TakeWord<
	S extends string,
	Acc extends string = ''
> = S extends `${infer C}${infer Rest}`
	? C extends WordChar
		? TakeWord<Rest, `${Acc}${C}`>
		: Acc
	: Acc

/**
 * `:name` placeholders in a literal path, matching the runtime rule (a letter
 * or `_`, then word characters, so ports like `:8080` don't count).
 * `never` for non-literal paths.
 */
export type PathParamNames<TPath> = TPath extends string
	? string extends TPath
		? never
		: TPath extends `${string}:${infer Rest}`
			?
					| (Rest extends `${IdentStart}${string}` ? TakeWord<Rest> : never)
					| PathParamNames<Rest>
			: never
	: never

type EndpointPathParamNames<TEndpoint extends ApiEndpoint> = PathParamNames<
	TEndpoint['path']
>

type SchemaInputKeys<TEndpoint extends ApiEndpoint> =
	| (TEndpoint['reqBodySchema'] extends z.ZodType ? 'reqBody' : never)
	| (TEndpoint['reqQuerySchema'] extends z.ZodType ? 'reqQuery' : never)
	| (TEndpoint['reqHeadersSchema'] extends z.ZodType ? 'reqHeaders' : never)
	| (TEndpoint['reqParamsSchema'] extends z.ZodType
			? 'reqParams'
			: [EndpointPathParamNames<TEndpoint>] extends [never]
				? never
				: 'reqParams')

// Callers pass what the schemas accept (`z.input`): fields with `.default()`
// are optional and transforms take their pre-transform type.
type SchemaInputs<TEndpoint extends ApiEndpoint> = {
	reqBody: TEndpoint['reqBodySchema'] extends z.ZodType
		? z.input<TEndpoint['reqBodySchema']>
		: unknown
	reqParams: TEndpoint['reqParamsSchema'] extends z.ZodType
		? z.input<TEndpoint['reqParamsSchema']>
		: [EndpointPathParamNames<TEndpoint>] extends [never]
			? PathParams
			: Record<EndpointPathParamNames<TEndpoint>, string | number>
	reqQuery: TEndpoint['reqQuerySchema'] extends z.ZodType
		? z.input<TEndpoint['reqQuerySchema']>
		: QueryParams
	reqHeaders: TEndpoint['reqHeadersSchema'] extends z.ZodType
		? z.input<TEndpoint['reqHeadersSchema']>
		: Record<string, string>
}

type CommonRequestOptions = {
	url?: string
	signal?: AbortSignal
	timeoutMs?: number
	retries?: number
	fetch?: FetchLike
	meta?: RequestMeta
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
		): Promise<ApiWrapperResponse<EndpointResponse<T[K]>>>
		<K extends keyof A>(
			actionKey: K,
			...args: ActionArgs<A[K]>
		): Promise<ActionOutput<A[K]>>
	}
	cache: ActionCache
	/**
	 * The same endpoints and actions, resolving to `Result` instead of throwing
	 * `ApiError`s. Other errors (bugs in hooks or middleware) still throw.
	 */
	safe: {
		[K in keyof T]: (
			...args: RequestArgs<T[K]>
		) => Promise<Result<ApiWrapperResponse<EndpointResponse<T[K]>>, ApiError>>
	} & {
		[K in keyof A]: (
			...args: ActionArgs<A[K]>
		) => Promise<Result<ActionOutput<A[K]>, ApiError>>
	}
} & {
	[K in keyof T]: (
		...args: RequestArgs<T[K]>
	) => Promise<ApiWrapperResponse<EndpointResponse<T[K]>>>
} & {
	[K in keyof A]: (...args: ActionArgs<A[K]>) => Promise<ActionOutput<A[K]>>
}

/**
 * Any client, for helpers that accept whichever client they're given. Call
 * endpoints through `request` or `safe`; results are `unknown`.
 */
export type AnyApiClient = {
	// Method syntax keeps the key parameter bivariant, so any client fits.
	// biome-ignore lint/suspicious/noExplicitAny: accepts every client's argument shapes
	request(key: string, ...args: any[]): Promise<unknown>
	cache: ActionCache
	// biome-ignore lint/suspicious/noExplicitAny: accepts every client's argument shapes
	safe: Record<string, (...args: any[]) => Promise<Result<unknown, ApiError>>>
}

/** Parsed response data of an endpoint definition (`z.output` of `resSchema`). */
export type EndpointResponse<TEndpoint extends ApiEndpoint> = z.output<
	TEndpoint['resSchema']
>

/** Request input for an endpoint definition (`reqBody`, `reqParams`, …). */
export type EndpointRequest<TEndpoint extends ApiEndpoint> =
	RequestInput<TEndpoint>

/** Response data of a client method: `InferResponse<typeof api, 'usersGet'>`. */
export type InferResponse<
	TClient,
	K extends keyof TClient
> = TClient[K] extends (...args: never[]) => Promise<infer R>
	? R extends ApiWrapperResponse<infer D>
		? D
		: R
	: never

/** First argument of a client method: `InferRequest<typeof api, 'usersGet'>`. */
export type InferRequest<
	TClient,
	K extends keyof TClient
> = TClient[K] extends (...args: infer P) => unknown ? NonNullable<P[0]> : never

export type ActionsFactoryHelpers<
	T extends Record<string, ApiEndpoint>,
	A extends Record<string, ApiAction> = Record<string, never>
> = {
	api: ApiClient<T, A>
	defineAction: DefineAction<ApiClient<T, A>>
}

/** Any fetch-compatible function; avoids Bun's `typeof fetch` extras like `preconnect`. */
export type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit
) => Promise<Response>

export type ApiMiddlewareContext = {
	/** The client's `name`, when set. */
	client?: string
	/** The endpoint key, e.g. `usersGet`. */
	endpoint: string
	method: HttpMethod
	/** Full URL including the query string. */
	url: string
	/** Outgoing headers. Mutate before `next()` to add headers (e.g. `traceparent`). */
	headers: Record<string, string>
	meta?: RequestMeta
}

/**
 * Wraps one logical request: `onRequest`, every retry attempt, validation and
 * `checkResponse`. Call `next()` to continue; errors it throws are `ApiError`s
 * that were already redacted and passed to `onError`.
 */
export type ApiMiddleware = (
	context: ApiMiddlewareContext,
	next: () => Promise<ApiWrapperResponse<unknown>>
) => Promise<ApiWrapperResponse<unknown>>

export type CheckResponseContext = {
	endpoint: string
	method: HttpMethod
	url: string
	httpStatus: number
	attempt: number
	meta?: RequestMeta
}

export type DefaultHeaders =
	| Record<string, string>
	| (() => Record<string, string> | Promise<Record<string, string>>)

export interface ApiClientConfig<
	T extends Record<string, ApiEndpoint>,
	A extends Record<string, ApiAction> = Record<string, never>
> {
	name?: string
	baseApiUrls: Record<string, BaseApiUrl>
	defaultBaseApiUrl?: string
	endpoints: T
	/** Static headers, or a function resolved on every request (e.g. auth from a secret store). */
	defaultHeaders?: DefaultHeaders
	timeoutMs?: number
	retries?: number
	retryDelayMs?: number | ((attempt: number) => number)
	maxRetryDelayMs?: number
	shouldRetry?: (context: RetryContext) => boolean
	logger?: Pick<Console, 'debug' | 'error'>
	fetch?: FetchLike
	/** Middleware around each whole request, in array order (first is outermost). */
	use?: ApiMiddleware[]
	/**
	 * Runs after `resSchema` validation on every attempt. Throw to reject the
	 * response; non-`ApiError` throws become `ApiResponseError`, which the
	 * default retry policy does not retry.
	 */
	checkResponse?: (
		data: unknown,
		context: CheckResponseContext
	) => void | Promise<void>
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
	ApiRequestMeta,
	RequestMeta,
	BaseApiUrl,
	HttpMethod,
	PathParams,
	QueryParams,
	RequestBodyFormat,
	ApiErrorContext
} from './shared'
