import type { UrlQueryParams } from '../url'

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
/** Array values repeat the key (`a=1&a=2`); `null`/`undefined` are skipped. */
export type QueryParams = UrlQueryParams

/**
 * Augment to type `meta` on requests, actions, hooks, middleware and errors:
 *
 * @example
 * declare module 'hanzio/api-wrapper' {
 *   interface ApiRequestMeta { traceId: string; tenantId?: string }
 * }
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmentation target
export interface ApiRequestMeta {}

/** `ApiRequestMeta` once augmented, otherwise any record. */
export type RequestMeta = keyof ApiRequestMeta extends never
	? Record<string, unknown>
	: ApiRequestMeta

export type ApiErrorContext = {
	endpoint: string
	method: HttpMethod
	url: string
	attempt: number
	maxRetries: number
	elapsedMs: number
	requestHeaders?: Record<string, string>
	requestBody?: unknown
	meta?: RequestMeta
}
