import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
	getDomainSitemap,
	getDomainSitemapEntries,
	isAllowedByRobots,
	parseRobotsTxt
} from '.'

const originalFetch = globalThis.fetch
const originalWarn = console.warn

const xmlResponse = (body: string) =>
	new Response(body, {
		status: 200,
		headers: { 'content-type': 'application/xml' }
	})

describe('getDomainSitemap', () => {
	afterEach(() => {
		globalThis.fetch = originalFetch
		console.warn = originalWarn
	})

	test('discovers sitemap from robots.txt and extracts URLs', async () => {
		globalThis.fetch = mock((url: string) => {
			if (url.endsWith('/robots.txt')) {
				return Promise.resolve(
					new Response('Sitemap: https://example.com/sitemap.xml')
				)
			}

			return Promise.resolve(
				xmlResponse(`
					<urlset>
						<url><loc>https://example.com/about</loc></url>
						<url><loc>https://example.com/contact</loc></url>
					</urlset>
				`)
			)
		}) as unknown as typeof fetch

		await expect(getDomainSitemap('example.com')).resolves.toEqual([
			'https://example.com/about',
			'https://example.com/contact'
		])
	})

	test('falls back to common sitemap locations', async () => {
		globalThis.fetch = mock((url: string, init?: RequestInit) => {
			if (url.endsWith('/robots.txt')) {
				return Promise.resolve(new Response('', { status: 404 }))
			}

			if (init?.method === 'HEAD') {
				return Promise.resolve(new Response('', { status: 200 }))
			}

			return Promise.resolve(
				xmlResponse(`
					<urlset>
						<url><loc>https://example.com/fallback</loc></url>
					</urlset>
				`)
			)
		}) as unknown as typeof fetch

		await expect(getDomainSitemap('https://example.com/')).resolves.toEqual([
			'https://example.com/fallback'
		])
	})

	test('processes nested sitemap indexes with filtering', async () => {
		globalThis.fetch = mock((url: string) => {
			if (url.endsWith('/robots.txt')) {
				return Promise.resolve(
					new Response('Sitemap: https://example.com/sitemap.xml')
				)
			}

			if (url.endsWith('/sitemap.xml')) {
				return Promise.resolve(
					xmlResponse(`
						<sitemapindex>
							<sitemap><loc>https://example.com/posts-sitemap.xml</loc></sitemap>
							<sitemap><loc>https://example.com/pages-sitemap.xml</loc></sitemap>
						</sitemapindex>
					`)
				)
			}

			if (url.endsWith('/posts-sitemap.xml')) {
				return Promise.resolve(
					xmlResponse(`
						<urlset>
							<url><loc>https://example.com/posts/one</loc></url>
						</urlset>
					`)
				)
			}

			return Promise.resolve(
				xmlResponse(`
					<urlset>
						<url><loc>https://example.com/pages/about</loc></url>
					</urlset>
				`)
			)
		}) as unknown as typeof fetch

		await expect(
			getDomainSitemap('example.com', { filterIndexes: 'posts' })
		).resolves.toEqual(['https://example.com/posts/one'])
	})

	test('throws when no sitemap can be discovered', async () => {
		console.warn = mock(() => undefined) as unknown as typeof console.warn
		globalThis.fetch = mock(() =>
			Promise.resolve(new Response('', { status: 404 }))
		) as unknown as typeof fetch

		await expect(getDomainSitemap('example.com')).rejects.toThrow(
			'No sitemaps found'
		)
	})

	const routes =
		(pages: Record<string, string | Uint8Array>) =>
		(url: string): Promise<Response> =>
			Promise.resolve(
				url in pages
					? new Response(pages[url])
					: new Response('', { status: 404 })
			)

	test('reads robots.txt sitemap lines without a space after the colon', async () => {
		const fetch = routes({
			'https://example.com/robots.txt':
				'User-agent: *\n  sitemap:https://example.com/a.xml\nSITEMAP:  https://example.com/b.xml',
			'https://example.com/a.xml':
				'<urlset><url><loc>https://example.com/a</loc></url></urlset>',
			'https://example.com/b.xml':
				'<urlset><url><loc>https://example.com/b</loc></url></urlset>'
		}) as typeof globalThis.fetch

		expect((await getDomainSitemap('example.com', { fetch })).sort()).toEqual([
			'https://example.com/a',
			'https://example.com/b'
		])
	})

	test('decodes XML entities and CDATA in <loc>', async () => {
		const fetch = routes({
			'https://example.com/robots.txt': 'Sitemap: https://example.com/s.xml',
			'https://example.com/s.xml': `<urlset>
				<url><loc>https://example.com/?a=1&amp;b=&lt;2&gt;&#39;&#x41;</loc></url>
				<url><loc><![CDATA[https://example.com/?c=1&d=2]]></loc></url>
			</urlset>`
		}) as typeof globalThis.fetch

		await expect(getDomainSitemap('example.com', { fetch })).resolves.toEqual([
			"https://example.com/?a=1&b=<2>'A",
			'https://example.com/?c=1&d=2'
		])
	})

	test('uses the root element to tell sitemap indexes from pages', async () => {
		const fetch = routes({
			'https://example.com/robots.txt': 'Sitemap: https://example.com/index',
			'https://example.com/index':
				'<?xml version="1.0"?><sitemapindex xmlns="x"><sitemap><loc>https://example.com/children</loc></sitemap></sitemapindex>',
			'https://example.com/children':
				'<urlset xmlns="x"><url><loc>https://example.com/sitemap-guide</loc></url></urlset>'
		}) as typeof globalThis.fetch

		await expect(getDomainSitemap('example.com', { fetch })).resolves.toEqual([
			'https://example.com/sitemap-guide'
		])
	})

	test('supports RegExp and function filters', async () => {
		const fetch = routes({
			'https://example.com/robots.txt':
				'Sitemap: https://example.com/index.xml',
			'https://example.com/index.xml': `<sitemapindex>
				<sitemap><loc>https://example.com/posts.xml</loc></sitemap>
				<sitemap><loc>https://example.com/tags.xml</loc></sitemap>
			</sitemapindex>`,
			'https://example.com/posts.xml': `<urlset>
				<url><loc>https://example.com/posts/1</loc></url>
				<url><loc>https://example.com/posts/2</loc></url>
			</urlset>`,
			'https://example.com/tags.xml':
				'<urlset><url><loc>https://example.com/tags/1</loc></url></urlset>'
		}) as typeof globalThis.fetch

		await expect(
			getDomainSitemap('example.com', {
				fetch,
				filterIndexes: /posts/,
				filterUrls: (url) => url.endsWith('2')
			})
		).resolves.toEqual(['https://example.com/posts/2'])
	})

	test('stops at maxUrls', async () => {
		const fetch = routes({
			'https://example.com/robots.txt': 'Sitemap: https://example.com/s.xml',
			'https://example.com/s.xml': `<urlset>${[1, 2, 3, 4]
				.map((n) => `<url><loc>https://example.com/${n}</loc></url>`)
				.join('')}</urlset>`
		}) as typeof globalThis.fetch

		await expect(
			getDomainSitemap('example.com', { fetch, maxUrls: 2 })
		).resolves.toEqual(['https://example.com/1', 'https://example.com/2'])
	})

	test('decompresses gzipped sitemaps', async () => {
		const fetch = routes({
			'https://example.com/robots.txt':
				'Sitemap: https://example.com/sitemap.xml.gz',
			'https://example.com/sitemap.xml.gz': Bun.gzipSync(
				'<urlset><url><loc>https://example.com/zipped</loc></url></urlset>'
			)
		}) as typeof globalThis.fetch

		await expect(getDomainSitemap('example.com', { fetch })).resolves.toEqual([
			'https://example.com/zipped'
		])
	})

	test('returns lastmod entries', async () => {
		const fetch = routes({
			'https://example.com/robots.txt': 'Sitemap: https://example.com/s.xml',
			'https://example.com/s.xml': `<urlset>
				<url><loc>https://example.com/a</loc><lastmod>2024-01-05</lastmod></url>
				<url><loc>https://example.com/b</loc></url>
			</urlset>`
		}) as typeof globalThis.fetch

		await expect(
			getDomainSitemapEntries('example.com', { fetch })
		).resolves.toEqual([
			{ loc: 'https://example.com/a', lastmod: '2024-01-05' },
			{ loc: 'https://example.com/b' }
		])
	})

	test('respectRobots drops disallowed pages for the configured user agent', async () => {
		const requested: string[] = []
		const pages = routes({
			'https://example.com/robots.txt': `
				User-agent: *
				Disallow: /

				User-agent: MyBot
				Disallow: /cart/
				Allow: /cart/help

				Sitemap: https://example.com/s.xml`,
			'https://example.com/s.xml': `<urlset>${[
				'/a',
				'/cart/add?id=1',
				'/cart/help'
			]
				.map((path) => `<url><loc>https://example.com${path}</loc></url>`)
				.join('')}</urlset>`
		})
		const fetch = ((url: string) => {
			requested.push(url)
			return pages(url)
		}) as typeof globalThis.fetch

		await expect(
			getDomainSitemap('example.com', {
				fetch,
				respectRobots: true,
				userAgent: 'MyBot/2.0'
			})
		).resolves.toEqual([
			'https://example.com/a',
			'https://example.com/cart/help'
		])
		expect(requested.filter((url) => url.endsWith('/robots.txt'))).toHaveLength(
			1
		)
		// Off by default.
		await expect(
			getDomainSitemap('example.com', { fetch, userAgent: 'MyBot/2.0' })
		).resolves.toHaveLength(3)
	})

	test('reports failures through onError', async () => {
		const fetch = routes({
			'https://example.com/robots.txt':
				'Sitemap: https://example.com/missing.xml'
		}) as typeof globalThis.fetch
		const onError = mock((_url: string, _error: unknown) => undefined)

		await expect(
			getDomainSitemap('example.com', { fetch, onError })
		).resolves.toEqual([])
		expect(onError).toHaveBeenCalledTimes(1)
		expect(onError.mock.calls[0]).toEqual([
			'https://example.com/missing.xml',
			expect.any(Error)
		])
	})
})

describe('parseRobotsTxt', () => {
	const body = `
		# comment
		user-agent: *
		disallow: /private/ # trailing comment
		CRAWL-DELAY: 5
		Sitemap: https://example.com/s.xml

		User-agent: ExampleBot
		User-agent: OtherBot
		Allow: /
		Disallow:

		User-Agent: examplebot
		Disallow: /no/
		sitemap: https://example.com/s.xml
	`

	test('falls back to the * group', () => {
		expect(parseRobotsTxt(body)).toEqual({
			allow: [],
			disallow: ['/private/'],
			sitemaps: ['https://example.com/s.xml'],
			crawlDelaySec: 5
		})
		expect(parseRobotsTxt(body, 'UnknownBot')).toEqual(parseRobotsTxt(body))
	})

	test('merges the groups naming the product token, case-insensitively', () => {
		expect(parseRobotsTxt(body, 'ExampleBot/1.2')).toEqual({
			allow: ['/'],
			disallow: ['/no/'],
			sitemaps: ['https://example.com/s.xml']
		})
		expect(parseRobotsTxt(body, 'otherbot').disallow).toEqual([])
	})

	test('ignores rules before the first user-agent line', () => {
		expect(parseRobotsTxt('Disallow: /\nUser-agent: *\nDisallow: /x')).toEqual({
			allow: [],
			disallow: ['/x'],
			sitemaps: []
		})
	})
})

describe('isAllowedByRobots', () => {
	const allowed = (rules: string, url: string) =>
		isAllowedByRobots(parseRobotsTxt(`User-agent: *\n${rules}`), url)

	test('allows everything without rules or with an empty Disallow', () => {
		expect(allowed('', '/anything')).toBe(true)
		expect(allowed('Disallow:', '/anything')).toBe(true)
	})

	test('longest match wins, Allow wins ties (RFC 9309 examples)', () => {
		const rules =
			'Allow: /example/page/\nDisallow: /example/page/disallowed.gif'
		expect(allowed(rules, '/example/page/')).toBe(true)
		expect(allowed(rules, '/example/page/disallowed.gif')).toBe(false)
		expect(allowed('Allow: /p\nDisallow: /', '/page')).toBe(true)
		expect(allowed('Allow: /folder\nDisallow: /folder', '/folder/page')).toBe(
			true
		)
		expect(allowed('Allow: /$\nDisallow: /', '/')).toBe(true)
		expect(allowed('Allow: /$\nDisallow: /', '/page.htm')).toBe(false)
	})

	test('supports * wildcards and $ end anchors', () => {
		expect(allowed('Disallow: /*.gif$', 'https://x.com/a/b.gif')).toBe(false)
		expect(allowed('Disallow: /*.gif$', 'https://x.com/a/b.gif?x=1')).toBe(true)
		expect(allowed('Disallow: /fish*', '/fish.html')).toBe(false)
		expect(allowed('Disallow: /fish*', '/Fish.asp')).toBe(true)
		expect(allowed('Disallow: /*?', '/page?q=1')).toBe(false)
		expect(allowed('Disallow: /*?', '/page')).toBe(true)
		expect(allowed('Disallow: /a.b(c)', '/a.b(c)')).toBe(false)
		expect(allowed('Disallow: /a.b', '/axb')).toBe(true)
	})

	test('matches the query string and always allows /robots.txt', () => {
		expect(allowed('Disallow: /cart/add?', '/cart/add?id=1')).toBe(false)
		expect(allowed('Disallow: /', 'https://x.com/robots.txt')).toBe(true)
	})
})
