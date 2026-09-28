---
description: Discover and crawl XML sitemaps for URL discovery; uses the local p-queue utility for concurrency.
---

# hanzio/sitemap

`getDomainSitemap(domain, options)` finds a domain's sitemaps (the `Sitemap:` lines in robots.txt first, then common locations like `/sitemap.xml`) and crawls them with bounded parallelism using the local `hanzio/p-queue` utility.

- A document whose root element is `<sitemapindex>` is treated as a list of child sitemaps. A document whose root element is `<urlset>` is treated as a list of pages.
- `<loc>` values are XML-entity decoded, and CDATA is supported.
- Gzipped sitemaps (`.xml.gz`) are decompressed with `DecompressionStream`.
- Every request has its own timeout (`AbortSignal.timeout`).

Requires runtime `fetch`, `AbortSignal.timeout` and `DecompressionStream` (Node 18+, Bun, modern browsers), or pass your own `fetch`.

```ts
import { getDomainSitemap, getDomainSitemapEntries } from 'hanzio/sitemap'

const urls = await getDomainSitemap('example.com', {
	filterIndexes: 'posts', // substring, RegExp or (url) => boolean
	filterUrls: /\/blog\//,
	maxUrls: 1000
})

// With lastmod
const entries = await getDomainSitemapEntries('example.com')
// [{ loc: 'https://example.com/a', lastmod: '2024-01-05' }, ...]
```

## Options (`SitemapOptions`)

| Option | Default | Description |
| --- | --- | --- |
| `filterIndexes` | none | Only follow child sitemaps that match (substring, RegExp or predicate). |
| `filterUrls` | none | Only keep page URLs that match. |
| `concurrency` | `10` | The maximum number of sitemap fetches that run at the same time. |
| `maxDepth` | `5` | The maximum sitemap-index nesting depth. |
| `maxUrls` | none | Stop crawling after this many URLs have been collected. |
| `timeout` | `10000` | The timeout for each request, in ms. |
| `userAgent` | `'SitemapCrawler/1.0'` | The `User-Agent` header sent with each request. |
| `fetch` | `globalThis.fetch` | A custom fetch implementation. |
| `onError` | `console.warn` | `(url, error) => void`, called when a robots.txt or sitemap request fails. |
| `respectRobots` | `false` | Drop page URLs that robots.txt disallows for `userAgent` (reuses the robots.txt fetched for discovery). A missing or failed robots.txt allows everything. |

Both functions throw `No sitemaps found for the domain` when discovery finds nothing.

## robots.txt

`parseRobotsTxt(body, userAgent = '*')` returns the rules for one crawler, following RFC 9309: the groups that name its product token (case-insensitive, so `MyBot/2.0` matches `User-agent: mybot`), merged, or else the `User-agent: *` groups. Directive names are case-insensitive and `#` comments are ignored. `sitemaps` lists every `Sitemap:` line.

`isAllowedByRobots(rules, url)` checks an absolute URL or a path (plus query string). The longest matching pattern wins, `Allow` wins a tie, `*` matches any characters and a trailing `$` anchors the end. An empty `Disallow:` allows everything, and `/robots.txt` is always allowed.

```ts
import { isAllowedByRobots, parseRobotsTxt } from 'hanzio/sitemap'

const rules = parseRobotsTxt(body, 'MyBot/1.0')
// { allow: ['/cart/help'], disallow: ['/cart/'], sitemaps: [...], crawlDelaySec?: 5 }

isAllowedByRobots(rules, 'https://example.com/cart/add?id=1') // false
isAllowedByRobots(rules, '/cart/help') // true
```
