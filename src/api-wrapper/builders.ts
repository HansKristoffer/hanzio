import { ZodError } from 'zod'
import { buildQueryString } from '../url'
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
	queryParams: QueryParams
	baseApiUrls: Record<string, BaseApiUrl>
	defaultBaseApiUrl: string | undefined
	url: string | undefined
	doNotEncodeQueryParams?: boolean
	configError: (msg: string) => ConfigError
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
		finalUrl = replaceUrlPathParams(url, params, configError)
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
		finalUrl = joinUrlPath(
			baseUrl,
			replacePathParams(path, params, configError)
		)
	}

	const queryString = buildQueryString(queryParams, {
		encode: !doNotEncodeQueryParams
	})
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
): QueryParams {
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
	return { ...defaultParams, ...parsedQuery }
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

/** Joins with exactly one `/`; empty paths and query-only paths are appended as-is. */
export function joinUrlPath(base: string, path: string): string {
	if (!path || path.startsWith('?')) return `${base}${path}`
	return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

/** Substitutes `:params` in the path of a full URL only, so ports are left alone. */
function replaceUrlPathParams(
	url: string,
	params: PathParams | undefined,
	configError: (msg: string) => ConfigError
): string {
	const origin = url.match(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i)?.[0] ?? ''
	const rest = url.slice(origin.length)
	const suffixIndex = rest.search(/[?#]/)
	const path = suffixIndex === -1 ? rest : rest.slice(0, suffixIndex)
	return `${origin}${replacePathParams(path, params, configError)}${rest.slice(path.length)}`
}

export function replacePathParams(
	path: string,
	params: PathParams | undefined,
	configError: (msg: string) => ConfigError
): string {
	return path.replace(/:([A-Za-z_]\w*)/g, (_, key: string) => {
		const value = params?.[key]
		if (value === undefined) {
			throw configError(`Missing required path parameter: ${key}`)
		}
		return encodeURIComponent(String(value))
	})
}
