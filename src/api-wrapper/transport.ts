import { ZodError, type z } from 'zod'
import type {
	ApiEndpoint,
	OnResponseContext,
	OnRetryContext,
	RetryContext
} from './types'
import type { ApiErrorContext, HttpMethod } from './shared'
import {
	ConfigError,
	HttpResponseError,
	NetworkError,
	RequestAbortedError,
	RequestTimeoutError,
	RequestValidationError,
	ResponseValidationError
} from './errors'
import {
	buildFetchBody,
	getHeadersAsObject,
	hasJsonContentType
} from './headers'
import { makeJsonParseZodError } from './zod-issues'

export type RequestConfig = {
	method: HttpMethod
	url: string
	queryParams: Record<string, string>
	body: unknown
	headers: Record<string, string>
	doNotEncodeQueryParams?: boolean
	timeoutMs?: number
	fetchFn: typeof fetch
	userSignal?: AbortSignal
}

export async function validateResponse<T extends z.ZodType>(
	schema: T,
	data: unknown,
	ctx: (over?: Partial<ApiErrorContext>) => ApiErrorContext
): Promise<z.infer<T>> {
	try {
		return await schema.parseAsync(data)
	} catch (error) {
		if (error instanceof ZodError) {
			throw new ResponseValidationError(error, data, ctx())
		}
		throw error
	}
}

export async function httpRequest(
	config: RequestConfig,
	ctx: (over?: Partial<ApiErrorContext>) => ApiErrorContext
): Promise<Response> {
	const queryString = config.doNotEncodeQueryParams
		? Object.entries(config.queryParams)
				.map(([key, value]) => `${key}=${value}`)
				.join('&')
		: new URLSearchParams(config.queryParams).toString()
	const fullUrl = queryString ? `${config.url}?${queryString}` : config.url

	const timeoutController = new AbortController()
	const timeout =
		config.timeoutMs === undefined
			? undefined
			: setTimeout(() => timeoutController.abort(), config.timeoutMs)

	const signal = mergeSignals(timeoutController.signal, config.userSignal)

	try {
		return await config.fetchFn(fullUrl, {
			method: config.method,
			headers: config.headers,
			body: buildFetchBody(config.body, config.headers),
			signal
		})
	} catch (error) {
		if (isDomAbortError(error)) {
			if (config.userSignal?.aborted) {
				throw new RequestAbortedError(ctx(), error)
			}
			if (timeoutController.signal.aborted && config.timeoutMs !== undefined) {
				throw new RequestTimeoutError(config.timeoutMs, ctx())
			}
			throw new RequestAbortedError(ctx(), error)
		}
		throw new NetworkError(
			error instanceof Error ? error.message : String(error),
			ctx(),
			error
		)
	} finally {
		if (timeout) clearTimeout(timeout)
	}
}

function isDomAbortError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'name' in error &&
		(error as { name: string }).name === 'AbortError'
	)
}

export function mergeSignals(
	a: AbortSignal,
	b: AbortSignal | undefined
): AbortSignal {
	if (!b) return a
	const anyFn = (
		AbortSignal as unknown as {
			any?: (signals: AbortSignal[]) => AbortSignal
		}
	).any
	if (typeof anyFn === 'function') return anyFn([a, b])

	const controller = new AbortController()
	const onAbort = () => controller.abort()
	if (a.aborted) controller.abort()
	else a.addEventListener('abort', onAbort, { once: true })
	if (b.aborted) controller.abort()
	else b.addEventListener('abort', onAbort, { once: true })
	return controller.signal
}

export async function readErrorResponse(response: Response): Promise<{
	body: string
	headers: Record<string, string>
	status: number
}> {
	const body = await response.text()
	return {
		body,
		headers: getHeadersAsObject(response.headers),
		status: response.status
	}
}

export function getRetryDelay(params: {
	retryDelay: number | ((attempt: number) => number)
	attempt: number
	response?: Response
}): number {
	const { retryDelay, attempt, response } = params
	if (response && (response.status === 429 || response.status === 503)) {
		const retryAfter = response.headers.get('retry-after')
		if (retryAfter) {
			const seconds = Number(retryAfter)
			if (Number.isFinite(seconds)) return seconds * 1000
			const dateMs = Date.parse(retryAfter)
			if (!Number.isNaN(dateMs)) {
				return Math.max(0, dateMs - Date.now())
			}
		}
	}
	if (typeof retryDelay === 'function') return retryDelay(attempt)
	return retryDelay
}

export function shouldAttemptRetryOnError(error: unknown): boolean {
	if (error instanceof HttpResponseError) return false
	if (error instanceof ResponseValidationError) return false
	if (error instanceof RequestValidationError) return false
	if (error instanceof ConfigError) return false
	if (error instanceof RequestAbortedError) return false
	return true
}

