# hanzio helper improvement plan

> **Status (2026-09-28): implemented.** Deviations from the plan below:
> - typedSwitch: the "with constraint" overloads were kept; removing them breaks
>   the documented `typedSwitch<HasId>(...)` usage and its return typing.
> - cache: the in-memory Map was not folded into a `CacheStore` (stores are
>   async, which would make sync functions return promises). Shared logic was
>   extracted into one helper instead. `createCache` backs the api-wrapper
>   action cache.
> - `pMap` is a standalone worker pool, not a `PQueue` wrapper, so the root
>   export stays free of p-queue.
> - `secrets/infisical` and `secrets/loaders` are not separate subpaths; both
>   are already re-exported from `hanzio/secrets`.
> - array: `zip` skipped (no caller).
> - Added from another project's api-wrapper review: `use` middleware,
>   `defaultHeaders` functions, `FetchLike`, `checkResponse` + `ApiResponseError`,
>   port-safe full `url` params, single-slash path joining,
>   `hanzio/api-wrapper/testing`, clean builds, and the action-factory type
>   inference fix (the README's `actions: ({ defineAction }) => …` form
>   inferred `any`).

Review of every module under `src/`, with a focus on making the helpers more
general-purpose. Ordered by priority. Each item names the file and the concrete change.

---

## P0 — Packaging and broken behavior (fix first)

### 1. Subpath imports in the README don't exist
`README.md` documents `hanzio/zod`, `hanzio/jwt`, `hanzio/sitemap`, `hanzio/p-queue`,
and `hanzio/cool-console-log`, but `package.json#exports` only declares `.`, `./secrets`,
`./secrets/vite` and `./secrets/worker`. Node and bundlers will throw
`ERR_PACKAGE_PATH_NOT_EXPORTED` for those imports.

