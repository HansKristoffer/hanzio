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
	'apikey',
	'api_key'
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

export function defaultRedactContext(ctx: ApiErrorContext): ApiErrorContext {
	return {
		...ctx,
		requestHeaders: redactHeaders(ctx.requestHeaders),
		requestBody: redactBody(ctx.requestBody),
		meta: ctx.meta
	}
}
