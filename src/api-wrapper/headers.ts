const CANONICAL_HEADER_NAMES: Record<string, string> = {
	'content-type': 'Content-Type',
	authorization: 'Authorization',
	accept: 'Accept',
	'user-agent': 'User-Agent',
	'x-request-id': 'X-Request-Id',
	'x-correlation-id': 'X-Correlation-Id'
}

/**
 * Normalize headers to canonical case so lookups are deterministic. Later
 * occurrences of the same header (case-insensitive) win.
 */
export function normalizeHeaders(
	headers: Record<string, string>
): Record<string, string> {
	const result: Record<string, string> = {}
	const lowerToCanonical = new Map<string, string>()
	for (const [key, value] of Object.entries(headers)) {
		const lower = key.toLowerCase()
		const canonical = CANONICAL_HEADER_NAMES[lower] ?? key
		const existing = lowerToCanonical.get(lower)
		if (existing && existing !== canonical) delete result[existing]
		lowerToCanonical.set(lower, canonical)
		result[canonical] = value
	}
	return result
}

export function getHeader(
	headers: Record<string, string>,
	name: string
): string | undefined {
	const lower = name.toLowerCase()
	const canonical = CANONICAL_HEADER_NAMES[lower]
	if (canonical !== undefined) {
		if (headers[canonical] !== undefined) return headers[canonical]
	}
	for (const [k, v] of Object.entries(headers)) {
		if (k.toLowerCase() === lower) return v
	}
	return undefined
}

export function hasJsonContentType(headers: Record<string, string>): boolean {
	const ct = getHeader(headers, 'content-type') ?? ''
	return ct.includes('application/json')
}

export function buildFetchBody(
	body: unknown,
	headers: Record<string, string>
): RequestInit['body'] {
	if (body === undefined || body === null) return undefined
	if (body instanceof FormData || body instanceof Blob) return body
	if (hasJsonContentType(headers)) return JSON.stringify(body)
	return body as RequestInit['body']
}

export function getHeadersAsObject(headers: Headers): Record<string, string> {
	const result: Record<string, string> = {}
	headers.forEach((value, key) => {
		result[key] = value
	})
	return result
}