- Add `exports` entries (types/bun/import/default) for `zod`, `api-wrapper`, `jwt`,
  `sitemap`, `p-queue`, `cool-console-log`, and `secrets/infisical` / `secrets/loaders`
  (these are already built by `build:js` but aren't exported).
- Add `./cool-console-log` to `build:js`.
- Add a CI check that imports every documented subpath from the built `dist` (extend
  `scripts/verify-secrets.mjs` or add a sibling script).

### 2. `PQueue` can't be reached at all
`src/p-queue/index.ts` uses `export default class PQueue`, and `src/index.ts` does
`export * from './p-queue'`, which drops default exports. With no `./p-queue` subpath,
Node consumers can't import it. `sitemap` uses it internally.
- Fix it with item 1 (subpath), and also add a named export `export { PQueue }`.
- The root barrel also leaks generic names like `Options`, `Queue`, `TimeoutError`, and
  `RunFunction`. Either rename them (`PQueueOptions`, `PQueueTimeoutError`) or stop
  exporting p-queue from the root.

### 3. The root barrel is too heavy and pulls in runtime-specific code
`src/index.ts` re-exports `zod`, `api-wrapper`, `secrets`, `jwt`, `sitemap`, `p-queue` and
`cool-console-log`. Importing `chunkArray` therefore loads `zod` at runtime (and Infisical,
Vite helpers, etc.).
- Keep the root to dependency-free helpers: array, string, promise, cache, state,
  typedswitch, date, url, math/color.
- Move zod, api-wrapper, secrets, jwt, sitemap, p-queue and cool-console-log to
  subpath-only exports (this is what the README already claims). **Breaking change: major
  bump.**
- Add `"sideEffects": false` to `package.json` so tree-shaking works.

### 4. `zodToTypeString` / `zodToExample` get Zod 4 enums wrong and recurse infinitely on Zod 3
Verified with `bun`:
- `zodToTypeString(z.enum(['a','b']))` returns `"string"`, and `zodToExample` returns `""`.
  Zod 4 stores the values in `def.entries`, not `def.values`.
- The `case 'ZodObject' | 'ZodArray' | …` branch calls `zodToTypeString(schema, indent)`
  on the same schema, which is infinite recursion. `zod` is peer `^4`, so **delete the
  Zod 3 branch** rather than fixing it.
- Missing Zod 4 types: `tuple`, `intersection`, `pipe`/`transform`, `lazy`, `bigint`,
  `nullable` (in `zodToExample`), `catch`, `readonly`, `set`, `map`, `promise`, and
  literal arrays (`def.values` for literals in v4).
- Consider using Zod 4's built-in `z.toJSONSchema()` as the source of truth and rendering
  types/examples from the JSON Schema. It would be less code and would cover every type.

### 5. `cool-console-log` crashes outside Node/Bun
Every function reads `process.env.NODE_ENV` directly, which throws `ReferenceError` in
browsers, Workers, and React Native.
- Reuse the `typeof process === 'undefined'` guard from `src/secrets/environment.ts`
  (`getProcessEnvironment`), in one shared `isDev()` helper.
- Respect `NO_COLOR` / `FORCE_COLOR` and `process.stdout.isTTY` when deciding whether to
  use colors.

### 6. `sitemap` timer leaks and a shared abort budget
- `createTimeoutController` sets a `setTimeout` that is never cleared, so each fetch keeps
  the process alive for up to `timeout` ms. Replace it with the standard
  `AbortSignal.timeout(ms)`.
- `discoverSitemaps` creates **one** 5s signal and shares it across robots.txt plus all 5
  HEAD probes, so the total discovery budget is 5s, not 5s per request.
- `/Sitemap: (.*)/gi` requires a space after the colon. Use `/^\s*sitemap:\s*(\S+)/gim`.
- `<loc>` values aren't XML-entity decoded (`&amp;` stays in the URLs).

---

## P1 — Make existing helpers more general

### array (`src/array/index.ts`)
- `findArrayDifferenceByKey`: the `findIndex` + `splice` loop is O(n·m). Track matched keys
  in a `Set` and filter `current` once. Accept a key function as well as a key name (same
  overload pattern as `groupBy`/`keyBy`). Optionally return `unchanged` separately from
  `upsert` via an `isEqual` callback.
- `getUniqueValues`: `JSON.stringify` depends on key order (`{a,b}` ≠ `{b,a}`). Reuse
  `sortJsonValue` from `src/string` (already written for `generateId`). Export it as
  `stableStringify`.
- `getUniqueValuesByKey`: accept a key function too (for consistency with `groupBy`/`keyBy`).
- `groupBy`: returns `Record<K, T[]>`, but not every key is present. Consider typing the
  result as `Partial<Record<K, T[]>>`, or note that the stdlib `Object.groupBy` exists and
  keep this only for the literal-key typing.
- Candidates that fit alongside these (add only when a caller needs them): `sumBy`,
  `sortBy` (multi-key, asc/desc), `range`, `zip`, `countBy`.

### string (`src/string/index.ts`)
- `extractNumber`: `'1.234,56 kr'` → `1.234` and `'2024-01-05'` → `2024`. Add
  `{ decimalSeparator: '.' | ',' }` and strip the thousands separator accordingly. Only
  keep a leading `-`.
- `generateId`: it's a 32-bit non-crypto hash (collision-prone above ~10k inputs), and its
  string branch calls `decodeURIComponent`, which **throws** on malformed `%`. Wrap it in
  try/fallback, and document it as a "stable hash key", not an ID. Offer an async
  `sha256Id` via `crypto.subtle` for collision-sensitive uses (jwt already wraps subtle).
- `slugify`: rebuilds a 70-branch RegExp on every call. Use
  `normalize('NFKD').replace(/\p{M}/gu, '')` plus a small map for letters that don't
  decompose (`æ ø œ ß đ ł`). Add options `{ separator = '-', lowercase = true, maxLength }`.
- Export `stableStringify` (see array).

### promise (`src/promise/index.ts`)
- `tryCatch` only accepts a promise, so a sync throw inside the expression that creates
  the promise escapes. Accept `Promise<T> | (() => T | Promise<T>)`.
- `isSuccess`/`isFailure` use `error === null`, so `throw null` is reported as success.
  Add a discriminant (`ok: true | false`) to `Result`. This is breaking, so ship it with
  the P0 major bump.
- `promiseTimeout` is just `sleep`. Add an optional `signal`, and reuse it in
  `api-wrapper/transport.ts` (`delay()` there is a duplicate).
- New, generalized from existing internals:
  - `withTimeout(promise, ms, { signal })`: the pattern already exists in
    `secrets/deadline.ts` and in the api-wrapper transport.
  - `retry(fn, { retries, delayMs | (attempt) => ms, shouldRetry, signal })`: extract
    from `api-wrapper/transport.ts` so it can be used outside HTTP.
  - `pMap(items, fn, { concurrency })`: a thin wrapper over `PQueue.addAll`.

### cache (`src/cache/index.ts`)
- No size bound: the in-memory `Map` grows without limit between sweeps. Add
  `maxEntries` with LRU eviction (use Map insertion order: delete and re-set on hit).
- Cache keys use `JSON.stringify(args)`, which is key-order sensitive and breaks on
  `Date`/`Map`/`BigInt`/`undefined`. Use `stableStringify`.
- Only `clearCache()` exists. Add `invalidate(...args)` and `peek(...args)`.
- `store` support is async-only, and the sync/async paths duplicate the
  fetch/refresh/dedupe logic (`fetchAndPopulate`, `startBackgroundRefresh`,
  `callWithStore`). Fold the in-memory Map into a built-in `CacheStore` and keep one code
  path.
- `api-wrapper/actions-impl.ts#createActionCache` is a second get-or-compute cache with
  TTL and in-flight dedupe. Export a small generic `createCache()` (get/set/invalidate/
  clear + `getOrSet(key, fn, { ttlMs })`) and have both `cacheFunction` and the action
  cache use it.

### state (`src/state/index.ts`)
- `executeAction` returns `newState` but never updates `item[stateKey]`, so
  `getCurrentStatus()` is stale afterwards. Add an opt-in `applyTransition: true` or an
  `onTransition(context, from, to, action)` hook (where callers persist the new state).
- `getInitialState()` returns the first object key, which is fragile. Make `initialState`
  an explicit config field.
- Validators are keyed only by target state. Add per-action validators
  (`actionValidators?: Partial<Record<TAction, ValidatorFn>>`). The `action` argument is
  already threaded through.
- `getAvailableActions` / `getPossibleTransitions` await validators sequentially. Use
  `Promise.all` when validators are independent.
- Add `canExecute(action)` as sugar for UIs.
- The machine is bound to one `item`. Consider `createStateMachine(config)` returning
  `.for(item, stateKey)`, so the config is defined once and reused per entity.

### typedswitch (`src/typedswitch/index.ts`)
- The object mode only supports `string` discriminants. Allow `number | boolean`
  discriminants (common with status codes / flags) by using `String(value)` as the case
  key.
- Collapse the 12 overloads. The 4 "with constraint" overloads can probably be expressed
  as `satisfies` on the cases object and removed, which cuts ~80 lines of types.
- Add `assertNever(value): never` as a standalone export for regular `switch` statements.

### date (`src/date/index.ts`)
- `getPreviousReportPeriod` only goes one period back and only supports
  MONTHLY/QUARTERLY/YEARLY. Generalize it to
  `getPeriod(type, referenceDate, offset = 0)` with `WEEKLY` (ISO weeks) and `DAILY`, and
  keep `getPreviousReportPeriod` as `getPeriod(type, d, -1)`.
- `end` is midnight at the start of the last day, which is inclusive only for date-only
  comparisons. Document this, or return an exclusive `end`.
- All maths uses the local timezone. Add a `{ utc: true }` option for server use.
- `formatPeriodLabel` hardcodes `'en-GB'` and the `—` separator. Accept
  `{ locale, separator, includeDay }` and use `Intl.DateTimeFormat#formatRange`
  (stdlib; it collapses "Jan 2026 – Mar 2026" → "Jan – Mar 2026").
- Candidate: `addPeriod(date, type, n)`, which `getPeriod` needs internally anyway.

### url (`src/url/index.ts`)
- The module only has `getDomainFaviconUrl`. The api-wrapper already has URL/query logic
  in `src/api-wrapper/builders.ts` (`formatQueryString`, `replacePathParams`, `buildUrl`).
  Extract generic versions here:
  - `buildQueryString(params)`: supports arrays (`?a=1&a=2`, which currently becomes
    `a=1,2` via `String()`), and skips `undefined`/`null`.
  - `buildUrl(base, path, { params, query })`: `:param` substitution plus query.
  - `normalizeDomain(input)`: `sitemap` has its own ad-hoc version (strip the trailing
    slash, add `https://`).
- `getDomainFaviconUrl` should accept a full URL (extract the hostname via `new URL`).

### math → split into `math` + `color`
- `metricsSeriesColors.ts` is color logic tied to one app's palette size
  (`METRICS_SERIES_PALETTE_SIZE = 10`, with "PrimeVue"/"Expo" comments). Move it to
  `src/color/` and make `paletteSize` a parameter (default 10) on
  `hashStringToColorIndex`, `resolveSeriesColorMap` and `createResolveColorsByKeys`.
- `withAlpha` doesn't handle `#rrggbbaa`, `#rgba`, `hsl()`/`hsla()`, space-separated
  `rgb(1 2 3)`, or CSS variables. Supporting modern syntax with
  `color-mix(in srgb, ${color} ${alpha*100}%, transparent)` covers all of them in one line
  for web targets. Keep the hex branch for React Native.
- `clamp` is private in the color file. Export it from `math` along with `lerp` and
  `normalize(value, min, max)` (already computed inline in `getHeatmapCellStyle`).
- `linearRegressionTrend`: also return `{ slope, intercept, r2 }` (the values are already
  computed), so callers can show the trend direction or strength without recomputing.

### zod (`src/zod/`)
- `jsonToZodSchemaMapper`: for nested objects it passes the *field mapper function* as the
  nested config, so nested fields can't be configured. Allow
  `config[key]` to be either a mapper fn or a nested config object. Also support arrays of
  objects.
- `zodMinMaxFilter` / `toGteLteFilter`: generalize to dates
  (`zodMinMaxFilter(z.date())`), and add `gt`/`lt` (exclusive) variants.
- `normalizeSingleOrArray` isn't Zod-specific. Move it to `array` as `toArray` (it's used
  by non-Zod code too).
