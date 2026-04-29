import PQueue from '../p-queue'

interface SitemapOptions {
	filterIndexes?: string
	concurrency?: number
	maxDepth?: number
	timeout?: number
}

interface ProcessedResult {
	links: Set<string>
	visited: Set<string>
}

/**
 * Creates an AbortController with a timeout
 */
const createTimeoutController = (timeout: number): AbortController => {
	const controller = new AbortController()
	setTimeout(() => controller.abort(), timeout)
	return controller
}

/**
 * Discovers sitemap URL(s) from a domain by checking common locations and robots.txt
 */
const discoverSitemaps = async (domain: string): Promise<string[]> => {
	const normalizedDomain = domain.replace(/\/$/, '')
	const commonLocations = [
		'/sitemap.xml',
		'/sitemap_index.xml',
		'/sitemap/',
		'/sitemaps.xml',
		'/sitemap/sitemap.xml'
	]

	const sitemaps: Set<string> = new Set()
	const requestOptions: RequestInit = {
		headers: {
			'User-Agent': 'SitemapCrawler/1.0'
		},
		// biome-ignore lint/suspicious/noExplicitAny: AbortSignal types differ between Bun and React Native
		signal: createTimeoutController(5000).signal as any
	}

	// Check robots.txt first
	try {
		const robotsTxt = await fetch(`${normalizedDomain}/robots.txt`, {
			...requestOptions
		})

		if (robotsTxt.ok) {
			const text = await robotsTxt.text()
			const sitemapMatches = text.match(/Sitemap: (.*)/gi)
			if (sitemapMatches) {
				sitemapMatches.forEach((match: string) => {
					const url = match.replace('Sitemap:', '').trim()
					sitemaps.add(url)
				})
			}

			// If we found sitemaps in robots.txt, return them immediately
			if (sitemaps.size > 0) {
				return [...sitemaps]
			}
		}
	} catch (error) {
		console.warn(
			'Could not fetch robots.txt:',
			error instanceof Error ? error.message : 'Unknown error'
		)
	}

	// Check common locations one by one
	for (const location of commonLocations) {
		try {
			const response = await fetch(`${normalizedDomain}${location}`, {
				...requestOptions,
				method: 'HEAD'
			})

			if (response.ok) {
				return [`${normalizedDomain}${location}`]
			}
		} catch (_error) {
			// Ignore 404s and other errors
		}
	}

	return []
}

/**
 * Gets all URLs from a domain by discovering and crawling its sitemaps
 * @param domain - The root domain (e.g., 'https://example.com')
 * @param options - Configuration options for the crawler
 * @returns Promise<string[]> - Array of unique URLs found in the sitemap
 */
export const getDomainSitemap = async (
	domain: string,
	options: SitemapOptions = {}
): Promise<string[]> => {
	const {
		filterIndexes,
		concurrency = 10,
		maxDepth = 5,
		timeout = 10000
	} = options

	// Normalize domain
	let normalizedDomain = domain.replace(/\/$/, '')
	if (!normalizedDomain.startsWith('http')) {
		normalizedDomain = `https://${normalizedDomain}`
	}

	// Discover sitemaps
	const sitemapUrls = await discoverSitemaps(normalizedDomain)
	if (sitemapUrls.length === 0) {
		throw new Error('No sitemaps found for the domain')
	}

	const queue = new PQueue({ concurrency })
	const result: ProcessedResult = {
		links: new Set<string>(),
		visited: new Set<string>()
	}

	const locRegex = /<loc>([^<]+)<\/loc>/g
	const isXmlSitemap = (url: string) =>
		url.endsWith('.xml') || url.toLowerCase().includes('sitemap')

	/**
	 * Process a single sitemap URL and extract all links
	 */
	const processSitemap = async (
		sitemapUrl: string,
		depth = 0
	): Promise<void> => {
		if (depth > maxDepth || result.visited.has(sitemapUrl)) {
			return
		}

		// console.log('Processing sitemap:', sitemapUrl)

		result.visited.add(sitemapUrl)

		try {
			const controller = createTimeoutController(timeout)
			const response = await fetch(sitemapUrl, {
				headers: {
					'User-Agent': 'SitemapCrawler/1.0'
				},
				// biome-ignore lint/suspicious/noExplicitAny: AbortSignal types differ between Bun and React Native
				signal: controller.signal as any
			})

			if (!response.ok)
				throw new Error(`HTTP error! status: ${response.status}`)

			const data = await response.text()
			const matches = [...data.matchAll(locRegex)]
				.map((match) => match[1]!.trim())
				.filter((link) => {
					if (filterIndexes && isXmlSitemap(link)) {
						return link.includes(filterIndexes)
					}
					return true
				})

			for (const link of matches) {
				if (isXmlSitemap(link)) {
					// Queue nested sitemap for processing
					queue.add(() => processSitemap(link, depth + 1))
				} else {
					result.links.add(link)
				}
			}
		} catch (error) {
			console.warn(
				`Failed to process sitemap ${sitemapUrl}:`,
				error instanceof Error ? error.message : 'Unknown error'
			)
		}
	}

	// Process all discovered sitemaps
	await Promise.all(
		sitemapUrls.map((sitemapUrl) => queue.add(() => processSitemap(sitemapUrl)))
	)

	// Wait for all queued tasks to complete
	await queue.onIdle()

	return [...result.links]
}
