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

export type BuildUrlOptions = {
	endpoint: ApiEndpoint
	params: PathParams | undefined
	queryParams: Record<string, string>
	baseApiUrls: Record<string, BaseApiUrl>
	defaultBaseApiUrl: string | undefined
	url: string | undefined
	doNotEncodeQueryParams?: boolean
	configError: (msg: string) => ConfigError
}

export function formatQueryString(
	queryParams: Record<string, string>,
	doNotEncode?: boolean
): string {
	if (Object.keys(queryParams).length === 0) return ''
	return doNotEncode
		? Object.entries(queryParams)
				.map(([key, value]) => `${key}=${value}`)
				.join('&')
		: new URLSearchParams(queryParams).toString()
}

export function buildUrl(options: BuildUrlOptions) {
	const {
		endpoint,
		params,
		queryParams,
		baseApiUrls,
		defaultBaseApiUrl,
		url,
		doNotEncodeQueryParams,
		configError
	} = options

	let finalUrl: string
	if (url) {
		finalUrl = replacePathParams(url, params, configError)
	} else {
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
			typeof endpoint.path === 'function'
				? endpoint.path(baseUrl)
				: endpoint.path
		// Substitute endpoint parameters without interpreting a port or IPv6 host as one.
		finalUrl = `${baseUrl}${replacePathParams(path, params, configError)}`
	}

	const queryString = formatQueryString(queryParams, doNotEncodeQueryParams)
	return {
		finalUrl,
		fullUrl: queryString ? `${finalUrl}?${queryString}` : finalUrl
	}
}

export function buildPathParams(
	endpoint: ApiEndpoint,
	params: PathParams | undefined,
	ctx: (over?: Partial<ApiErrorContext>) => ApiErrorContext
): PathParams | undefined {
	if (!endpoint.reqParamsSchema) return params

	try {
		return endpoint.reqParamsSchema.parse(params) as PathParams
	} catch (error) {
		if (error instanceof ZodError) {
			throw new RequestValidationError(error, 'params', params, ctx())
		}
		throw error
	}
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
