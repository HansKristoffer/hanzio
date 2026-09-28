import {
	ActionError,
	type ApiError,
	type ApiErrorCategory,
	ApiResponseError,
	HttpResponseError,
	RequestTimeoutError,
	RequestValidationError,
	ResponseValidationError
} from './errors'
import { previewValue, renderIssueSummary } from './zod-issues'

const BODY_PREVIEW = 500

const schemaByTarget = {
	body: 'reqBodySchema',
	query: 'reqQuerySchema',
	params: 'reqParamsSchema',
	headers: 'reqHeadersSchema',
	input: 'the action input schema'
} as const

function headline(error: ApiError): string {
	if (error instanceof HttpResponseError) {
		const status = `HTTP ${error.status}`
		if (error.status >= 500) {
			return `server error (${status}): the API failed while handling the request`
		}
		if (error.status === 401 || error.status === 403) {
			return `request rejected (${status}): check credentials and permissions`
		}
		if (error.status === 404) {
			return `request rejected (${status}): check the path and the IDs in it`
		}
		if (error.status === 429) return `rate limited (${status})`
		return `request rejected (${status}): check params, query and body`
	}
	if (error instanceof RequestValidationError) {
		return `input validation failed: the caller's ${error.target} doesn't match ${schemaByTarget[error.target]} (nothing was sent)`
	}
	if (error instanceof ResponseValidationError) {
		return error.invalidJson
			? 'output validation failed: the response body is not valid JSON'
			: "output validation failed: the response doesn't match resSchema"
	}
	if (error instanceof ApiResponseError) {
		return `response rejected by checkResponse: ${error.message}`
	}
	if (error instanceof RequestTimeoutError) {
		return `timed out after ${error.timeoutMs}ms`
	}
	const labels: Partial<Record<ApiErrorCategory, string>> = {
		network: `network error: couldn't reach the API (${error.message})`,
		aborted: 'aborted by the caller',
		config: `configuration error: ${error.message}`,
		action: `action failed: ${error.message}`
	}
	return labels[error.category] ?? error.message
}

function details(error: ApiError): string[] {
	if (error instanceof HttpResponseError) {
		const body =
			error.bodyJson === undefined
				? error.body
				: previewValue(error.bodyJson, BODY_PREVIEW)
		return body
			? [
					`  response: ${body.length > BODY_PREVIEW ? `${body.slice(0, BODY_PREVIEW)}…` : body}`
				]
			: []
	}
	if (
		error instanceof ResponseValidationError ||
		error instanceof RequestValidationError
	) {
		const lines = [renderIssueSummary(error.issues)]
		if (error instanceof ResponseValidationError && !error.invalidJson) {
			lines.push(
				'  fix: update resSchema (or resFormatter), or mark changed fields optional'
			)
		}
		return lines
	}
	if (error instanceof ApiResponseError) {
		return [`  response: ${previewValue(error.data, BODY_PREVIEW)}`]
	}
	if (error instanceof ActionError && error.cause instanceof Error) {
		return error.cause.stack ? [`  cause: ${error.cause.stack}`] : []
	}
	return []
}

/**
 * A multi-line, human-readable summary of an `ApiError` that says up front
 * whether the server, the caller's input, or the response shape is at fault.
 * The client logs this via `logger.error` for every failed request.
 *
 * @example
 * ✗ github.usersGet failed: output validation failed: the response doesn't match resSchema
 *   GET https://api.github.com/users/1 · attempt 1/4 · 212ms
 *   [1] id: Expected number, received string
 *       value: "oops"
 *   fix: update resSchema (or resFormatter), or mark changed fields optional
 */
export function describeApiError(error: ApiError): string {
	const { context } = error
	const sent =
		error.category !== 'input_validation' && error.category !== 'config'
	const meta = [
		context.url ? `${context.method} ${context.url}` : context.method,
		...(sent
			? [`attempt ${context.attempt + 1}/${context.maxRetries + 1}`]
			: []),
		`${context.elapsedMs}ms`
	]
	if (error instanceof HttpResponseError && error.requestId) {
		meta.push(`request id ${error.requestId}`)
	}
	return [
		`✗ ${context.endpoint} failed: ${headline(error)}`,
		`  ${meta.join(' · ')}`,
		...details(error)
	].join('\n')
}

/** Flat, primitive attributes for structured loggers and log processors. */
export function apiErrorLogAttributes(
	error: ApiError
): Record<string, string | number | boolean> {
	const { context } = error
	const attributes: Record<string, string | number | boolean> = {
		errorName: error.name,
		category: error.category,
		endpoint: context.endpoint,
		method: context.method,
		url: context.url,
		attempt: context.attempt,
		maxRetries: context.maxRetries,
		elapsedMs: context.elapsedMs
	}
	if (error instanceof HttpResponseError) {
		attributes.status = error.status
		if (error.requestId) attributes.requestId = error.requestId
	}
	if (
		error instanceof ResponseValidationError ||
		error instanceof RequestValidationError
	) {
		attributes.issueCount = error.issues.length
		attributes.issues = error.validationIssues
	}
	if (error instanceof RequestValidationError) attributes.target = error.target
	if (error instanceof RequestTimeoutError)
		attributes.timeoutMs = error.timeoutMs
	return attributes
}
