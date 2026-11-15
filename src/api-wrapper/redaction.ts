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
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		return body
	}
	const out: Record<string, unknown> = { ...(body as Record<string, unknown>) }
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
	const queryEnd = hashStart === -1 ? url.length : hashStart
	const query = url.slice(queryStart + 1, queryEnd)
	const redacted = query
		.split('&')
		.map((pair) => {
			const [key = ''] = pair.split('=', 1)
			return SENSITIVE_QUERY_KEYS.has(decodeKey(key).toLowerCase())
				? `${key}=[REDACTED]`
				: pair
		})
		.join('&')

	const prefix = url.slice(0, queryStart + 1)
	const fragment = hashStart === -1 ? '' : url.slice(hashStart)
	return `${prefix}${redacted}${fragment}`
}

// Query keys are form-encoded, so a `+` in a key stands for a space.
function decodeKey(key: string): string {
	try {
		return decodeURIComponent(key.replace(/\+/g, ' '))
	} catch {
		// A malformed escape is kept as written, so the raw key is what gets checked.
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
