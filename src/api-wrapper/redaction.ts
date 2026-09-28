import type { ApiErrorContext } from './shared'

const SENSITIVE_HEADER_KEYS = new Set([
	'authorization',
	'cookie',
	'set-cookie',
	'x-api-key',
	'x-auth-token'
])

const SENSITIVE_BODY_KEYS = new Set([
	'password',
	'token',
	'accesstoken',
	'access_token',
	'refreshtoken',
	'refresh_token',
	'secret',
	'client_secret',
	'clientsecret',
	'apikey',
	'api_key'
])

// Query strings also carry API keys and presigned-URL signatures.
const SENSITIVE_QUERY_KEYS = new Set([
	...SENSITIVE_BODY_KEYS,
	'key',
	'code',
	'sig',
	'signature',
	'x-amz-signature',
	'x-amz-credential',
	'x-amz-security-token'
])

function redactHeaders(
	headers: Record<string, string> | undefined
): Record<string, string> | undefined {
	if (!headers) return undefined
	const out: Record<string, string> = {}
	for (const [k, v] of Object.entries(headers)) {
		if (SENSITIVE_HEADER_KEYS.has(k.toLowerCase())) {
			out[k] = '[REDACTED]'
		} else {
			out[k] = v
		}
	}
	return out
}

function redactBody(body: unknown): unknown {
	if (body === null || body === undefined) return body
	if (typeof body !== 'object' || Array.isArray(body)) {
		return body
	}
	const rec = body as Record<string, unknown>
	const out: Record<string, unknown> = { ...rec }
	for (const key of Object.keys(out)) {
		if (SENSITIVE_BODY_KEYS.has(key.toLowerCase())) {
			out[key] = '[REDACTED]'
		}
	}
	return out
}

/** Replaces values of sensitive query parameters (`?api_key=…`) in a URL. */
export function redactUrl(url: string): string {
	const queryStart = url.indexOf('?')
	if (queryStart === -1) return url
	const hashStart = url.indexOf('#', queryStart)
	const query = url.slice(
		queryStart + 1,
		hashStart === -1 ? undefined : hashStart
	)
	const redacted = query
		.split('&')
		.map((pair) => {
			const [key = ''] = pair.split('=', 1)
			return SENSITIVE_QUERY_KEYS.has(decodeKey(key).toLowerCase())
				? `${key}=[REDACTED]`
				: pair
		})
		.join('&')
	return `${url.slice(0, queryStart + 1)}${redacted}${hashStart === -1 ? '' : url.slice(hashStart)}`
}

function decodeKey(key: string): string {
	try {
		return decodeURIComponent(key.replace(/\+/g, ' '))
	} catch {
		return key
	}
}

export function defaultRedactContext(ctx: ApiErrorContext): ApiErrorContext {
	return {
		...ctx,
		url: redactUrl(ctx.url),
		requestHeaders: redactHeaders(ctx.requestHeaders),
		requestBody: redactBody(ctx.requestBody),
		meta: ctx.meta
	}
}
