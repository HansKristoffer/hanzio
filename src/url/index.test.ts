import { describe, expect, test } from 'bun:test'
import {
	buildMailto,
	buildQueryString,
	buildUrl,
	ensureLeadingSlash,
	getDomainFaviconUrl,
	normalizeDomain,
	parseRetryAfter,
	replacePathParams,
	trimTrailingSlash
} from '.'

describe('getDomainFaviconUrl', () => {
	test('builds Google favicon URL with encoded domain', () => {
		expect(getDomainFaviconUrl('example.com')).toBe(
			'https://www.google.com/s2/favicons?domain=example.com&sz=128'
		)
		expect(getDomainFaviconUrl('a b', 64)).toContain('sz=64')
		expect(getDomainFaviconUrl('a b')).toContain('domain=a%20b')
	})
})

describe('url builders', () => {
	test('getDomainFaviconUrl accepts a full URL', () => {
		expect(getDomainFaviconUrl('https://example.com/a?b=1')).toContain(
			'domain=example.com&'
		)
	})

	test('buildQueryString repeats array keys and skips nullish values', () => {
		expect(
			buildQueryString({ a: [1, 2], b: undefined, c: null, d: 'x y' })
		).toBe('a=1&a=2&d=x+y')
		expect(buildQueryString({ q: 'a b' }, { encode: false })).toBe('q=a b')
	})

	test('replacePathParams encodes values and ignores ports', () => {
		expect(replacePathParams('http://h:8080/users/:id', { id: 'a/b' })).toBe(
			'http://h:8080/users/a%2Fb'
		)
		expect(() => replacePathParams('/users/:id')).toThrow('id')
	})

	test('buildUrl joins, fills params and appends query', () => {
		expect(
			buildUrl('https://api.test/', '/users/:id', {
				params: { id: 7 },
				query: { expand: ['a', 'b'] }
			})
		).toBe('https://api.test/users/7?expand=a&expand=b')
	})

	test('normalizeDomain returns the origin', () => {
		expect(normalizeDomain('example.com/')).toBe('https://example.com')
		expect(normalizeDomain('http://example.com/path?x=1')).toBe(
			'http://example.com'
		)
	})
})

describe('slashes', () => {
	test('trimTrailingSlash removes every trailing slash', () => {
		expect(trimTrailingSlash('https://x.com/a//')).toBe('https://x.com/a')
		expect(trimTrailingSlash('https://x.com')).toBe('https://x.com')
		expect(trimTrailingSlash('/')).toBe('')
	})

	test('ensureLeadingSlash adds one slash only when missing', () => {
		expect(ensureLeadingSlash('a/b')).toBe('/a/b')
		expect(ensureLeadingSlash('/a/b')).toBe('/a/b')
		expect(ensureLeadingSlash('')).toBe('/')
	})
})

describe('buildMailto', () => {
	test('encodes spaces as %20 and joins recipients', () => {
		expect(
			buildMailto({
				to: ['ada@x.com', 'jane+news@y.com'],
				cc: 'bob@z.com',
				subject: 'Hello there & welcome',
				body: 'Line 1\nLine 2'
			})
		).toBe(
			'mailto:ada@x.com,jane%2Bnews@y.com?cc=bob@z.com&subject=Hello%20there%20%26%20welcome&body=Line%201%0D%0ALine%202'
		)
	})

	test('skips empty fields', () => {
		expect(buildMailto({ to: 'ada@x.com' })).toBe('mailto:ada@x.com')
		expect(buildMailto({ to: [], subject: 'Hi', body: '' })).toBe(
			'mailto:?subject=Hi'
		)
		expect(buildMailto({ bcc: ['a@x.com', 'b@x.com'] })).toBe(
			'mailto:?bcc=a@x.com,b@x.com'
		)
	})
})

describe('parseRetryAfter', () => {
	const now = Date.parse('2026-01-01T00:00:00Z')

	test('reads delta-seconds, including fractions', () => {
		expect(parseRetryAfter('120')).toBe(120_000)
		expect(parseRetryAfter(' 1.5 ')).toBe(1500)
		expect(parseRetryAfter('.5')).toBe(500)
		expect(parseRetryAfter('0')).toBe(0)
		expect(parseRetryAfter('-5')).toBe(0)
	})

	test('reads an HTTP date relative to now', () => {
		expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:30 GMT', now)).toBe(30_000)
		expect(parseRetryAfter('Wed, 31 Dec 2025 23:59:00 GMT', now)).toBe(0)
	})

	test('missing or invalid values give undefined', () => {
		expect(parseRetryAfter(undefined)).toBeUndefined()
		expect(parseRetryAfter(null)).toBeUndefined()
		expect(parseRetryAfter('')).toBeUndefined()
		expect(parseRetryAfter('soon')).toBeUndefined()
		expect(parseRetryAfter('0x10')).toBeUndefined()
	})
})
