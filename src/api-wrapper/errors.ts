import type { ZodError } from 'zod'
import { getHeader } from './headers'
import type { ApiErrorContext } from './shared'
import {
	formatZodIssues,
	previewValue,
	renderIssueSummary,
	tryParseJson,
	type FormattedZodIssue
} from './zod-issues'

const MAX_BODY_PREVIEW = 500

/**
 * Where a request failed, for logs and alerts:
 * - `server_error`: the API returned 5xx
 * - `client_error`: the API rejected the request (4xx: auth, params, body)
 * - `input_validation`: the caller's data failed a request schema; nothing was sent
 * - `output_validation`: the response wasn't JSON or didn't match `resSchema`
 * - `response_rejected`: `checkResponse` rejected a valid response
 * - `network` / `timeout` / `aborted`: the request didn't complete
 * - `config`: the client or call is misconfigured
 * - `action`: a composite action handler threw
 */
export type ApiErrorCategory =
	| 'server_error'
	| 'client_error'
	| 'input_validation'
	| 'output_validation'
	| 'response_rejected'
	| 'network'
	| 'timeout'
	| 'aborted'
	| 'config'
	| 'action'
	| 'unknown'

export class ApiError extends Error {
	public context: ApiErrorContext
	public override cause?: unknown

	get category(): ApiErrorCategory {
		return 'unknown'
	}

	constructor(
		message: string,
		context: ApiErrorContext,
		options?: { cause?: unknown }
	) {
		super(message)
		this.name = 'ApiError'
		this.context = context
		this.cause = options?.cause
	}

	toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			category: this.category,
			message: this.message,
			context: this.context
		}
	}
}

export class HttpResponseError extends ApiError {
	public readonly status: number
	public readonly body: string
	public readonly bodyJson?: unknown
	public readonly responseHeaders: Record<string, string>
	public readonly requestId?: string

	constructor(
		status: number,
		body: string,
		responseHeaders: Record<string, string>,
		context: ApiErrorContext
	) {
		const preview =
			body.length > MAX_BODY_PREVIEW
				? `${body.slice(0, MAX_BODY_PREVIEW)}…`
				: body
		super(
			`HTTP ${status} ${context.method} ${context.url} - ${preview}`,
			context
		)
		this.name = 'HttpResponseError'
		this.status = status
		this.body = body
		this.responseHeaders = responseHeaders
		this.requestId =
			getHeader(responseHeaders, 'x-request-id') ??
			getHeader(responseHeaders, 'x-correlation-id')
		this.bodyJson = tryParseJson(body)
	}

	override get category(): ApiErrorCategory {
		return this.status >= 500 ? 'server_error' : 'client_error'
	}

	override toJSON(): Record<string, unknown> {
		return {
			...super.toJSON(),
			status: this.status,
			body: this.body,
			bodyJson: this.bodyJson,
			requestId: this.requestId,
			responseHeaders: this.responseHeaders
		}
	}
}

export class ResponseValidationError extends ApiError {
	public readonly zodError: ZodError
	public readonly rawResponse: unknown
	public readonly issues: FormattedZodIssue[]
	public readonly validationIssues: string
	/** True when the body wasn't valid JSON (rather than failing `resSchema`). */
	public readonly invalidJson: boolean

	constructor(
		zodError: ZodError,
		rawResponse: unknown,
		context: ApiErrorContext,
		options: { invalidJson?: boolean } = {}
	) {
		const issues = formatZodIssues(zodError, rawResponse)
		const summary = renderIssueSummary(issues)
		super(
			`Response validation failed (${context.method} ${context.url}):\n${summary}`,
			context,
			{ cause: zodError }
		)
		this.name = 'ResponseValidationError'
		this.invalidJson = options.invalidJson ?? false
		this.zodError = zodError
		this.rawResponse = rawResponse
		this.issues = issues
		this.validationIssues = issues
			.map((i) => `${i.path}: ${i.message}`)
			.join('; ')
	}

	override get category(): ApiErrorCategory {
		return 'output_validation'
	}

	override toJSON(): Record<string, unknown> {
		return {
			...super.toJSON(),
			invalidJson: this.invalidJson,
			issues: this.issues,
			validationIssues: this.validationIssues,
			rawResponsePreview: previewValue(this.rawResponse, 1000)
		}
	}
}

/** Which request schema failed; `input` is an action's input schema. */
export type RequestValidationTarget =
	| 'body'
	| 'query'
	| 'params'
	| 'headers'
	| 'input'

