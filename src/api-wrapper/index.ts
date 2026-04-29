import { type z, ZodError } from 'zod'

export type HttpMethod =
	| 'GET'
	| 'POST'
	| 'PUT'
	| 'DELETE'
	| 'PATCH'
	| 'HEAD'
	| 'OPTIONS'

export type RequestBodyFormat = 'json' | 'form-data'
export type BaseApiUrl = string | (() => string)
export type PathParams = Record<string, string | number>
export type QueryParams = Record<string, string | number | boolean | undefined>

export class ResponseValidationError extends Error {
	public readonly zodError: ZodError
	public readonly rawResponse: unknown
	public readonly validationIssues: string

	constructor(zodError: ZodError, rawResponse: unknown) {
		const issues = zodError.issues
			.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
			.join('; ')

		super(`Response validation failed: ${issues}`)
		this.name = 'ResponseValidationError'
		this.zodError = zodError
		this.rawResponse = rawResponse
		this.validationIssues = issues
	}
}

export class HttpResponseError extends Error {
	public readonly status: number
	public readonly body: string

	constructor(status: number, body: string) {
		super(`HTTP error: ${status} - ${body}`)
		this.name = 'HttpResponseError'
		this.status = status
		this.body = body
	}
}

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
	requestSizeMb: number
	responseSizeMb: number
	requestSizeTotalMb: number
	responseTimeMs: number
	httpStatus: number
	retryCount: number
}

export type RetryContext = {
	error?: unknown
	response?: Response
	retryCount: number
	maxRetries: number
}

export interface ApiClientConfig<T extends Record<string, ApiEndpoint>> {
	name?: string
	baseApiUrls: Record<string, BaseApiUrl>
	defaultBaseApiUrl?: string
	endpoints: T
	defaultHeaders?: Record<string, string>
	timeoutMs?: number
	retries?: number
	retryDelayMs?: number
	shouldRetry?: (context: RetryContext) => boolean
	logger?: Pick<Console, 'debug' | 'error'>
	fetch?: typeof fetch
	onRequestStart?: (context: { endpoint: string; url: string }) => void
	onRequestEnd?: (context: {
		endpoint: string
		url: string
		status: number
		retryCount: number
		responseTimeMs: number
	}) => void
}

type RequestInput<TEndpoint extends ApiEndpoint> = {
	reqBody?: InferOptionalSchema<TEndpoint['reqBodySchema']>
	reqParams?: InferOptionalSchema<TEndpoint['reqParamsSchema']>
	reqQuery?: InferOptionalSchema<TEndpoint['reqQuerySchema']>
	reqHeaders?: InferOptionalSchema<TEndpoint['reqHeadersSchema']>
	url?: string
}

type InferOptionalSchema<TSchema> = TSchema extends z.ZodType
	? z.infer<TSchema>
	: undefined

type RequestConfig = {
	method: HttpMethod
	url: string
	queryParams: Record<string, string>
	body: unknown
	headers: Record<string, string>
	doNotEncodeQueryParams?: boolean
	timeoutMs?: number
	fetchFn: typeof fetch
}

