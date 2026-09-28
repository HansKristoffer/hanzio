export type UrlQueryValue = string | number | boolean | null | undefined
export type UrlQueryParams = Record<
	string,
	UrlQueryValue | readonly UrlQueryValue[]
>

/**
 * Serializes query params. Arrays repeat the key (`a=1&a=2`); `null` and
 * `undefined` are skipped. Returns the string without a leading `?`.
 */
export function buildQueryString(
	params: UrlQueryParams,
	options: { encode?: boolean } = {}
): string {
	const pairs: [string, string][] = []
	for (const [key, value] of Object.entries(params)) {
		const values = Array.isArray(value) ? value : [value]
		for (const item of values) {
			if (item != null) pairs.push([key, String(item)])
		}
	}

	if (options.encode === false) {
		return pairs.map(([key, value]) => `${key}=${value}`).join('&')
	}
	return new URLSearchParams(pairs).toString()
}

/**
 * Replaces `:name` placeholders with encoded values. Throws when a placeholder
 * has no value. Only `:` followed by a letter or `_` counts, so ports like
 * `:8080` are left alone.
 */
export function replacePathParams(
	path: string,
	params: Record<string, string | number | boolean | undefined> = {}
): string {
	return path.replace(/:([A-Za-z_]\w*)/g, (_, key: string) => {
		const value = params[key]
		if (value === undefined) {
			throw new Error(`Missing required path parameter: ${key}`)
		}
		return encodeURIComponent(String(value))
	})
}

/** Joins base and path with exactly one `/`, fills `:params`, appends query. */
export function buildUrl(
	base: string,
	path = '',
	options: {
		params?: Record<string, string | number | boolean | undefined>
		query?: UrlQueryParams
	} = {}
): string {
	const joined = path
		? `${trimTrailingSlash(base)}/${path.replace(/^\/+/, '')}`
		: base
	const url = replacePathParams(joined, options.params)
	const query = options.query ? buildQueryString(options.query) : ''
	if (!query) return url
	return `${url}${url.includes('?') ? '&' : '?'}${query}`
}

/**
 * Normalizes a domain or URL to its origin: adds `https://` when no scheme is
 * given and strips any path, query or trailing slash.
 */
export function normalizeDomain(input: string): string {
	const trimmed = input.trim()
	const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
		? trimmed
		: `https://${trimmed}`
	return new URL(withScheme).origin
}

/** Accepts a bare domain (`example.com`) or a full URL. */
export function getDomainFaviconUrl(domainOrUrl: string, size = 128): string {
	let domain = domainOrUrl
	try {
		if (/^[a-z][a-z\d+.-]*:\/\//i.test(domainOrUrl)) {
			domain = new URL(domainOrUrl).hostname
		}
	} catch {
		// Not a URL; use the input as-is.
	}
	return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
		domain
	)}&sz=${size}`
}

/** Removes trailing slashes: `'https://x.com/a/'` → `'https://x.com/a'`. */
export function trimTrailingSlash(url: string): string {
	return url.replace(/\/+$/, '')
}

/** Prefixes `/` unless the path already starts with one. */
export function ensureLeadingSlash(path: string): string {
	return path.startsWith('/') ? path : `/${path}`
}

type MailtoRecipients = string | readonly string[]

/**
 * Builds a `mailto:` link. Spaces become `%20` (not `+`, which mail clients
 * show literally) and body line breaks become `%0D%0A`.
 */
export function buildMailto(options: {
	to?: MailtoRecipients
	cc?: MailtoRecipients
	bcc?: MailtoRecipients
	subject?: string
	body?: string
}): string {
	const { to, cc, bcc, subject, body } = options
	const headers = Object.entries({
		cc: cc && recipients(cc),
		bcc: bcc && recipients(bcc),
		subject: subject && encodeURIComponent(subject),
		body: body && encodeURIComponent(body.replace(/\r?\n/g, '\r\n'))
	})
		.filter(([, value]) => value)
		.map(([key, value]) => `${key}=${value}`)
		.join('&')
	return `mailto:${to ? recipients(to) : ''}${headers ? `?${headers}` : ''}`
}

function recipients(value: MailtoRecipients): string {
	return (typeof value === 'string' ? [value] : value)
		.map((address) => encodeURIComponent(address.trim()).replace(/%40/g, '@'))
		.join(',')
}

/**
 * Milliseconds to wait from a `Retry-After` header: delta-seconds (fractions
 * allowed) or an HTTP date relative to `now`. Past dates and negative values
 * give `0`; a missing or invalid value gives `undefined`.
 */
export function parseRetryAfter(
	value: string | null | undefined,
	now = Date.now()
): number | undefined {
	const trimmed = value?.trim()
	if (!trimmed) return undefined
	if (/^-?\d*\.?\d+$/.test(trimmed)) {
		return Math.max(0, Number(trimmed) * 1000)
	}
	const date = Date.parse(trimmed)
	return Number.isNaN(date) ? undefined : Math.max(0, date - now)
}
