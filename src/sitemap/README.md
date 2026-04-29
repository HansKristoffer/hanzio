---
description: Discover and crawl XML sitemaps for URL discovery; uses the local p-queue utility for concurrency.
---

# hanset/sitemap

`getDomainSitemap(domain, options)` uses the local `hanset/p-queue` utility for bounded parallelism.

Requires runtime `fetch` (Node 18+, Bun, or polyfill).

```ts
import { getDomainSitemap } from 'hanset/sitemap'
```
