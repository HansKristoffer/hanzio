import { ApiError, HttpResponseError } from './errors'
import { redactUrl } from './redaction'
import type { ApiMiddleware, ApiMiddlewareContext } from './types'

// Structural subsets of @opentelemetry/api, so hanzio never imports it. The
// app passes its own tracer (`trace.getTracer('app')`); a type test keeps
// these compatible with the real `Tracer`.
export type OtelAttributes = Record<
	string,
	string | number | boolean | undefined
>

export type OtelSpanLike = {
	setAttributes(attributes: OtelAttributes): unknown
	setStatus(status: { code: number; message?: string }): unknown
	recordException(exception: Error | string): unknown
	end(): void
}

export type OtelTracerLike = {
	startActiveSpan<F extends (span: OtelSpanLike) => unknown>(
		name: string,
		options: { kind?: number; attributes?: OtelAttributes },
		fn: F
	): ReturnType<F>
}

export type OtelMiddlewareOptions = {
	/** Default: `client.endpoint`, or the endpoint key when the client has no `name`. */
	spanName?: (context: ApiMiddlewareContext) => string
	/** Extra attributes set when the span starts. */
	attributes?: (context: ApiMiddlewareContext) => OtelAttributes
	/**
	 * `url.full` keeps the query string with sensitive values redacted
	 * (default). Set `false` to drop the query string entirely.
	 */
	includeQuery?: boolean
	/**
	 * Adds trace-context headers to the outgoing request, e.g.
	 * `(headers) => propagation.inject(context.active(), headers)`. Runs inside
	 * the active span. Not needed when fetch is already auto-instrumented.
	 */
	inject?: (headers: Record<string, string>) => void
}

// Frozen numeric values from the OpenTelemetry API.
const SPAN_KIND_CLIENT = 2
const SPAN_STATUS_ERROR = 2

/**
 * One CLIENT span per logical request (all retries, validation and
 * `checkResponse`), with OpenTelemetry HTTP semantic-convention attributes.
 * It's the active span, so auto-instrumented fetch attempts become children.
 *
 * @example
 * import { trace } from '@opentelemetry/api'
 * createApiClient({ ...config, use: [otelMiddleware(trace.getTracer('app'))] })
 */
export function otelMiddleware(
	tracer: OtelTracerLike,
	options: OtelMiddlewareOptions = {}
): ApiMiddleware {
	const { spanName, attributes, includeQuery = true, inject } = options

	return (context, next) => {
		const url = includeQuery
			? redactUrl(context.url)
			: context.url.split(/[?#]/, 1)[0]!
		const name =
			spanName?.(context) ??
			(context.client
				? `${context.client}.${context.endpoint}`
				: context.endpoint)

		return tracer.startActiveSpan(
			name,
			{
				kind: SPAN_KIND_CLIENT,
				attributes: {
					'http.request.method': context.method,
					'url.full': url,
					'server.address': hostOf(context.url),
					'api.client': context.client,
					'api.endpoint': context.endpoint,
					...attributes?.(context)
				}
			},
			async (span) => {
				inject?.(context.headers)
				try {
					const result = await next()
					span.setAttributes({
						'http.response.status_code': result.httpStatus,
						'http.request.resend_count': result.retryCount || undefined,
						'http.response.body.size': Math.round(
							result.responseSizeMb * 1024 * 1024
						)
					})
					return result
				} catch (error) {
					recordFailure(span, error)
					throw error
				} finally {
					span.end()
				}
			}
		)
	}
}

function recordFailure(span: OtelSpanLike, error: unknown): void {
	if (error instanceof ApiError) {
		const isHttp = error instanceof HttpResponseError
		span.setAttributes({
			'error.type': isHttp ? String(error.status) : error.name,
			'api.error.category': error.category,
			'http.response.status_code': isHttp ? error.status : undefined,
			'http.request.resend_count': error.context.attempt || undefined
		})
	} else {
		span.setAttributes({
			'error.type': error instanceof Error ? error.name : 'unknown'
		})
	}
	span.recordException(error instanceof Error ? error : String(error))
	span.setStatus({
		code: SPAN_STATUS_ERROR,
		message:
			error instanceof Error ? error.message.split('\n', 1)[0] : String(error)
	})
}

function hostOf(url: string): string | undefined {
	try {
		return new URL(url).hostname
	} catch {
		return undefined
	}
}