- `createZId`: accept an optional prefix check (`createZId('User', { prefix: 'usr_' })`).

### jwt (`src/jwt/index.ts`)
- `jwtSign` has no expiry option, so callers have to compute `exp` themselves. Add
  `{ expiresIn, notBefore, issuer, audience }`.
- `jwtVerify` returns `null` for every failure. Add `jwtVerifyResult` returning
  `Result<Payload, 'malformed' | 'signature' | 'expired' | 'not_before' | …>` (reuse
  `Result` from promise), and add `{ leewaySec, issuer, audience }` checks.
- Add `jwtDecode(token)` (unverified, for reading claims client-side).
- The header lacks `typ: 'JWT'`. Consider `HS384`/`HS512`, which is a one-line change of
  the hash name.
- `getKey` re-imports the CryptoKey on every call. Memoize it per secret.

### sitemap (`src/sitemap/index.ts`)
Beyond the P0 fixes:
- Hardcoded `console.warn` → `onError?: (url, error) => void` / `logger` option.
- `fetch` injection (`options.fetch`), like api-wrapper, for testing and proxies.
- `filterIndexes` is a single substring. Accept `string | RegExp | (url) => boolean`, and
  add `filterUrls` for leaf URLs.
- The `isXmlSitemap` heuristic treats any URL containing "sitemap" as a sitemap. Decide
  from the response root element instead (`<sitemapindex>` vs `<urlset>`).
