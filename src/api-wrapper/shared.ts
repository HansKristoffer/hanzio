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

export type ApiErrorContext = {
	endpoint: string
	method: HttpMethod
	url: string
	attempt: number
	maxRetries: number
	elapsedMs: number
	requestHeaders?: Record<string, string>
	requestBody?: unknown
	meta?: Record<string, unknown>
}
