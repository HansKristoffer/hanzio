import { ZodError } from 'zod'
import { type ConfigError, RequestValidationError } from './errors'
import { normalizeHeaders } from './headers'
import type {
	ApiErrorContext,
	BaseApiUrl,
	PathParams,
	QueryParams
} from './shared'
import type { ApiEndpoint } from './types'

export function buildUrl(
	endpoint: ApiEndpoint,
	params: PathParams | undefined,
	reqQuery: QueryParams | undefined,
	baseApiUrls: Record<string, BaseApiUrl>,
	defaultBaseApiUrl: string | undefined,
	url: string | undefined,
	configError: (msg: string) => ConfigError
) {
	if (url) {
		const finalUrl = replacePathParams(url, params, configError)
		const queryString = new URLSearchParams(
			buildQueryParamsRaw(endpoint, reqQuery)
		).toString()
		return {
			finalUrl,
			fullUrl: queryString ? `${finalUrl}?${queryString}` : finalUrl
		}
	}

	const defaultBaseUrl = defaultBaseApiUrl ?? Object.keys(baseApiUrls)[0]
	if (!defaultBaseUrl) {
		throw configError('At least one base API URL is required')
	}

	const baseUrlKey = endpoint.baseApiUrl ?? defaultBaseUrl
	const configBaseUrl = baseApiUrls[baseUrlKey]
	if (!configBaseUrl) {
		throw configError(`Unknown base API URL: ${baseUrlKey}`)
	}

	const baseUrl =
		typeof configBaseUrl === 'function' ? configBaseUrl() : configBaseUrl
	const path =
		typeof endpoint.path === 'function' ? endpoint.path(baseUrl) : endpoint.path
	const finalUrl = replacePathParams(`${baseUrl}${path}`, params, configError)
	const queryString = new URLSearchParams(
		buildQueryParamsRaw(endpoint, reqQuery)
	).toString()

	return {
		finalUrl,
		fullUrl: queryString ? `${finalUrl}?${queryString}` : finalUrl
	}
}

export function buildQueryParamsRaw(
	endpoint: ApiEndpoint,
	query: QueryParams | undefined
): Record<string, string> {
	const defaultParams = endpoint.reqDefaultQueryParams ?? {}
	const merged = { ...defaultParams, ...(query ?? {}) }
	return Object.fromEntries(
		Object.entries(merged)
			.filter(([, value]) => value !== undefined)
			.map(([key, value]) => [key, String(value)])
	)
}

export function buildQueryParams(
	endpoint: ApiEndpoint,
	query: QueryParams | undefined,
	ctx: (over?: Partial<ApiErrorContext>) => ApiErrorContext
): Record<string, string> {
	const defaultParams = endpoint.reqDefaultQueryParams ?? {}
	let parsedQuery: QueryParams
	if (endpoint.reqQuerySchema) {
		try {
			parsedQuery = endpoint.reqQuerySchema.parse(query) as QueryParams
		} catch (error) {
			if (error instanceof ZodError) {
				throw new RequestValidationError(error, 'query', query, ctx())
			}
			throw error
		}
	} else {
		parsedQuery = query ?? {}
	}
	const merged = { ...defaultParams, ...parsedQuery }

	return Object.fromEntries(
		Object.entries(merged)
			.filter(([, value]) => value !== undefined)
			.map(([key, value]) => [key, String(value)])
	)
}

export function buildRequestBody(
	endpoint: ApiEndpoint,
	body: unknown,
	ctx: (over?: Partial<ApiErrorContext>) => ApiErrorContext
): unknown {
	if (!endpoint.reqBodySchema) return body

	let parsedBody: Record<string, unknown>
	try {
		parsedBody = endpoint.reqBodySchema.parse(body) as Record<string, unknown>
	} catch (error) {
		if (error instanceof ZodError) {
			throw new RequestValidationError(error, 'body', body, ctx())
		}
		throw error
	}

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

export function buildHeaders(
	endpoint: ApiEndpoint,
	headers: Record<string, string> | undefined,
	defaultHeaders: Record<string, string>,
	ctx: (over?: Partial<ApiErrorContext>) => ApiErrorContext
): Record<string, string> {
	const contentType =
		endpoint.reqBodyFormat === 'json' ? 'application/json' : undefined

	let parsedHeaders: Record<string, string>
	if (endpoint.reqHeadersSchema) {
		try {
			parsedHeaders = endpoint.reqHeadersSchema.parse(headers) as Record<
				string,
				string
			>
		} catch (error) {
			if (error instanceof ZodError) {
				throw new RequestValidationError(error, 'headers', headers, ctx())
			}
			throw error
		}
	} else {
		parsedHeaders = headers ?? {}
	}

	return normalizeHeaders({
		...defaultHeaders,
		...(contentType && { 'Content-Type': contentType }),
		...endpoint.defaultHeaders,
		...parsedHeaders
	})
}

export function replacePathParams(
	path: string,
	params: PathParams | undefined,
	configError: (msg: string) => ConfigError
): string {
	return path.replace(/:(\w+)/g, (_, key: string) => {
		const value = params?.[key]
		if (value === undefined) {
			throw configError(`Missing required path parameter: ${key}`)
		}
		return encodeURIComponent(String(value))
	})
}
