# hanzio

A small TypeScript-first utility library for common application code: arrays,
strings, promises, caching, state machines, dates, URLs, colors, Zod helpers,
API clients, JWTs, sitemap crawling, queues, secrets, and colorful terminal
logging.

## Install

```bash
bun add hanzio
# only needed for hanzio/zod, hanzio/api-wrapper and hanzio/secrets
bun add zod
```

The package is ESM and Bun-friendly. Bun consumers resolve the `bun` export to
the source TypeScript files, while Node/bundler consumers resolve built files
from `dist`. `zod` is an optional peer dependency: the Zod helpers, the API
wrapper and the secrets loader share the consumer application's Zod instance,
while the root entry never loads it.

## Imports

The root export contains only dependency-free, runtime-neutral helpers (array,
string, promise, cache, state, typedSwitch, date, url, math, color, errors,
type guards, objects, functions, events and shared types):

```ts
import { groupBy, typedSwitch, tryCatch } from 'hanzio'
```

Everything that needs Zod, the network, or a specific runtime has its own
subpath export:

| Import | Contents |
| --- | --- |
| `hanzio/zod` | Branded IDs, JSON schemas, schema introspection and defaults, schema-to-type rendering, min/max filters |
| `hanzio/api-wrapper` | Typed HTTP clients ([docs](src/api-wrapper/README.md)) |
| `hanzio/api-wrapper/testing` | `createMockFetch` / `jsonResponse` for testing API clients |
| `hanzio/jwt` | HS256/384/512 JWTs via Web Crypto ([docs](src/jwt/README.md)) |
| `hanzio/sitemap` | Sitemap discovery and crawling ([docs](src/sitemap/README.md)) |
| `hanzio/p-queue` | Promise queue ([docs](src/p-queue/README.md)) |
| `hanzio/cool-console-log` | Colored terminal logging |
| `hanzio/format` | Cached `Intl` formatters: numbers, currency, bytes, durations, relative time ([docs](src/format/README.md)) |
| `hanzio/crypto` | Web Crypto helpers: constant-time compare, HMAC/webhook verification, sealing, tokens ([docs](src/crypto/README.md)) |
| `hanzio/storage` | Typed localStorage/AsyncStorage items that never throw ([docs](src/storage/README.md)) |
| `hanzio/i18n` | Typed `{placeholder}` interpolation and translators ([docs](src/i18n/README.md)) |
| `hanzio/secrets` | Typed secret sets from env/Infisical ([docs](src/secrets/README.md)) |
| `hanzio/secrets/vite` | Vite `define` helpers for secret sets |
| `hanzio/secrets/worker` | Secret sets for Cloudflare Workers |

`scripts/verify-exports.mjs` imports every entry above from the packed tarball
in CI, so this table and `package.json#exports` can't drift apart.

## Migrating to 2.0

- Subpath-only modules are no longer re-exported from `hanzio`. Change
  `import { createApiClient } from 'hanzio'` to `from 'hanzio/api-wrapper'`, and
  likewise for zod, jwt, sitemap, p-queue, cool-console-log and secrets.
- `Result` has an `ok` discriminant: `{ ok: true, data, error: null }` or
  `{ ok: false, data: null, error }`. Code that builds results by hand must add
  `ok`; `isSuccess`/`isFailure` now check it, so `throw null` is a failure.
- Color helpers moved from math to color. They're still on the root export.
- `groupBy` and `countBy` return `Partial<Record<K, …>>`, because not every key
  has a group.
- `extractNumber` reads thousands separators (`'1,234.56'` → `1234.56`, was
  `1`). Pass `{ decimalSeparator: ',' }` for European formats.
- `slugify` transliterates `æ`→`ae`, `œ`→`oe`, `ß`→`ss` (previously single letters).
- API wrapper retries default to exponential backoff with jitter instead of a
  fixed 300ms, and array query values serialize as `a=1&a=2` instead of `a=1,2`.
- `cool-console-log` only colors TTY output and honors `NO_COLOR`/`FORCE_COLOR`.
- API wrapper request inputs are typed with the schemas' input types
  (`z.input`): `.default()` fields become optional and transformed fields take
  their pre-transform type. Calls that passed post-transform values now fail
  to compile, as they already failed validation at runtime.
- API wrapper object and array bodies are sent as JSON when no `Content-Type`
  is set (previously a `ConfigError`), and endpoints/actions can't be named
  `request`, `cache` or `safe`.
- The API wrapper logs failures as `logger.error(summary, attributes)` instead
  of `logger.error(error)`.
- `normalizeSingleOrArray` (zod) is deprecated in favor of `toArray`.

## Utilities

### Array

`chunkArray` splits a readonly array into fixed-size chunks.

```ts
import { chunkArray } from 'hanzio'

const pages = chunkArray([1, 2, 3, 4, 5], 2)
// [[1, 2], [3, 4], [5]]
```

`findArrayDifferenceByKey` compares two arrays by a key name or key function and
returns `new`, `upsert`, and `delete` groups. Pass `isEqual` to also split
`upsert` into `update` and `unchanged`.