export function shouldAttemptRetryOnHttp(retryCtx: RetryContext): boolean {
	const { error, response } = retryCtx
	if (error) return shouldAttemptRetryOnError(error)
	return response ? response.status >= 500 || response.status === 429 : false
}

type MakeRequestArgs<TValidated> = {
	config: RequestConfig
	maxRetries: number
	retryDelay: number | ((attempt: number) => number)
	validateFn: (response: Response) => Promise<TValidated>
	shouldRetry: (context: RetryContext) => boolean
	logger?: Pick<Console, 'debug'>
	ctx: (over?: Partial<ApiErrorContext>) => ApiErrorContext
	endpointName: string
	method: HttpMethod
	fullUrl: string
	meta?: Record<string, unknown>
	onResponse?: (context: OnResponseContext) => void | Promise<void>
	onRetry?: (context: OnRetryContext) => void | Promise<void>
}

export async function makeRequestWithRetry<TValidated>(
	args: MakeRequestArgs<TValidated>
): Promise<{
	validatedData: TValidated
	retryCount: number
	httpStatus: number
}> {
	const {
		config,
		maxRetries,
		retryDelay,
		validateFn,
		shouldRetry,
		logger,
		ctx,
		endpointName,
		method,
		fullUrl,
		meta,
		onResponse,
		onRetry
	} = args
	let retryCount = 0

	while (true) {
		let response: Response | undefined
		try {
			logger?.debug?.('API request', config)
			response = await httpRequest(config, (over) =>
				ctx({ attempt: retryCount, ...over })
			)

			await onResponse?.({
				endpoint: endpointName,
				method,
				url: fullUrl,
				response: response.clone() as Response,
				attempt: retryCount,
				meta
			})

			if (response.status >= 400) {
				const retryCtx: RetryContext = {
					response,
					retryCount,
					maxRetries,
					endpoint: endpointName,
					method,
					url: fullUrl
				}
				if (retryCount < maxRetries && shouldRetry(retryCtx)) {
					const delayMs = getRetryDelay({
						retryDelay,
						attempt: retryCount,
						response
					})
					await onRetry?.({
						...retryCtx,
						delayMs,
						nextAttempt: retryCount + 1
					})
					retryCount++
					await delay(delayMs)
					continue
				}

				const { body, headers: responseHeaders } =
					await readErrorResponse(response)
				throw new HttpResponseError(
					response.status,
					body,
					responseHeaders,
					ctx({ attempt: retryCount })
				)
			}

			return {
				validatedData: await validateFn(response),
				retryCount,
				httpStatus: response.status
			}
		} catch (error) {
			if (
				error instanceof HttpResponseError ||
				error instanceof ResponseValidationError ||
				error instanceof RequestValidationError ||
				error instanceof ConfigError ||
				error instanceof RequestAbortedError
			) {
				throw error
			}

			const retryCtx: RetryContext = {
				error,
				retryCount,
				maxRetries,
				endpoint: endpointName,
				method,
				url: fullUrl
			}
			if (retryCount >= maxRetries || !shouldRetry(retryCtx)) {
				throw error
			}

			const delayMs = getRetryDelay({
				retryDelay,
				attempt: retryCount,
				response: undefined
			})
			await onRetry?.({
				...retryCtx,
				delayMs,
				nextAttempt: retryCount + 1
			})
			retryCount++
			await delay(delayMs)
		}
	}
}

export async function validateAndTransformResponse<T extends z.ZodType>(
	endpoint: ApiEndpoint<
		z.ZodType | undefined,
		z.ZodType | undefined,
		z.ZodType | undefined,
		z.ZodType | undefined,
		T
	>,
	response: Response,
	ctx: (over?: Partial<ApiErrorContext>) => ApiErrorContext
): Promise<z.infer<T>> {
	const responseHeaders = getHeadersAsObject(response.headers)
	let responseData: unknown
	if (hasJsonContentType(responseHeaders)) {
		const text = await response.text()
		try {
			responseData = text === '' ? undefined : JSON.parse(text)
		} catch (error) {
			throw new ResponseValidationError(
				makeJsonParseZodError(error, text),
				text,
				ctx()
			)
		}
	} else {
		responseData = await response.text()
	}
	const transformedData = endpoint.resFormatter
		? endpoint.resFormatter(responseData, responseHeaders)
		: responseData

	return validateResponse(endpoint.resSchema, transformedData, ctx)
}

export function defaultShouldRetry(ctx: RetryContext): boolean {
	if (ctx.error) return shouldAttemptRetryOnError(ctx.error)
	return shouldAttemptRetryOnHttp(ctx)
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