export function createApiClient<T extends Record<string, ApiEndpoint>>(
	apiConfig: ApiClientConfig<T>
) {
	const request = async <K extends keyof T>(
		endpointKey: K,
		input: RequestInput<T[K]> = {}
	): Promise<ApiWrapperResponse<z.infer<T[K]['resSchema']>>> => {
		const endpoint = apiConfig.endpoints[endpointKey]

		if (!endpoint) {
			throw new Error(`Unknown API endpoint: ${String(endpointKey)}`)
		}

		const { finalUrl, fullUrl } = buildUrl(
			endpoint,
			input.reqParams as PathParams | undefined,
			input.reqQuery as QueryParams | undefined,
			apiConfig.baseApiUrls,
			apiConfig.defaultBaseApiUrl,
			input.url
		)
		const endpointName = apiConfig.name
			? `${apiConfig.name}.${String(endpointKey)}`
			: String(endpointKey)
		const startedAt = Date.now()
		let retryCount = 0
		let httpStatus = 0

		apiConfig.onRequestStart?.({ endpoint: endpointName, url: fullUrl })

		try {
			const config: RequestConfig = {
				method: endpoint.method,
				url: finalUrl,
				queryParams: buildQueryParams(
					endpoint,
					input.reqQuery as QueryParams | undefined
				),
				body: buildRequestBody(endpoint, input.reqBody),
				headers: buildHeaders(
					endpoint,
					input.reqHeaders as Record<string, string> | undefined,
					apiConfig.defaultHeaders ?? {}
				),
				doNotEncodeQueryParams: endpoint.doNotEncodeQueryParams,
				timeoutMs: apiConfig.timeoutMs,
				fetchFn: apiConfig.fetch ?? fetch
			}

			const result = await makeRequestWithRetry(
				config,
				apiConfig.retries ?? 3,
				apiConfig.retryDelayMs ?? 300,
				(response) => validateAndTransformResponse(endpoint, response),
				apiConfig.shouldRetry ?? defaultShouldRetry,
				apiConfig.logger
			)

			retryCount = result.retryCount
			httpStatus = result.httpStatus

			const responseTimeMs = Date.now() - startedAt
			const responseSizeMb = calculateSizeInMb(result.validatedData)
			const requestSizeMb = calculateSizeInMb({
				method: config.method,
				url: fullUrl,
				body: config.body,
				headers: config.headers
			})

			apiConfig.onRequestEnd?.({
				endpoint: endpointName,
				url: fullUrl,
				status: httpStatus,
				retryCount,
				responseTimeMs
			})

			return {
				data: result.validatedData as z.infer<T[K]['resSchema']>,
				requestSizeMb,
				responseSizeMb,
				requestSizeTotalMb: requestSizeMb + responseSizeMb,
				responseTimeMs,
				httpStatus,
				retryCount
			}
		} catch (error) {
			apiConfig.logger?.error?.(error)
			throw error
		}
	}

	return { request }
}

export const createApiWrapper = createApiClient

async function validateResponse<T extends z.ZodType>(
	schema: T,
	data: unknown
): Promise<z.infer<T>> {
	try {
		return await schema.parseAsync(data)
	} catch (error) {
		if (error instanceof ZodError) {
			throw new ResponseValidationError(error, data)
		}
		throw error
	}
}

async function httpRequest(config: RequestConfig): Promise<Response> {
	const queryString = config.doNotEncodeQueryParams
		? Object.entries(config.queryParams)
				.map(([key, value]) => `${key}=${value}`)
				.join('&')
		: new URLSearchParams(config.queryParams).toString()
	const fullUrl = queryString ? `${config.url}?${queryString}` : config.url
	const abortController = new AbortController()
	const timeout =
		config.timeoutMs === undefined
			? undefined
			: setTimeout(() => abortController.abort(), config.timeoutMs)

	try {
		return await config.fetchFn(fullUrl, {
			method: config.method,
			headers: config.headers,
			body: buildFetchBody(config.body, config.headers),
			signal: abortController.signal
		})
	} finally {
		if (timeout) clearTimeout(timeout)
	}
}

async function makeRequestWithRetry<TValidated>(
	config: RequestConfig,
	maxRetries: number,
	retryDelayMs: number,
	validateFn: (response: Response) => Promise<TValidated>,
	shouldRetry: (context: RetryContext) => boolean,
	logger?: Pick<Console, 'debug'>
): Promise<{
	validatedData: TValidated
	retryCount: number
	httpStatus: number
}> {
	let retryCount = 0

	while (true) {
		try {
			logger?.debug?.('API request', config)
			const response = await httpRequest(config)

			if (response.status >= 400) {
				if (
					retryCount < maxRetries &&
					shouldRetry({ response, retryCount, maxRetries })
				) {
					retryCount++
					await delay(retryDelayMs)
					continue
				}

				throw new HttpResponseError(response.status, await response.text())
			}

			return {
				validatedData: await validateFn(response),
				retryCount,
				httpStatus: response.status
			}
		} catch (error) {
			if (error instanceof HttpResponseError) throw error

			if (
				retryCount >= maxRetries ||
				!shouldRetry({ error, retryCount, maxRetries })
			) {
				throw error
			}

			retryCount++
			await delay(retryDelayMs)
		}
	}
}

async function validateAndTransformResponse<T extends z.ZodType>(
	endpoint: ApiEndpoint<
		z.ZodType | undefined,
		z.ZodType | undefined,
		z.ZodType | undefined,
		z.ZodType | undefined,
		T
	>,
	response: Response
): Promise<z.infer<T>> {
	const responseHeaders = getHeadersAsObject(response.headers)
	const contentType = responseHeaders['content-type'] ?? ''
	const responseData: unknown = contentType.includes('application/json')
		? await response.json()
		: await response.text()
	const transformedData = endpoint.resFormatter
		? endpoint.resFormatter(responseData, responseHeaders)
		: responseData

	return validateResponse(endpoint.resSchema, transformedData)
}

