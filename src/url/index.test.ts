import { describe, expect, test } from 'bun:test'
import { getDomainFaviconUrl } from '.'

describe('getDomainFaviconUrl', () => {
	test('builds Google favicon URL with encoded domain', () => {
		expect(getDomainFaviconUrl('example.com')).toBe(
			'https://www.google.com/s2/favicons?domain=example.com&sz=128'
		)
		expect(getDomainFaviconUrl('a b', 64)).toContain('sz=64')
		expect(getDomainFaviconUrl('a b')).toContain('domain=a%20b')
	})
})
