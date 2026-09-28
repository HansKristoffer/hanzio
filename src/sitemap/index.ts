import PQueue from '../p-queue'
import { escapeRegExp } from '../string'
import { normalizeDomain } from '../url'

/** Substring, RegExp, or predicate. */
export type SitemapUrlFilter = string | RegExp | ((url: string) => boolean)

export interface SitemapOptions {
	/** Only follow nested sitemaps (from a `<sitemapindex>`) that match. */
	filterIndexes?: SitemapUrlFilter
	/** Only keep page URLs (from a `<urlset>`) that match. */
	filterUrls?: SitemapUrlFilter
	concurrency?: number
	maxDepth?: number
	/** Stop once this many URLs have been collected. */
	maxUrls?: number
	/** Per-request timeout in ms. */
	timeout?: number
	userAgent?: string
	fetch?: typeof fetch
	/** Called for failed robots.txt/sitemap requests. Defaults to `console.warn`. */
	onError?: (url: string, error: unknown) => void
	/** Drop page URLs that robots.txt disallows for `userAgent`. Defaults to `false`. */
	respectRobots?: boolean
}

/** The robots.txt rules that apply to one user agent. */
export interface RobotsRules {
	allow: string[]
	disallow: string[]
	/** Every `Sitemap:` line, whatever group it is in. */
	sitemaps: string[]
	crawlDelaySec?: number
}

export interface SitemapEntry {
	loc: string
	lastmod?: string
}

type Request = (url: string, method?: string) => Promise<Response>

const COMMON_LOCATIONS = [
	'/sitemap.xml',
	'/sitemap_index.xml',
	'/sitemap/',
	'/sitemaps.xml',
	'/sitemap/sitemap.xml'
]

const XML_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'"
}

const decodeXml = (value: string) =>
	value.replace(
		/&(#[xX][\da-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,
		(_, entity: string) =>
			entity[0] !== '#'
				? XML_ENTITIES[entity]!
				: String.fromCodePoint(
						entity[1] === 'x' || entity[1] === 'X'
							? Number.parseInt(entity.slice(2), 16)
							: Number(entity.slice(1))
					)
	)

const matchesFilter = (filter: SitemapUrlFilter | undefined, url: string) => {
	if (filter === undefined) return true
	if (typeof filter === 'string') return url.includes(filter)
	if (typeof filter === 'function') return filter(url)
	return url.search(filter) !== -1
}

const defaultOnError = (url: string, error: unknown) =>
	console.warn(
		`Failed to fetch ${url}:`,
		error instanceof Error ? error.message : 'Unknown error'
	)

/** Reads a response as text, gunzipping it if the body is still gzip (e.g. `.xml.gz`). */
const readBody = async (response: Response): Promise<string> => {
	const bytes = new Uint8Array(await response.arrayBuffer())
	if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
		return new TextDecoder().decode(bytes)
	}
	return new Response(
		new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
	).text()
}

/** Parses `<url>`/`<sitemap>` entries and whether the document is a sitemap index. */
const parseSitemap = (xml: string) => ({
	isIndex: /<sitemapindex[\s>]/i.test(xml),
	entries: [...xml.matchAll(/<(url|sitemap)[\s>][\s\S]*?<\/\1>/gi)].flatMap(
		([block]): SitemapEntry[] => {
			const loc = block.match(
				/<loc>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*?))\s*<\/loc>/i
			)
			if (!loc) return []
			const lastmod = block.match(/<lastmod>\s*([^<]*?)\s*<\/lastmod>/i)?.[1]
			return [
				{
					loc: (loc[1] ?? decodeXml(loc[2]!)).trim(),
					...(lastmod ? { lastmod } : {})
				}
			]
		}
	)
})

type RobotsGroup = Omit<RobotsRules, 'sitemaps'> & { agents: string[] }