export class RequestValidationError extends ApiError {
	public readonly zodError: ZodError
	public readonly target: RequestValidationTarget
	public readonly rawInput: unknown
	public readonly issues: FormattedZodIssue[]
	public readonly validationIssues: string

	constructor(
		zodError: ZodError,
		target: RequestValidationTarget,
		rawInput: unknown,
		context: ApiErrorContext
	) {
		const issues = formatZodIssues(zodError, rawInput)
		const summary = renderIssueSummary(issues)
		super(
			`Request ${target} validation failed (${context.method} ${context.url}):\n${summary}`,
			context,
			{ cause: zodError }
		)
		this.name = 'RequestValidationError'
		this.zodError = zodError
		this.target = target
		this.rawInput = rawInput
		this.issues = issues
		this.validationIssues = issues
			.map((i) => `${i.path}: ${i.message}`)
			.join('; ')
	}

	override get category(): ApiErrorCategory {
		return 'input_validation'
	}

	override toJSON(): Record<string, unknown> {
		return {
			...super.toJSON(),
			target: this.target,
			issues: this.issues,
			validationIssues: this.validationIssues
		}
	}
}

export class RequestTimeoutError extends ApiError {
	public readonly timeoutMs: number

	constructor(timeoutMs: number, context: ApiErrorContext) {
		super(
			`Request timed out after ${timeoutMs}ms: ${context.method} ${context.url}`,
			context
		)
		this.name = 'RequestTimeoutError'
		this.timeoutMs = timeoutMs
	}

	override get category(): ApiErrorCategory {
		return 'timeout'
	}
}

export class NetworkError extends ApiError {
	constructor(message: string, context: ApiErrorContext, cause?: unknown) {
		super(message, context, { cause })
		this.name = 'NetworkError'
	}

	override get category(): ApiErrorCategory {
		return 'network'
	}
}

export class RequestAbortedError extends ApiError {
	constructor(context: ApiErrorContext, cause?: unknown) {
		super(`Request aborted: ${context.method} ${context.url}`, context, {
			cause
		})
		this.name = 'RequestAbortedError'
	}

	override get category(): ApiErrorCategory {
		return 'aborted'
	}
}

export class ConfigError extends ApiError {
	constructor(message: string, context: ApiErrorContext) {
		super(message, context)
		this.name = 'ConfigError'
	}

	override get category(): ApiErrorCategory {
		return 'config'
	}
}

/**
 * Thrown when the client's `checkResponse` rejects a response that passed
 * schema validation (e.g. HTTP 200 with `{ success: false }`).
 */
export class ApiResponseError extends ApiError {
	public readonly data: unknown

	constructor(
		message: string,
		data: unknown,
		context: ApiErrorContext,
		cause?: unknown
	) {
		super(message, context, { cause })
		this.name = 'ApiResponseError'
		this.data = data
	}

	override get category(): ApiErrorCategory {
		return 'response_rejected'
	}

	override toJSON(): Record<string, unknown> {
		return {
			...super.toJSON(),
			dataPreview: previewValue(this.data, 1000)
		}
	}
}

export class ActionError extends ApiError {
	constructor(message: string, context: ApiErrorContext, cause?: unknown) {
		super(message, context, { cause })
		this.name = 'ActionError'
	}

	override get category(): ApiErrorCategory {
		return 'action'
	}
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError
export const isHttpResponseError = (e: unknown): e is HttpResponseError =>
	e instanceof HttpResponseError
export const isResponseValidationError = (
	e: unknown
): e is ResponseValidationError => e instanceof ResponseValidationError
export const isRequestValidationError = (
	e: unknown
): e is RequestValidationError => e instanceof RequestValidationError
export const isRequestTimeoutError = (e: unknown): e is RequestTimeoutError =>
	e instanceof RequestTimeoutError
export const isNetworkError = (e: unknown): e is NetworkError =>
	e instanceof NetworkError
export const isRequestAbortedError = (e: unknown): e is RequestAbortedError =>
	e instanceof RequestAbortedError
export const isConfigError = (e: unknown): e is ConfigError =>
	e instanceof ConfigError
export const isActionError = (e: unknown): e is ActionError =>
	e instanceof ActionError
export const isApiResponseError = (e: unknown): e is ApiResponseError =>
	e instanceof ApiResponseError

export function isNonRetryableApiError(error: unknown): boolean {
	return (
		error instanceof HttpResponseError ||
		error instanceof ResponseValidationError ||
		error instanceof ApiResponseError ||
		error instanceof RequestValidationError ||
		error instanceof ConfigError ||
		error instanceof RequestAbortedError
	)
}
