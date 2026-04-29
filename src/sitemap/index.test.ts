import { afterEach, describe, expect, mock, test } from 'bun:test'
import { getDomainSitemap } from '.'

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
})