- Return `{ loc, lastmod? }[]` via an option, since `lastmod` is the main reason to crawl
  sitemaps incrementally.
- Support gzipped sitemaps (`.xml.gz`) with the standard `DecompressionStream`.
- Add `maxUrls` as an early stop.

### api-wrapper (`src/api-wrapper/`)
- The default retry delay is a fixed 300ms. Default to exponential backoff with jitter
  (`min(maxRetryDelayMs, 300 * 2^attempt) * random`).
- Add a first-class pagination helper, since the README asks every consumer to hand-write
  `getAllPages`: `paginate(fetchPage, { getNext })` returning an async iterator.
- Query params with array values are stringified as `a,b`. Use the shared
  `buildQueryString` (see url).
- The `delay()` duplicate becomes `promiseTimeout(ms, { signal })` from promise.

### cool-console-log (`src/cool-console-log/index.ts`)
Beyond the P0 fix:
- Add a `level` threshold option (`minLevel: 'info'`) instead of the hardcoded "skip
  debug in prod".
- Allow nested/`unknown` attribute values (`LogAttributes` is primitives only), and
  stringify objects compactly.
- Add `logger.child({ ...attributes })` for request-scoped context.
- Add a `time(label)` helper returning a `done(success?)` fn that calls
  `logOperationSummary`, which removes the `performance.now()` boilerplate from the doc
  example.