function buildUrl(
	endpoint: ApiEndpoint,
	params: PathParams | undefined,
	reqQuery: QueryParams | undefined,
	baseApiUrls: Record<string, BaseApiUrl>,
	defaultBaseApiUrl?: string,
	url?: string
) {
	if (url) {
		const finalUrl = replacePathParams(url, params)
		const queryString = new URLSearchParams(
			buildQueryParams(endpoint, reqQuery)
		).toString()
		return {
			finalUrl,
			fullUrl: queryString ? `${finalUrl}?${queryString}` : finalUrl
		}
	}

	const defaultBaseUrl = defaultBaseApiUrl ?? Object.keys(baseApiUrls)[0]
	if (!defaultBaseUrl) {
		throw new Error('At least one base API URL is required')
	}

	const baseUrlKey = endpoint.baseApiUrl ?? defaultBaseUrl
	const configBaseUrl = baseApiUrls[baseUrlKey]
	if (!configBaseUrl) {
		throw new Error(`Unknown base API URL: ${baseUrlKey}`)
	}

	const baseUrl =
		typeof configBaseUrl === 'function' ? configBaseUrl() : configBaseUrl
	const path =
		typeof endpoint.path === 'function' ? endpoint.path(baseUrl) : endpoint.path
	const finalUrl = replacePathParams(`${baseUrl}${path}`, params)
	const queryString = new URLSearchParams(
		buildQueryParams(endpoint, reqQuery)
	).toString()

	return {
		finalUrl,
		fullUrl: queryString ? `${finalUrl}?${queryString}` : finalUrl
	}
}

function buildQueryParams(
	endpoint: ApiEndpoint,
	query: QueryParams | undefined
): Record<string, string> {
	const defaultParams = endpoint.reqDefaultQueryParams ?? {}
	const parsedQuery = endpoint.reqQuerySchema
		? (endpoint.reqQuerySchema.parse(query) as QueryParams)
		: (query ?? {})
	const merged = { ...defaultParams, ...parsedQuery }

	return Object.fromEntries(
		Object.entries(merged)
			.filter(([, value]) => value !== undefined)
			.map(([key, value]) => [key, String(value)])
	)
}

function buildRequestBody(endpoint: ApiEndpoint, body: unknown): unknown {
	if (!endpoint.reqBodySchema) return body

	const parsedBody = endpoint.reqBodySchema.parse(body) as Record<
		string,
		unknown
	>

	if (endpoint.reqBodyFormat !== 'form-data') {
		return parsedBody
	}

	const formData = new FormData()
	for (const [key, value] of Object.entries(parsedBody)) {
		if (value == null) continue
		formData.set(key, value instanceof Blob ? value : String(value))
	}

	return formData
}

function buildHeaders(
	endpoint: ApiEndpoint,
	headers: Record<string, string> | undefined,
	defaultHeaders: Record<string, string>
): Record<string, string> {
	const contentType =
		endpoint.reqBodyFormat === 'json' ? 'application/json' : undefined
	const parsedHeaders = endpoint.reqHeadersSchema
		? (endpoint.reqHeadersSchema.parse(headers) as Record<string, string>)
		: (headers ?? {})

	return {
		...defaultHeaders,
		...(contentType && { 'Content-Type': contentType }),
		...endpoint.defaultHeaders,
		...parsedHeaders
	}
}

function buildFetchBody(
	body: unknown,
	headers: Record<string, string>
): RequestInit['body'] {
	if (body === undefined || body === null) return undefined
	if (body instanceof FormData || body instanceof Blob) return body
	if (headers['Content-Type'] === 'application/json')
		return JSON.stringify(body)
	return body as RequestInit['body']
}

function replacePathParams(
	path: string,
	params: PathParams | undefined
): string {
	return path.replace(/:(\w+)/g, (_, key: string) => {
		const value = params?.[key]
		if (value === undefined) {
			throw new Error(`Missing required path parameter: ${key}`)
		}
		return encodeURIComponent(String(value))
	})
}

function getHeadersAsObject(headers: Headers): Record<string, string> {
	const result: Record<string, string> = {}
	headers.forEach((value, key) => {
		result[key] = value
	})
	return result
}

function calculateSizeInMb(data: unknown): number {
	const sizeInBytes = new TextEncoder().encode(JSON.stringify(data)).length
	return sizeInBytes / (1024 * 1024)
}

function defaultShouldRetry({ error, response }: RetryContext): boolean {
	if (error) return true
	return response ? response.status >= 500 : false
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