// RFC 9309 product token: `Googlebot/2.1` and `googlebot` both match `googlebot`.
const productToken = (userAgent: string) =>
	userAgent.trim() === '*'
		? '*'
		: (/^[a-z_-]+/i.exec(userAgent.trim())?.[0].toLowerCase() ?? '')

/**
 * Parses robots.txt for one user agent (RFC 9309): the groups naming its
 * product token (case-insensitive, versions ignored), else the `*` groups.
 * Several matching groups are merged. Empty `Allow`/`Disallow` values are dropped.
 */
export function parseRobotsTxt(body: string, userAgent = '*'): RobotsRules {
	const groups: RobotsGroup[] = []
	const sitemaps = new Set<string>()
	let group: RobotsGroup | undefined
	let inRules = false

	for (const line of body.split(/\r\n|\r|\n/)) {
		const match = /^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i.exec(line.replace(/#.*/, ''))
		if (!match) continue
		const field = match[1]!.toLowerCase()
		const value = match[2]!

		if (field === 'sitemap') {
			if (value) sitemaps.add(value)
		} else if (field === 'user-agent') {
			// A user-agent line after rules starts a new group.
			if (!group || inRules) {
				group = { agents: [], allow: [], disallow: [] }
				groups.push(group)
				inRules = false
			}
			group.agents.push(productToken(value))
		} else if (group && (field === 'allow' || field === 'disallow')) {
			inRules = true
			if (value) group[field].push(value)
		} else if (group && field === 'crawl-delay') {
			inRules = true
			const seconds = Number(value)
			if (value && seconds >= 0) group.crawlDelaySec ??= seconds
		}
	}

	const token = productToken(userAgent)
	const named = groups.filter((g) => g.agents.includes(token))
	const selected =
		named.length > 0 ? named : groups.filter((g) => g.agents.includes('*'))
	const crawlDelaySec = selected.find(
		(g) => g.crawlDelaySec !== undefined
	)?.crawlDelaySec
	return {
		allow: selected.flatMap((g) => g.allow),
		disallow: selected.flatMap((g) => g.disallow),
		sitemaps: [...sitemaps],
		...(crawlDelaySec === undefined ? {} : { crawlDelaySec })
	}
}

// ponytail: unbounded growth capped by clearing; fine for a handful of sites per process.
const patternCache = new Map<string, RegExp>()

const matchesRobotsPattern = (pattern: string, path: string) => {
	let regex = patternCache.get(pattern)
	if (!regex) {
		const anchored = pattern.endsWith('$')
		const source = (anchored ? pattern.slice(0, -1) : pattern)
			.split('*')
			.map(escapeRegExp)
			.join('.*')
		regex = new RegExp(`^${source}${anchored ? '$' : ''}`)
		if (patternCache.size >= 1000) patternCache.clear()
		patternCache.set(pattern, regex)
	}
	return regex.test(path)
}

/**
 * Whether `url` (absolute, or a path) may be crawled under `rules` (RFC 9309):
 * the longest matching pattern wins and `Allow` wins a tie. Patterns support
 * `*` and a trailing `$`, and match the path plus query string.
 */
export function isAllowedByRobots(
	rules: Pick<RobotsRules, 'allow' | 'disallow'>,
	url: string
): boolean {
	let path: string
	try {
		const parsed = new URL(url, 'http://localhost')
		path = parsed.pathname + parsed.search
	} catch {
		return true
	}
	if (path === '/robots.txt') return true

	// Allows go first, so a disallow of the same length can't replace one.
	let best: { allow: boolean; length: number } | undefined
	for (const [allow, patterns] of [
		[true, rules.allow],
		[false, rules.disallow]
	] as const) {
		for (const pattern of patterns) {
			if (
				pattern.length > (best?.length ?? -1) &&
				matchesRobotsPattern(pattern, path)
			) {
				best = { allow, length: pattern.length }
			}
		}
	}
	return best?.allow ?? true
}

const fetchRobots = async (
	origin: string,
	request: Request,
	userAgent: string,
	onError: (url: string, error: unknown) => void
): Promise<RobotsRules | undefined> => {
	const robotsUrl = `${origin}/robots.txt`
	try {
		const response = await request(robotsUrl)
		if (response.ok) return parseRobotsTxt(await response.text(), userAgent)
	} catch (error) {
		onError(robotsUrl, error)
	}
	return undefined
}

/** The first common sitemap location that answers a HEAD request. */
const probeSitemapLocations = async (
	origin: string,
	request: Request
): Promise<string[]> => {
	for (const location of COMMON_LOCATIONS) {
		try {
			const response = await request(`${origin}${location}`, 'HEAD')
			if (response.ok) return [`${origin}${location}`]
		} catch {
			// Probes are expected to fail
		}
	}

	return []
}

/**
 * Gets all entries (`loc` + optional `lastmod`) from a domain by discovering and crawling its sitemaps
 * @param domain - The root domain (e.g., 'example.com' or 'https://example.com')
 * @throws When no sitemap can be discovered
 */
export const getDomainSitemapEntries = async (
	domain: string,
	options: SitemapOptions = {}
): Promise<SitemapEntry[]> => {
	const {
		filterIndexes,
		filterUrls,
		concurrency = 10,
		maxDepth = 5,
		maxUrls = Number.POSITIVE_INFINITY,
		timeout = 10000,
		userAgent = 'SitemapCrawler/1.0',
		fetch: fetchFn = globalThis.fetch,
		onError = defaultOnError,
		respectRobots = false
	} = options

	const request: Request = (url, method = 'GET') =>
		fetchFn(url, {
			method,
			headers: { 'User-Agent': userAgent },
			signal: AbortSignal.timeout(timeout)
		})

	const origin = normalizeDomain(domain)
	const robots = await fetchRobots(origin, request, userAgent, onError)
	const sitemapUrls = robots?.sitemaps.length
		? robots.sitemaps
		: await probeSitemapLocations(origin, request)
	const keepUrl = (url: string) =>
		matchesFilter(filterUrls, url) &&
		(!respectRobots || !robots || isAllowedByRobots(robots, url))
	if (sitemapUrls.length === 0) {
		throw new Error('No sitemaps found for the domain')
	}

	const queue = new PQueue({ concurrency })
	const entries = new Map<string, SitemapEntry>()
	const visited = new Set<string>()

	const processSitemap = async (sitemapUrl: string, depth = 0) => {
		if (
			depth > maxDepth ||
			visited.has(sitemapUrl) ||
			entries.size >= maxUrls
		) {
			return
		}
		visited.add(sitemapUrl)

		try {
			const response = await request(sitemapUrl)
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`)
			}

			const { isIndex, entries: found } = parseSitemap(await readBody(response))
			for (const entry of found) {
				if (isIndex) {
					if (matchesFilter(filterIndexes, entry.loc)) {
						queue.add(() => processSitemap(entry.loc, depth + 1))
					}
				} else if (entries.size >= maxUrls) {
					return
				} else if (keepUrl(entry.loc)) {
					entries.set(entry.loc, entries.get(entry.loc) ?? entry)
				}
			}
		} catch (error) {
			onError(sitemapUrl, error)
		}
	}

	await Promise.all(
		sitemapUrls.map((sitemapUrl) => queue.add(() => processSitemap(sitemapUrl)))
	)
	await queue.onIdle()

	return [...entries.values()]
}

/**
 * Gets all URLs from a domain by discovering and crawling its sitemaps
 * @param domain - The root domain (e.g., 'example.com' or 'https://example.com')
 * @returns Array of unique URLs found in the sitemap
 */
export const getDomainSitemap = async (
	domain: string,
	options: SitemapOptions = {}
): Promise<string[]> =>
	(await getDomainSitemapEntries(domain, options)).map((entry) => entry.loc)