- `CoolLogger` should be assignable to api-wrapper's `logger` option. Add a type test for
  that.

### secrets
Already the most mature module (own README, runtime verification script). No
generalization needed. The only item is to keep it off the root barrel (P0 #3).

---

## P2 — Housekeeping

- **Tests missing** for `cool-console-log`, `zod/zodToTypeString`,
  `zod/jsonToZodSchemaMapper` and `sitemap` discovery (only the crawler is tested). Add
  them with the P0 fixes above so the bugs stay fixed.
- **README drift**: after P0, regenerate the "Imports" section from `package.json#exports`
  so the two can't drift again.
- **Naming consistency**: `getUniqueValues` vs `compact`/`keyBy` style. Consider aliases
  `uniq`/`uniqBy` in the next major.
- **`src/api-wrapper/README.md`** is written as an AI-agent guide (frontmatter + "The user
  will typically provide…"). Split it into user docs plus a separate `AGENTS.md`/skill
  file.

---

## Suggested order

1. P0 #1–#3 together as one major release (exports, root barrel, `Result` discriminant).
2. P0 #4–#6 as patch fixes (they can ship before the major).
3. Shared primitives that other helpers depend on: `stableStringify`, `retry`,
   `withTimeout`, `buildQueryString`, `createCache`, `clamp`.
4. Per-module P1 items, each as its own PR.

---

# Phase 2: helpers from lullu (researched 2026-09-28)

> **Status (2026-09-28): Tiers 1–3 implemented.** New root modules `error`,
> `guard`, `object`, `types`, `function`, `emitter`; additions to string, url,
> promise, cache, color, zod and sitemap; new subpaths `hanzio/format`,
> `hanzio/crypto`, `hanzio/storage`, `hanzio/i18n`. The api-wrapper now uses the
> shared `anySignal` and `parseRetryAfter`, and the private `isObject` copies in
> jwt/zod use `isRecord`. `createSealer` output is compatible with lullu's
> `secret-json.ts` given lullu's salt/info. Not done: per-type ID prefixes in
> `createIdHelpers`, ordinal `pluralize`, RFC 9309 "5xx = disallow all".

lullu imports `hanzio` in ~363 files, but mostly for `typedSwitch` (~300 files).
It pins hanzio 1.2.0 (node_modules has 1.1.0) and has written its own copies of
helpers hanzio already has: `mapWithConcurrency` (= `pMap`, 14 files), 20
hand-rolled sleeps, ~15 retry loops, ~10 batch loops (= `chunkArray`), local
`withTimeout`, `stableStringify`, `slugify`, `countBy` and a whole sitemap
module. Part of the win is adoption after the 2.0 upgrade; ~45 import sites
move to subpaths.

## Tier 1: root helpers with the most call sites

| Helper | Evidence in lullu |
| --- | --- |
| `getErrorMessage(e)`, `toError(e)` | ~250 inline `e instanceof Error ? e.message : String(e)`, 13 `toError`, 12 `(e as Error).message`, 4 local copies |
| `must(value, msg)`, `invariant(cond, msg)` | 374 `if (!x) throw new Error`, 363 `if (!x) throw new ORPCError`, ~169 index `!` assertions |
| `isRecord(v)` | 9 local copies under 5 names, 41 `as Record<string, unknown>` |
| `truncate(text, max, opts)`, `normalizeWhitespace(text)` | 13 local truncate fns + 22 inline (inconsistent: some output max+1 chars), 48 `replace(/\s+/g, ' ')` |
| `safeJsonParse(raw)` (root), `parseJson(raw, schema)` (zod) | 42 try/catch `JSON.parse`, 13 unvalidated casts; hanzio has a private `tryParseJson` |
| `isOneOf(list, v)`, `hasKey(obj, k)` | 16 `as keyof typeof`, 7 `(ARR as readonly string[]).includes`, ~23 hand-written guards |
| `typedKeys`, `typedEntries`, `recordFromKeys` | 11 `Object.keys as`, ~10 `Object.fromEntries as Record` |
| `anySignal(...)`, `timeoutSignal(ms, signal)`, `raceAbort(promise, signal)` | local helpers in 16 + 8 files, 15 inline `AbortSignal.any`; hanzio has a private `mergeSignals` |
| `parseRetryAfter(value)` | local copy; hanzio has it privately in api-wrapper |
| `startTimer()` / `timed(fn)` | 39 files measure `performance.now() - start` by hand |
| `isTruthy`, `isDefined` | 38 hand-written `(x): x is string => Boolean(x)` guards |
| Types: `MaybePromise`, `ValueOf`, `ElementOf`; `nonEmpty(arr)` | `MaybePromise` defined 3×, `GlobalToolId` value-of defined 3×, 6 `as [T, ...T[]]` for `z.enum` |
| `ok(data)`, `err(error)` | 13 hand-rolled `{ ok: false; reason }` unions |

## Tier 2: shared between platform and expo

- `debounce`, `keyedDebounce` (2 identical `Map<key, timeout>` copies).
- `createLatestGuard()` for stale async results (1 helper + 6 ad-hoc counters).
- `createEmitter<Events>()` (5 ad-hoc listener sets).
- `exponentialBackoff`: add partial-jitter and injectable `random` (2 identical `reconnect-delay.ts` files).
- `createHeartbeat` (generalize `createTypingSignalEngine` from support-protocol).
- Color: `parseColor`, `relativeLuminance`, `contrastText`, `shade` (3 copies incl. a private `withAlpha`).
- `pickFromPalette(seed, palette)` (2 copies; reuse `hashStringToColorIndex`).
- `matchesSearch(query, ...fields)`: accent/case-insensitive (13 inline `.toLowerCase().includes()`).
- `escapeRegExp`, `trimTrailingSlash`, `buildMailto`.
- `getAtPath` / `setAtPath`.

## Tier 3: new modules

- **`hanzio/format`**: `formatDuration` (7 implementations), cached `getNumberFormat`/`getDateTimeFormat` (3 hand-rolled caches, 1 uncached hot path), `formatBytes`, `formatCurrency`, `formatRelativeTime`, `initials`, `formatCappedCount` ("99+", 4 copies). Move from `packages/utils` with BCP-47 locales instead of `UiLocale`.
- **`hanzio/crypto`** (Web Crypto, next to jwt): `safeEqual` (identical copies in 3 apps), `hmacSign`/`verifyHmacSignature` (Meta, Svix-style webhooks), `createSealer` (AES-GCM envelope from `secret-json.ts`), `randomToken`, and export jwt's base64url helpers.
- **`hanzio/zod`**: `createIdHelpers()` → `{ zId, asId, parseId, safeParseId }` (duplicated in backend + support-protocol, lullu re-implements `createZId`), `zJsonValue`, introspection (`getEnumValues`, `unwrapZodType` from `zodIntrospect.ts`), `zodDefaults(schema)`.
- **`hanzio/storage`**: `createStorageItem({ key, schema, fallback, storage })` with sync/async adapters (~15 hand-rolled read/parse/default pairs across platform + expo).
- **`hanzio/i18n`**: `extractPlaceholders`, `interpolatePlaceholders`, a type that extracts `{name}` params from a string literal.
- **`hanzio/sitemap`**: robots `Allow`/`Disallow` evaluation, so lullu can drop its own ~300-line crawler.
- `createCache`: `staleMarginMs` for token caches (7 hand-rolled TTL caches).

## Leave in lullu / skip

Domain modules (data-entity, queue, message, posthog, mastra, ai), the Redis
concurrency limiter (large, needs injected logger/metrics), the Node-only SSRF
guard and sync `sha256Hex`, `partialMock` (tests only), and utility types lullu
doesn't use (DeepPartial, Prettify, ...).

## Bugs found in lullu while researching

- `apps/platform/src/composables/formStateFromSchema.ts` reads enum options from `_def.options`; on zod v4 they're in `_def.entries`, so enum defaults are empty.
- `apps/platform/src/routes/_app/system/message.vue:425` calls `btoa(payloadJson.value)`, which throws on any non-Latin-1 character (æøå).
- `apps/platform/.../usage-display.ts:25` fills a date input with `toISOString().slice(0, 10)` (UTC), off by one day around midnight in Denmark.
- Truncation helpers disagree on length (`available-variables.ts:255` and `journeyCreate.vue:206` emit max+1 chars).