```ts
import { findArrayDifferenceByKey } from 'hanzio'

const diff = findArrayDifferenceByKey(
	[{ id: 1, name: 'old' }, { id: 3, name: 'same' }],
	[{ id: 1, name: 'new' }, { id: 2, name: 'added' }, { id: 3, name: 'same' }],
	'id',
	{ isEqual: (current, next) => current.name === next.name }
)
// diff.new: [id 2], diff.update: [id 1], diff.unchanged: [id 3], diff.delete: []
```

`getUniqueValues` keeps the first unique value, comparing with
`stableStringify` (object key order doesn't matter). `getUniqueValuesByKey`
keeps the first item per key name or key function.

```ts
import { getUniqueValues, getUniqueValuesByKey } from 'hanzio'

getUniqueValues([{ a: 1, b: 2 }, { b: 2, a: 1 }])
// [{ a: 1, b: 2 }]
getUniqueValuesByKey(users, (user) => user.email.toLowerCase())
```

`compact` removes `null` and `undefined`; `toArray` normalizes a single value,
an array, or nullish input to an array.

```ts
import { compact, toArray } from 'hanzio'

compact(['Ada', null, 'Grace', undefined]) // string[]
toArray('tag') // ['tag']
toArray(undefined) // []
```

`groupBy`, `keyBy` and `countBy` index items by a property or callback and
preserve literal key unions when possible.

```ts
import { countBy, groupBy, keyBy } from 'hanzio'

const items = [
	{ type: 'fruit', name: 'apple' },
	{ type: 'veg', name: 'carrot' }
] as const

const byType = groupBy(items, 'type') // Partial<Record<'fruit' | 'veg', …[]>>
const byName = keyBy(items, 'name')
const counts = countBy(items, 'type') // { fruit: 1, veg: 1 }
```

`sumBy`, `sortBy` and `range` cover common list maths. `sortBy` is stable,
non-mutating, and puts `null`/`undefined` last.

```ts
import { range, sortBy, sumBy } from 'hanzio'

sumBy(orders, 'total')
sortBy(users, { by: 'lastLogin', order: 'desc' }, 'name')
range(5) // [0, 1, 2, 3, 4]
range(0, 10, 5) // [0, 5]
```

`partition` splits an array into matched and unmatched items.
`pickItemsInArray` filters by a key and narrows discriminated unions.

```ts
import { partition, pickItemsInArray } from 'hanzio'

const [even, odd] = partition([1, 2, 3, 4], (value) => value % 2 === 0)

type Item = { type: 'user'; name: string } | { type: 'team'; members: number }
const users = pickItemsInArray([] as Item[], 'type', ['user'] as const)
// Array<{ type: 'user'; name: string }>
```

### String

`extractNumber` parses the first number in a string, including thousands
separators.

```ts
import { extractNumber } from 'hanzio'

extractNumber('Total: 1,234.45 kr') // 1234.45
extractNumber('1.234,56 kr', { decimalSeparator: ',' }) // 1234.56
extractNumber('2024-01-05') // 2024
```

`generateId` creates a short, stable, non-cryptographic hash key from JSON-like
input (object key order doesn't matter). Use `sha256Id` when collisions matter.

```ts
import { generateId, sha256Id } from 'hanzio'

const id = generateId({ page: 1, filters: ['active'] })
const strongId = await sha256Id({ page: 1 }, 24)
```

`stableStringify` is `JSON.stringify` with sorted keys plus `Map`, `Set` and
`bigint` support. Use it for cache and dedupe keys.

```ts
import { stableStringify } from 'hanzio'

stableStringify({ b: 1, a: 2 }) === stableStringify({ a: 2, b: 1 }) // true
```

`slugify` normalizes text for URL slugs.

```ts
import { slugify } from 'hanzio'

slugify('Hello, København!') // "hello-kobenhavn"
slugify('Hello World', { separator: '_', maxLength: 8 }) // "hello_wo"
```

`truncate` cuts to a length that includes the ellipsis, never splits emoji,
and can stop at a word boundary. `normalizeWhitespace` collapses whitespace
runs (including non-breaking spaces).

```ts
import { normalizeWhitespace, truncate } from 'hanzio'

truncate('Hello wonderful world', 12) // "Hello wonde…"
truncate('Hello wonderful world', 12, { wordBoundary: true }) // "Hello…"
normalizeWhitespace('  a \n\t b  ') // "a b"
```

`matchesSearch` checks that every query term appears in one of the fields,
ignoring case and accents. `initials` handles names, emails and emoji.

```ts
import { initials, matchesSearch } from 'hanzio'

customers.filter((c) => matchesSearch(query, c.name, c.email)) // "sø" finds "Søren"
initials('Ada Lovelace') // "AL"
initials('ada.lovelace+work@example.com') // "AL"
```

`safeJsonParse` returns a `Result` instead of throwing; `escapeRegExp` escapes
text for use inside a `RegExp`.

```ts
import { escapeRegExp, safeJsonParse } from 'hanzio'

const parsed = safeJsonParse<Settings>(raw)
if (parsed.ok) parsed.data
new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i')
```

### Promise

`tryCatch` converts a promise, or a function that may throw synchronously, into
a `Result<T, E>`. `isSuccess`, `isFailure` and `unwrapResult` consume it.

```ts
import { tryCatch, unwrapResult } from 'hanzio'

const result = await tryCatch(() => fetch('/api/users'))
if (result.ok) result.data
const response = unwrapResult(result)
```

`retry` retries a function with exponential backoff (full jitter) by default.
`exponentialBackoff` is exported for your own retry loops.

```ts
import { retry } from 'hanzio'

const data = await retry(() => fetchReport(), {
	retries: 5,
	shouldRetry: (error) => !(error instanceof ValidationError),
	signal
})
```

`withTimeout` rejects with `PromiseTimeoutError` after a deadline. Pass a
function to receive a signal that aborts on timeout.

```ts
import { withTimeout } from 'hanzio'

const res = await withTimeout((signal) => fetch(url, { signal }), 5_000)
```

`pMap` maps with bounded concurrency and keeps input order.

```ts
import { pMap } from 'hanzio'

const users = await pMap(ids, (id) => fetchUser(id), { concurrency: 4 })
```

`promiseTimeout` resolves after a delay (and rejects early if its signal
aborts). `backgroundPromise` runs async work and reports success or failure
through hooks; `backgroundPromiseSync` schedules it in a microtask.

```ts
import { backgroundPromise, promiseTimeout } from 'hanzio'

await promiseTimeout(250, { signal })
backgroundPromise(() => syncAnalytics(), {
	onError: (error) => console.error(error)
})
```

`ok` and `err` build `Result` values. `startTimer` and `timed` measure
durations without `performance.now()` bookkeeping.

```ts
import { err, ok, startTimer, timed } from 'hanzio'

function parseAge(input: string) {
	const age = Number(input)
	return Number.isInteger(age) ? ok(age) : err('not a number')
}

const elapsed = startTimer()
await work()
log.info('done', { durationMs: elapsed() })

const { result, durationMs } = await timed(() => fetchReport())
```

Abort helpers: `anySignal` combines signals (ignoring `undefined`),
`timeoutSignal` adds a deadline to an optional caller signal, and `raceAbort`
rejects a promise as soon as a signal aborts.

```ts
import { anySignal, raceAbort, timeoutSignal } from 'hanzio'

await fetch(url, { signal: timeoutSignal(10_000, request.signal) })
const signal = anySignal(userSignal, shutdownSignal)
const result = await raceAbort(sdkCallWithoutSignalSupport(), signal)
```

`createLatestGuard` ignores results from outdated async calls (e.g. a search
box where an old request resolves after a newer one).

```ts
import { createLatestGuard } from 'hanzio'

const guard = createLatestGuard()
async function search(query: string) {
	const outcome = await guard.run(() => api.search(query))
	if (!outcome.stale) results.value = outcome.value
}
```

`exponentialBackoff` also supports `jitter: 'partial'` (adds up to
`jitterRatio`, default 25%, on top of the computed delay, which suits reconnect
loops) and an injectable `random` for tests.

### Cache

`cacheFunction` wraps sync or async functions with TTL caching and request
deduplication. With `refreshInBackground: true`, stale entries are served
immediately while a background refresh updates the cache
(stale-while-revalidate). Keys are built with `stableStringify`, and
`maxEntries` bounds the in-memory cache with LRU eviction.

```ts
import { cacheFunction } from 'hanzio'

const getUser = cacheFunction({
	name: 'getUser',
	fn: async (id: string) => ({ id, name: 'Ada' }),
	cacheTimeMs: 60_000,
	maxEntries: 1_000
})

const user = await getUser('user_1')
getUser.peek('user_1') // cached value without calling fn
getUser.invalidate('user_1') // drop one entry
getUser.clearCache() // drop everything
```

`createCache` is a plain key/value cache with TTL, LRU bound and in-flight
dedupe, for when you're not wrapping a single function.

```ts
import { createCache } from 'hanzio'

const tokens = createCache({ defaultTtlMs: 50 * 60_000, maxEntries: 100 })
const token = await tokens.getOrSet('auth', () => login())
tokens.delete('auth')
```

#### External stores (e.g. Redis)

By default entries live in an in-memory `Map`. Pass a `store` to keep entries
in an external cache instead. A store implements `get`, `set`, and `delete`
(plus an optional `clear`, used by `clearCache`); hanzio never imports the
underlying client, so any backend works. Serialization is the adapter's
responsibility, and the `ttlMs` passed to `set` maps to the store's native
expiry. External stores are only supported for async functions.

```ts
import { cacheFunction, type CacheStore, type CacheStoreEntry } from 'hanzio'
import Redis from 'ioredis'

const redis = new Redis()

const redisStore: CacheStore = {
	get: async (key) => {
		const raw = await redis.get(key)
		return raw ? (JSON.parse(raw) as CacheStoreEntry) : undefined
	},
	set: async (key, entry, ttlMs) => {
		await redis.set(key, JSON.stringify(entry), 'PX', ttlMs)
	},
	delete: async (key) => {
		await redis.del(key)
	}
}

const getUser = cacheFunction({
	name: 'getUser',
	fn: async (id: string) => ({ id, name: 'Ada' }),
	cacheTimeMs: 60_000,
	store: redisStore,
	onStoreError: (error) => console.error('cache store failed', error)
})
```

Store failures never break the cached function: on a failed `get` or `set`
the wrapped function falls back to calling `fn` directly, and the optional
`onStoreError` callback is invoked.

For token-style entries, `ttlMs` can be computed from the value and
`staleMarginMs` refreshes the entry early (`get` still returns the old value
until it really expires).

```ts
const tokens = createCache()
const token = await tokens.getOrSet('shopify', fetchAccessToken, {
	ttlMs: (token) => token.expiresIn * 1000,
	staleMarginMs: 60_000
})
```

### State Machine

`createStateMachine` defines typed states, actions, validation, and action
payloads once; `.for(item, stateKey)` binds it to an entity.

```ts
import { createStateMachine } from 'hanzio'

type State = 'draft' | 'published'
type Action = 'publish'
type Post = { status: State }

const postMachine = createStateMachine<
	State,
	Action,
	Post,
	{ publish: { notify: boolean } }
>({
	initialState: 'draft',
	stateActionMap: { draft: { publish: 'published' }, published: {} },
	stateTransitions: { draft: ['published'], published: [] },
	actionValidators: {
		publish: (post) => post.status === 'draft' || 'Already published'
	},
	applyTransition: true,
	onTransition: async (post, from, to) => savePost(post)
})

const machine = postMachine.for({ status: 'draft' }, 'status')
await machine.canExecute('publish') // true | 'reason'
const result = await machine.executeAction('publish', { notify: true })
machine.getCurrentStatus() // 'published'
```

`new SimpleStateMachine(config, item, stateKey)` still works for one-off use.
Validators run in order: `globalValidator`, `validators[toState]`, then
`actionValidators[action]`.

### typedSwitch

`typedSwitch` is an exhaustive switch helper for string unions and discriminated
unions (string, number or boolean discriminants). `assertNever` covers regular
`switch` statements. See the [typedSwitch docs](src/typedswitch/README.md).

```ts
import { assertNever, typedSwitch } from 'hanzio'

type Event =
	| { type: 'click'; x: number; y: number }
	| { type: 'scroll'; offset: number }

const label = typedSwitch({ type: 'click', x: 10, y: 20 } as Event, 'type', {
	click: (event) => `Clicked ${event.x},${event.y}`,
	scroll: (event) => `Scrolled ${event.offset}`
})

type Response = { code: 200; body: string } | { code: 404 }
const text = typedSwitch(response as Response, 'code', {
	200: (res) => res.body,
	404: () => 'Not found'
})

function area(shape: Shape) {
	switch (shape.kind) {
		case 'circle':
			return Math.PI * shape.r ** 2
		default:
			return assertNever(shape.kind)
	}
}
```

### Date

`getPeriod` returns the daily, weekly (ISO weeks by default), monthly,
quarterly or yearly range around a date, shifted by `offset` periods. `end` is
the start of the last day, so compare with `< addPeriod(end, 'DAILY', 1)` for
an exclusive bound. Pass `{ utc: true }` on servers.

```ts
import { addPeriod, getPeriod, getPreviousReportPeriod } from 'hanzio'

const thisQuarter = getPeriod('QUARTERLY', new Date('2026-04-15'))
const lastWeek = getPeriod('WEEKLY', new Date(), -1, { utc: true })
const previousMonth = getPreviousReportPeriod('MONTHLY', new Date('2026-04-15'))
addPeriod(new Date(2026, 0, 31), 'MONTHLY', 1) // Feb 28 2026
```

`formatPeriodLabel` formats a date range for display.

```ts
import { formatPeriodLabel } from 'hanzio'

formatPeriodLabel('2026-01-01', '2026-03-31')
// "January 2026 — March 2026"
formatPeriodLabel('2026-01-01', '2026-03-31', { collapse: true })
// "January – March 2026"
formatPeriodLabel(start, end, { locale: 'da-DK', includeDay: true, timeZone: 'UTC' })
```

### URL

`buildUrl` joins a base and path, fills `:params` and appends a query string.
`buildQueryString` repeats array keys and skips nullish values.

```ts
import { buildQueryString, buildUrl, normalizeDomain } from 'hanzio'

buildUrl('https://api.example.com/', '/users/:id', {
	params: { id: 7 },
	query: { expand: ['teams', 'roles'] }
})
// "https://api.example.com/users/7?expand=teams&expand=roles"

buildQueryString({ page: 2, tag: ['a', 'b'], q: undefined }) // "page=2&tag=a&tag=b"
normalizeDomain('example.com/about') // "https://example.com"
```

`getDomainFaviconUrl` builds a Google favicon URL from a domain or full URL.

```ts
import { getDomainFaviconUrl } from 'hanzio'

const favicon = getDomainFaviconUrl('https://example.com/pricing', 64)
```

`trimTrailingSlash`, `ensureLeadingSlash`, `buildMailto` (encodes with `%20`,
as mail clients expect) and `parseRetryAfter` (delta-seconds or HTTP date → ms).

```ts
import { buildMailto, parseRetryAfter, trimTrailingSlash } from 'hanzio'

trimTrailingSlash('https://api.example.com//') // "https://api.example.com"
buildMailto({ to: 'sales@example.com', subject: 'Hi there' })
// "mailto:sales@example.com?subject=Hi%20there"
parseRetryAfter(response.headers.get('retry-after')) // ms | undefined
```

### Math

`linearRegression` fits a least-squares line and returns `slope`,
`intercept`, `r2` and `fitted` values; `linearRegressionTrend` returns just the
fitted values. `clamp`, `lerp` and `normalize` cover common scaling.

```ts
import { clamp, linearRegression, normalize } from 'hanzio'

const fit = linearRegression([1, 3, 5])
// { slope: 2, intercept: 1, r2: 1, fitted: [1, 3, 5] }
clamp(12, 0, 10) // 10
normalize(15, 10, 20) // 0.5
```

### Color

`hashStringToColorIndex`, `seriesColorKey`, `resolveSeriesColorMap`,
`createResolveColorsByKeys`, `withAlpha`, and `getHeatmapCellStyle` help assign
stable chart colors and heatmap styles. Palette size defaults to 10 and can be
passed as the last argument.

```ts
import { createResolveColorsByKeys, withAlpha } from 'hanzio'

const palette = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626']
const colors = createResolveColorsByKeys(
	['revenue', 'profit'],
	(index) => palette[index]!,
	(index) => withAlpha(palette[index]!, 0.8),
	palette.length
)

withAlpha('#2563eb', 0.4) // "rgba(37, 99, 235, 0.4)"
withAlpha('hsl(220 83% 53%)', 0.4) // "hsla(220, 83%, 53%, 0.4)"
withAlpha('var(--brand)', 0.4) // "color-mix(in srgb, var(--brand) 40%, transparent)"
```

`parseColor` reads hex, `rgb()` and `hsl()` strings; `contrastText`,
`contrastRatio` and `relativeLuminance` follow WCAG 2.x; `shade`, `mixColors`,
`toHex` and `toRgbString` convert and adjust colors. `pickFromPalette` picks a
stable palette entry for a string (avatars, calendars).

```ts
import { contrastText, pickFromPalette, shade } from 'hanzio'

const text = contrastText(brandColor) // '#ffffff' or '#000000'
const hover = shade(brandColor, -0.1) // 10% darker
const avatarColor = pickFromPalette(user.id, AVATAR_COLORS)
```

### Errors and assertions

`getErrorMessage` and `toError` normalize `unknown` catch values. `must` and
`invariant` replace "if missing, throw" blocks and non-null assertions; they
throw `InvariantError`, or your own error when you pass a function.

```ts
import { getErrorMessage, invariant, must, toError } from 'hanzio'

try {
	await sync()
} catch (error) {
	log.error(getErrorMessage(error, 'Sync failed'))
	throw toError(error, 'sync')
}

const user = must(await findUser(id), () => new ORPCError('NOT_FOUND'))
const first = must(rows[0], 'Expected at least one row')
invariant(order.status === 'paid', 'Order must be paid before shipping')
```

### Type guards

```ts
import {
	hasKey,
	isDefined,
	isOneOf,
	isRecord,
	isTruthy,
	nonEmpty
} from 'hanzio'

const STATUSES = ['draft', 'published'] as const
if (isOneOf(STATUSES, input)) input // 'draft' | 'published'
const valid = values.filter(isOneOf(STATUSES))

if (isRecord(json) && hasKey(LABELS, json.kind)) LABELS[json.kind]
const ids = rows.map((row) => row.id).filter(isDefined) // string[]
const parts = [a, b && `(${b})`].filter(isTruthy)
const Status = z.enum(nonEmpty(statuses)) // [T, ...T[]]
```

Also: `isPlainObject`, `isString`, `isNumber`, `isBoolean`, `isFunction`,
`isNonEmpty`.

### Objects

Typed versions of the `Object.*` helpers that otherwise need casts, plus
`pick`, `omit`, `mapValues` and dot-path access (which rejects `__proto__`,
`constructor` and `prototype` segments).

```ts
import {
	getAtPath,
	omit,
	pick,
	recordFromKeys,
	setAtPath,
	typedEntries,
	typedKeys
} from 'hanzio'

for (const key of typedKeys(config)) config[key]
for (const [key, value] of typedEntries(config)) {}
const enabled = recordFromKeys(FEATURES, (feature) => false) // Record<Feature, boolean>
const publicUser = omit(user, ['passwordHash'])

setAtPath(form, 'contacts.0.email', 'ada@example.com')
getAtPath(form, 'contacts.0.email')
```

`typedFromEntries` is also available.

### Functions and events

`debounce`, `keyedDebounce` (one independent debounce per key), `throttle`,
`once` and `createHeartbeat` ("send now, then at most once per interval while
active, stop when idle", e.g. typing indicators). `createEmitter` is a small
typed event emitter.

```ts
import { createEmitter, createHeartbeat, debounce, keyedDebounce } from 'hanzio'

const save = debounce(() => persist(draft), 500, { maxWaitMs: 5_000 })
const refetch = keyedDebounce((domain: string) => invalidate(domain), 250)
refetch.call('sessions')

const typing = createHeartbeat({
	send: () => socket.send({ type: 'typing' }),
	onStop: () => socket.send({ type: 'typing-stopped' }),
	intervalMs: 3_000,
	idleMs: 5_000
})
input.addEventListener('input', () => typing.activity())

const events = createEmitter<{ login: { userId: string }; logout: undefined }>()
const off = events.on('login', ({ userId }) => track(userId))
events.emit('logout')
```

### Types

`MaybePromise`, `ValueOf`, `ElementOf`, `NonEmptyArray`, `Simplify` and
`Nullable`.

```ts
import type { ElementOf, MaybePromise, ValueOf } from 'hanzio'

type ToolId = ValueOf<typeof TOOL_IDS>
type Status = ElementOf<typeof STATUSES>
type Handler = (event: Event) => MaybePromise<void>
```

## Subpath modules

### Zod (`hanzio/zod`)

`createZId` and `GenericId` create branded string ID schemas, optionally
requiring a prefix.

```ts
import { createZId, type GenericId } from 'hanzio/zod'

const UserId = createZId('User', { prefix: 'usr_' })
type UserId = GenericId<'User'>

const userId: UserId = UserId.parse('usr_123')
```

`zSingleOrArray` accepts either one schema value or an array of schema values.

```ts
import { zSingleOrArray } from 'hanzio/zod'
import { z } from 'zod'

const Tags = zSingleOrArray(z.string())
Tags.parse('news')
Tags.parse(['news', 'product'])
```

`createMinMaxFilter` builds `{ min?, max? }` filter schemas for any value type
(`zodMinMaxFilter` is the number version). `toGteLteFilter` and `toGtLtFilter`
map them to inclusive or exclusive ORM-style ranges.

```ts
import { createMinMaxFilter, toGteLteFilter, zodMinMaxFilter } from 'hanzio/zod'
import { z } from 'zod'

toGteLteFilter(zodMinMaxFilter.parse({ min: 10, max: 20 }))
// { gte: 10, lte: 20 }

const DateRange = createMinMaxFilter(z.coerce.date())
toGteLteFilter(DateRange.parse({ min: '2026-01-01' }))
// { gte: Date(2026-01-01) }
```

`jsonToZodSchemaMapper` maps raw JSON into a Zod schema shape. Each config
entry is either a mapper function or a nested config for an object (or array of
objects) field.

```ts
import { jsonToZodSchemaMapper } from 'hanzio/zod'
import { z } from 'zod'

const User = z.object({
	id: z.string(),
	address: z.object({ city: z.string() })
})
const user = jsonToZodSchemaMapper(
	{ user_id: '1', address: { town: 'Aarhus' } },
	User,
	{
		id: (json) => json.user_id,
		address: { city: (address) => address.town }
	}
)
```

`zodToTypeString` and `zodToExample` render TypeScript-like types and example
JSON from Zod 4 schemas (objects, arrays, tuples, unions, intersections, enums,
literals, records, pipes, lazy/recursive schemas and more).

```ts
import { zodToExample, zodToTypeString } from 'hanzio/zod'
import { z } from 'zod'

const schema = z.object({ id: z.string(), role: z.enum(['admin', 'user']) })
zodToTypeString(schema) // '{\n  id: string\n  role: "admin" | "user"\n}'
zodToExample(schema) // { id: '', role: 'admin' }
```

`createIdHelpers` binds a project's entity names once, so branded IDs can't
be swapped (`Id<'User'>` is not assignable to `Id<'Organization'>`).

```ts
import { createIdHelpers, type Id } from 'hanzio/zod'

export const { zId, asId, parseId, safeParseId } = createIdHelpers<
	'User' | 'Organization'
>()

const Input = z.object({ userId: zId('User') })
const userId = parseId('User', params.id) // throws on empty/non-string
const fromDb = asId<'User'>(row.id) // unchecked brand
```

`zJsonValue`/`zJsonObject` validate JSON values, `parseJson` parses and
validates in one step, and `getEnumValues`, `getObjectShape`, `unwrapSchema`
and `zodDefaults` inspect schemas (e.g. to build form defaults).

```ts
import { parseJson, zJsonObject, zodDefaults } from 'hanzio/zod'

const settings = parseJson(raw, Settings) // Result<Settings, SyntaxError | ZodError>
const metadata = zJsonObject.parse(input)
const initialForm = zodDefaults(FormSchema) // defaults, first enum value, '' for strings…
```

### API Wrapper (`hanzio/api-wrapper`)

`createApiClient` creates a Zod-backed API client with typed request inputs and
response data (`defineEndpoint` infers path params from `'/users/:id'`),
`api.safe` for `Result`-based error handling, retries with exponential backoff, middleware (`use`),
dependency-free OpenTelemetry tracing (`otelMiddleware`), lazy
`defaultHeaders`, `checkResponse` for error envelopes, composite actions and
structured errors. Failed requests are logged with a category (server error,
rejected request, input or output validation, network, timeout) and the
details needed to fix them. `paginate` iterates cursor- or page-based endpoints. See the
[API wrapper docs](src/api-wrapper/README.md).

```ts
import { createApiClient, isHttpResponseError, paginate } from 'hanzio/api-wrapper'
import { z } from 'zod'

const api = createApiClient({
	baseApiUrls: { default: 'https://api.example.com' },
	endpoints: {
		getUser: {
			method: 'GET',
			path: '/users/:id',
			reqParamsSchema: z.object({ id: z.number() }),
			resSchema: z.object({ id: z.number(), name: z.string() })
		}
	}
})

try {
	const { data } = await api.getUser({ reqParams: { id: 1 } })
} catch (error) {
	if (isHttpResponseError(error) && error.status === 404) return null
	throw error
}

for await (const page of paginate(
	(cursor?: string) => fetchPage(cursor),
	(page) => page.nextCursor
)) {
	// …
}
```

### JWT (`hanzio/jwt`)

`jwtSign` signs an HMAC JWT (HS256 by default) with optional `expiresIn`,
`notBefore`, `issuer` and `audience`. `jwtVerify` returns the payload or `null`;
`jwtVerifyResult` explains failures with an error `code`. `jwtDecode` reads a
token without verifying it. See the [JWT docs](src/jwt/README.md).

```ts
import { jwtSign, jwtVerify, jwtVerifyResult } from 'hanzio/jwt'

const token = await jwtSign({ sub: 'user_1' }, secret, {
	expiresIn: 3600,
	audience: 'api'
})
const payload = await jwtVerify<{ sub: string }>(token, secret, {
	audience: 'api',
	leewaySec: 30
})

const result = await jwtVerifyResult(token, secret)
if (!result.ok) console.warn(result.error.code) // 'expired', 'invalid_signature', …
```

### Sitemap (`hanzio/sitemap`)

`getDomainSitemap` discovers (robots.txt, then common locations) and crawls a
domain's sitemaps, including nested indexes and gzipped files.
`getDomainSitemapEntries` also returns `lastmod`. See the
[sitemap docs](src/sitemap/README.md).

```ts
import { getDomainSitemap, getDomainSitemapEntries } from 'hanzio/sitemap'

const urls = await getDomainSitemap('example.com', {
	concurrency: 5,
	filterUrls: /\/blog\//,
	maxUrls: 500
})
const entries = await getDomainSitemapEntries('example.com', {
	onError: (url, error) => log.warn('sitemap failed', { url, error })
})
```

`respectRobots: true` drops page URLs that the site's robots.txt disallows for
`userAgent`, reusing the robots.txt fetched during discovery.
`parseRobotsTxt` and `isAllowedByRobots` (RFC 9309: longest match, `*` and `$`
wildcards, Allow wins ties) are exported for other crawlers.

```ts
import { isAllowedByRobots, parseRobotsTxt } from 'hanzio/sitemap'

const rules = parseRobotsTxt(await (await fetch(`${origin}/robots.txt`)).text(), 'MyBot')
isAllowedByRobots(rules, 'https://example.com/private/page') // false
```

### PQueue (`hanzio/p-queue`)

`PQueue` runs promise-returning tasks with concurrency, priority, timeout, abort,
and rate-limit controls. It's available as the default export and as the named
export `PQueue`. See the [PQueue docs](src/p-queue/README.md).

```ts
import { PQueue, TimeoutError } from 'hanzio/p-queue'

const queue = new PQueue({ concurrency: 2, timeout: 5_000 })

try {
	await queue.add(async () => 'done')
} catch (error) {
	if (error instanceof TimeoutError) console.error('Task timed out')
}
await queue.onIdle()
```

For simple bounded-concurrency mapping, `pMap` from `hanzio` is lighter.

### Cool console log (`hanzio/cool-console-log`)

ANSI-colored logging for terminals: `createCoolLogger`, `startOperation`,
`logOperationSummary`, `colorize`, `logBanner`, `supportsColor` and
`terminalColors`. Colors are used only for TTY output in development
(`NODE_ENV !== 'production'`), honor `NO_COLOR`/`FORCE_COLOR`, and the module
is safe to import in browsers and Workers.

```ts
import {
	colorize,
	createCoolLogger,
	logBanner,
	startOperation
} from 'hanzio/cool-console-log'

const log = createCoolLogger({ minLevel: 'info' })
log.info('User logged in', { userId: '123', roles: ['admin'] })

const requestLog = log.child({ requestId: 'req_1' })
requestLog.warn('Rate limit approaching', { remaining: 10 })

const done = startOperation('user.create')
await createUser()
done() // "user.create ✓ · 12.3ms"

console.log(colorize('OK', 'brightGreen'))
logBanner('Server started', 'cyan')
```

### Format (`hanzio/format`)

Locale-aware formatting on `Intl`, with memoized formatters (`getNumberFormat`,
`getDateTimeFormat`, …) so lists don't create one per row. Locales are BCP-47
tags; functions that read the clock accept `now`. See the
[format docs](src/format/README.md).

```ts
import {
	formatBytes,
	formatCappedCount,
	formatCurrency,
	formatDuration,
	formatRelativeTime,
	pluralize
} from 'hanzio/format'

formatDuration(3_900_000, 'en-US') // "1 hr, 5 min"
formatDuration(3_900_000, 'en-US', { style: 'narrow' }) // "1h 5m"
formatRelativeTime(message.createdAt, 'da-DK') // "for 5 minutter siden"
formatCurrency(1299, 'DKK', 'da-DK') // "1.299,00 kr."
formatBytes(1_572_864) // "1.5 MB"
formatCappedCount(140) // "99+"
pluralize(3, { one: '{count} item', other: '{count} items' }, 'en-US') // "3 items"
```

Also: `formatNumber`, `formatPercent`, `formatCompactNumber`, `splitDuration`,
`formatClockDuration`, `formatWait`, `formatDateRange`, `formatList`.

### Crypto (`hanzio/crypto`)

Web Crypto only, so it runs in browsers, Workers, Node and Bun. See the
[crypto docs](src/crypto/README.md).

```ts
import {
	createSealer,
	randomToken,
	safeEqual,
	verifyHmacSignature,
	verifySvixSignature
} from 'hanzio/crypto'

safeEqual(providedPassword, expectedPassword) // constant-time

// Meta-style webhooks: x-hub-signature-256: sha256=<hex>
await verifyHmacSignature(appSecret, rawBody, header, { prefix: 'sha256=' })

// Svix / Standard Webhooks (Resend, Clerk, …)
await verifySvixSignature({ secret: 'whsec_…', payload: rawBody, headers: request.headers })

// AES-256-GCM with an HKDF-derived key; output looks like enc:v1:…
const sealer = createSealer({ secret: appSecret })
const stored = await sealer.sealJson({ refreshToken })
const { refreshToken: token } = await sealer.openJson<{ refreshToken: string }>(stored)

const apiKey = randomToken() // 32 random bytes, base64url
```

Also: `hmacSign`, `sha256`, `sha256Hex`, `randomBytes`, and base64, base64url,
hex and UTF-8 encoders/decoders.

### Storage (`hanzio/storage`)

Typed values persisted in `localStorage`/`sessionStorage` or an async store
like React Native's AsyncStorage. Items never throw: corrupt or invalid data
returns the fallback, and when storage itself fails (private mode, sandboxed
iframes, quota) the latest value is kept in memory. See the
[storage docs](src/storage/README.md).

```ts
import { createAsyncStorageItem, createStorageItem } from 'hanzio/storage'

const panelPrefs = createStorageItem({
	key: 'panel-prefs',
	fallback: { open: false, width: 320 },
	parse: PanelPrefs.parse // zod schema; invalid data → fallback
})
panelPrefs.set({ ...panelPrefs.get(), open: true })
const off = panelPrefs.subscribe((prefs) => apply(prefs)) // other tabs

const inbox = createAsyncStorageItem({ key: 'inbox', fallback: [], storage: AsyncStorage })
await inbox.get()
```

### i18n (`hanzio/i18n`)

Typed `{placeholder}` interpolation and a small typed translator. Params are
required exactly when a message has placeholders. See the
[i18n docs](src/i18n/README.md).

```ts
import { createTranslator, interpolate } from 'hanzio/i18n'

interpolate('Hi {name}, you have {count} messages', { name: 'Ada', count: 3 })

const t = createTranslator({
	inbox: { title: 'Inbox', unread: '{count} unread' }
} as const)
t('inbox.title')
t('inbox.unread', { count: 4 })
// @ts-expect-error missing params
t('inbox.unread')
```

### Secrets (`hanzio/secrets`)

`defineSecretSet` loads a typed set of required secrets from `process.env` or
Infisical before the rest of the program starts.

When both `INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET` are set, it uses
Infisical's HTTP API. If either is missing, it uses your signed-in Infisical CLI
session. For local development, install the CLI and run
`infisical login --domain=https://eu.infisical.com` (or your configured
`siteUrl`). See the [secrets documentation](src/secrets/README.md) for details.

```ts
import { defineSecretSet } from 'hanzio/secrets'

export const backendSecrets = await defineSecretSet(
	['DATABASE_URL', 'APP_SECRET'] as const,
	{
		organizationId: 'infisical-organization-id',
		projectId: 'infisical-project-id'
	}
)

const databaseUrl = backendSecrets.secret('DATABASE_URL')
```

The required `organizationId` scopes the CLI session per secret set, allowing projects
in different organizations to run together without switching the active CLI
organization. This flow reads the CLI user token and fetches secrets over HTTP;
tokens remain in memory. Use `writeToProcessEnv: false` for multiple sets in one
process. Both `organizationId` and `projectId` are required for Infisical loading.

For Vite config, `viteSecretSetPlugin(secretSet)` exposes the loaded values as
`import.meta.env.*` replacements. Use `getViteDefine(secretSet)` if you need the
raw `define` object. Vite helpers accept only `VITE_` keys by default; use an
explicit `publicKeys` list to select public values from a mixed set. Import
these helpers from `hanzio/secrets/vite`.

The helper supports `auth: 'auto' | 'http' | 'cli'`, `secretPath`, deadlines,
cancellation, optional schema validation, per-key source metadata, and
`writeToProcessEnv: false` for isolated sets. Use `hanzio/secrets/worker` for
Cloudflare bindings without Node compatibility. See the
[migration notes](src/secrets/README.md#migration-notes) for stricter environment
validation and browser exposure rules.

## Development

```bash
bun run typecheck
bun test
bun run lint
bun run build
```

## Releasing

Squash PRs with conventional titles (`fix:`, `feat:`, or `feat!:`). Release Please keeps the version and changelog in a release PR; merge that PR to publish with release notes and npm provenance. See [release and recovery instructions](docs/releasing.md).

## License

[MIT](LICENSE).
