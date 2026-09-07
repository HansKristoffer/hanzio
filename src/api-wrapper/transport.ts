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
	isNonRetryableApiError,
	NetworkError,
	RequestAbortedError,
	RequestTimeoutError,
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
	fullUrl: string
	body: unknown
	headers: Record<string, string>
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
	const timeoutController = new AbortController()
	const timeout =
		config.timeoutMs === undefined
			? undefined
			: setTimeout(() => timeoutController.abort(), config.timeoutMs)

	const signal = mergeSignals(timeoutController.signal, config.userSignal)

	try {
		return await config.fetchFn(config.fullUrl, {
			method: config.method,
			headers: config.headers,
			body: buildFetchBody(
				config.body,
				config.headers,
				(msg) => new ConfigError(msg, ctx())
			),
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
		if (error instanceof ConfigError) throw error
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
	maxRetryDelayMs?: number
}): number {
	const maxDelay = params.maxRetryDelayMs ?? 30_000
	const { retryDelay, attempt, response } = params
	if (response && (response.status === 429 || response.status === 503)) {
		const retryAfter = response.headers.get('retry-after')
		if (retryAfter) {
			const seconds = Number(retryAfter)
			if (Number.isFinite(seconds)) {
				return Math.min(Math.max(0, seconds * 1000), maxDelay)
			}
			const dateMs = Date.parse(retryAfter)
			if (!Number.isNaN(dateMs)) {
				return Math.min(Math.max(0, dateMs - Date.now()), maxDelay)
			}
		}
	}
	const delayMs =
		typeof retryDelay === 'function' ? retryDelay(attempt) : retryDelay
	return Math.min(delayMs, maxDelay)
}

export function shouldAttemptRetryOnError(error: unknown): boolean {
	return !isNonRetryableApiError(error)
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
	maxRetryDelayMs?: number
	validateFn: (response: Response, attempt: number) => Promise<TValidated>
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
		maxRetryDelayMs,
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
						response,
						maxRetryDelayMs
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
				validatedData: await validateFn(response, retryCount),
				retryCount,
				httpStatus: response.status
			}
		} catch (error) {
			if (isNonRetryableApiError(error)) {
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
				response: undefined,
				maxRetryDelayMs
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
): Promise<{ data: z.infer<T>; responseSizeBytes: number }> {
	const responseHeaders = getHeadersAsObject(response.headers)
	const text = await response.text()
	const responseSizeBytes = new TextEncoder().encode(text).length
	let responseData: unknown
	if (hasJsonContentType(responseHeaders)) {
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
		responseData = text
	}
	const transformedData = endpoint.resFormatter
		? endpoint.resFormatter(responseData, responseHeaders)
		: responseData

	const data = await validateResponse(endpoint.resSchema, transformedData, ctx)
	return { data, responseSizeBytes }
}

export function defaultShouldRetry(ctx: RetryContext): boolean {
	if (ctx.error) return shouldAttemptRetryOnError(ctx.error)
	return shouldAttemptRetryOnHttp(ctx)
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
