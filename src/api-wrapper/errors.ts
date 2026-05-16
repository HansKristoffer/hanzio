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

export class ApiError extends Error {
	public context: ApiErrorContext
	public override cause?: unknown

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

	constructor(
		zodError: ZodError,
		rawResponse: unknown,
		context: ApiErrorContext
	) {
		const issues = formatZodIssues(zodError, rawResponse)
		const summary = renderIssueSummary(issues)
		super(
			`Response validation failed (${context.method} ${context.url}):\n${summary}`,
			context,
			{ cause: zodError }
		)
		this.name = 'ResponseValidationError'
		this.zodError = zodError
		this.rawResponse = rawResponse
		this.issues = issues
		this.validationIssues = issues
			.map((i) => `${i.path}: ${i.message}`)
			.join('; ')
	}

	override toJSON(): Record<string, unknown> {
		return {
			...super.toJSON(),
			issues: this.issues,
			validationIssues: this.validationIssues,
			rawResponsePreview: previewValue(this.rawResponse, 1000)
		}
	}
}

export type RequestValidationTarget = 'body' | 'query' | 'params' | 'headers'

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
}

export class NetworkError extends ApiError {
	constructor(message: string, context: ApiErrorContext, cause?: unknown) {
		super(message, context, { cause })
		this.name = 'NetworkError'
	}
}

export class RequestAbortedError extends ApiError {
	constructor(context: ApiErrorContext, cause?: unknown) {
		super(`Request aborted: ${context.method} ${context.url}`, context, {
			cause
		})
		this.name = 'RequestAbortedError'
	}
}

export class ConfigError extends ApiError {
	constructor(message: string, context: ApiErrorContext) {
		super(message, context)
		this.name = 'ConfigError'
	}
}

export class ActionError extends ApiError {
	constructor(message: string, context: ApiErrorContext, cause?: unknown) {
		super(message, context, { cause })
		this.name = 'ActionError'
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
