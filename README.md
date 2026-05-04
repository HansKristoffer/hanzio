# hanzio

A small TypeScript-first utility library for common application code: arrays,
strings, promises, caching, state machines, dates, URLs, Zod helpers, API clients,
JWTs, gzip, sitemap crawling, queues, secrets, and colorful terminal logging.

## Install

```bash
bun add hanzio
```

The package is ESM and Bun-friendly. Bun consumers resolve the `bun` export to
the source TypeScript files, while Node/bundler consumers resolve built files
from `dist`.

## Imports

Most lightweight utilities are available from the root export:

```ts
import { groupBy, typedSwitch, tryCatch } from 'hanzio'
```

Heavier or dependency-specific modules are also available as subpath exports:

```ts
import { createZId } from 'hanzio/zod'
import { jwtSign } from 'hanzio/jwt'
import { compressString } from 'hanzio/gzip'
import { getDomainSitemap } from 'hanzio/sitemap'
import PQueue from 'hanzio/p-queue'
import { createCoolLogger } from 'hanzio/cool-console-log'
```

The package currently publishes `src/**/*.ts` intentionally so Bun can consume
the source entrypoints directly. Tests are excluded from the published package.

## Utilities

### Array

`chunkArray` splits a readonly array into fixed-size chunks.

```ts
import { chunkArray } from 'hanzio'

const pages = chunkArray([1, 2, 3, 4, 5], 2)
// [[1, 2], [3, 4], [5]]
```

`findArrayDifferenceByKey` compares two arrays by a shared key and returns
`new`, `upsert`, and `delete` groups.

```ts
import { findArrayDifferenceByKey } from 'hanzio'

const diff = findArrayDifferenceByKey(
	[{ id: 1, name: 'old' }],
	[{ id: 1, name: 'new' }, { id: 2, name: 'added' }],
	'id'
)
```

`getUniqueValues` keeps the first unique serialized value.

```ts
import { getUniqueValues } from 'hanzio'

const values = getUniqueValues([{ id: 1 }, { id: 1 }, { id: 2 }])
// [{ id: 1 }, { id: 2 }]
```

`compact` removes `null` and `undefined` while narrowing the returned type.

```ts
import { compact } from 'hanzio'

const names = compact(['Ada', null, 'Grace', undefined])
// string[]
```

`getUniqueValuesByKey` keeps the first item for each key value.

```ts
import { getUniqueValuesByKey } from 'hanzio'

const users = getUniqueValuesByKey(
	[{ id: 'a', role: 'admin' }, { id: 'a', role: 'user' }],
	'id'
)
```

`groupBy` groups items by a property or callback and preserves literal key unions
when possible.

```ts
import { groupBy } from 'hanzio'

const byType = groupBy(
	[
		{ type: 'fruit', name: 'apple' },
		{ type: 'veg', name: 'carrot' }
	] as const,
	'type'
)
```

`keyBy` indexes items by a property or callback.

```ts
import { keyBy } from 'hanzio'

const byId = keyBy([{ id: 'user_1', name: 'Ada' }], 'id')
// { user_1: { id: 'user_1', name: 'Ada' } }
```

`partition` splits an array into matched and unmatched items.

```ts
import { partition } from 'hanzio'

const [even, odd] = partition([1, 2, 3, 4], (value) => value % 2 === 0)
```

`pickItemsInArray` filters by a key and narrows discriminated unions for const
value lists.

```ts
import { pickItemsInArray } from 'hanzio'

type Item = { type: 'user'; name: string } | { type: 'team'; members: number }
const users = pickItemsInArray([] as Item[], 'type', ['user'] as const)
// Array<{ type: 'user'; name: string }>
```

### String

`extractNumber` parses the first number-like value from a string.

```ts
import { extractNumber } from 'hanzio'

const amount = extractNumber('Total: 123.45 kr')
// 123.45
```

`generateId` creates a stable short ID from JSON-like input.

```ts
import { generateId } from 'hanzio'

const id = generateId({ page: 1, filters: ['active'] })
```

`slugify` normalizes text for URL slugs.

```ts
import { slugify } from 'hanzio'

const slug = slugify('Hello, København!')
// "hello-kobenhavn"
```

### Promise

`tryCatch` converts a promise into a `Result<T, E>` object.

```ts
import { tryCatch } from 'hanzio'

const result = await tryCatch(fetch('/api/users'))
```

`isSuccess`, `isFailure`, and `unwrapResult` help narrow and consume
`Result<T, E>`.

```ts
import { isSuccess, unwrapResult } from 'hanzio'

if (isSuccess(result)) {
	result.data
}

const response = unwrapResult(result)
```

`backgroundPromise` runs async work and reports success or failure through hooks.

```ts
import { backgroundPromise } from 'hanzio'

backgroundPromise(() => syncAnalytics(), {
	onError: (error) => console.error(error)
})
```

`backgroundPromiseSync` schedules background work in a microtask by default.

```ts
import { backgroundPromiseSync } from 'hanzio'

backgroundPromiseSync(() => refreshCache())
```

`promiseTimeout` resolves after a delay.

```ts
import { promiseTimeout } from 'hanzio'

await promiseTimeout(250)
```

### Secrets

`defineSecretSet` loads a typed set of required secrets from `process.env` or
Infisical before the rest of the program starts.

```ts
import { defineSecretSet } from 'hanzio'

export const backendSecrets = await defineSecretSet(
	['DATABASE_URL', 'APP_SECRET'] as const,
	{ projectId: 'infisical-project-id' }
)

const databaseUrl = backendSecrets.secret('DATABASE_URL')
```

For Vite config, `viteSecretSetPlugin(secretSet)` exposes the loaded values as
`import.meta.env.*` replacements. Use `getViteDefine(secretSet)` if you need the
raw `define` object.

### Cache

`cacheFunction` wraps sync or async functions with TTL caching and request
deduplication.

```ts
import { cacheFunction } from 'hanzio'

const getUser = cacheFunction({
	name: 'getUser',
	fn: async (id: string) => ({ id, name: 'Ada' }),
	cacheTimeMs: 60_000
})

const user = await getUser('user_1')
getUser.clearCache()
```

### State Machine

`SimpleStateMachine` models typed states, actions, validation, and action
payloads.

```ts
import { SimpleStateMachine } from 'hanzio'

type State = 'draft' | 'published'
type Action = 'publish'

const machine = new SimpleStateMachine<
	State,
	Action,
	{ status: State },
	{ publish: { notify: boolean } }
>(
	{
		stateActionMap: { draft: { publish: 'published' }, published: {} },
		stateTransitions: { draft: ['published'], published: [] }
	},
	{ status: 'draft' },
	'status'
)

const result = await machine.executeAction('publish', { notify: true })
```

### typedSwitch

`typedSwitch` is an exhaustive switch helper for string unions and discriminated
unions.

```ts
import { typedSwitch } from 'hanzio'

type Event =
	| { type: 'click'; x: number; y: number }
	| { type: 'scroll'; offset: number }

const label = typedSwitch({ type: 'click', x: 10, y: 20 } as Event, 'type', {
	click: (event) => `Clicked ${event.x},${event.y}`,
	scroll: (event) => `Scrolled ${event.offset}`
})
```

### Date

`getPreviousReportPeriod` returns the previous monthly, quarterly, or yearly
date range.

```ts
import { getPreviousReportPeriod } from 'hanzio'

const previousMonth = getPreviousReportPeriod('MONTHLY', new Date('2026-04-15'))
```

`formatPeriodLabel` formats a date range for display.

```ts
import { formatPeriodLabel } from 'hanzio'

const label = formatPeriodLabel('2026-01-01', '2026-03-31')
```

### URL

`getDomainFaviconUrl` builds a Google favicon URL for a domain.

```ts
import { getDomainFaviconUrl } from 'hanzio'

const favicon = getDomainFaviconUrl('example.com', 64)
```

### Math

`linearRegressionTrend` returns fitted trend values for a numeric series.

```ts
import { linearRegressionTrend } from 'hanzio'

const trend = linearRegressionTrend([1, 3, 5])
// [1, 3, 5]
```

`hashStringToColorIndex`, `seriesColorKey`, `resolveSeriesColorMap`,
`createResolveColorsByKeys`, `withAlpha`, and `getHeatmapCellStyle` help assign
stable chart colors and heatmap styles.

```ts
import { createResolveColorsByKeys, withAlpha } from 'hanzio'

const colors = createResolveColorsByKeys(
	['revenue', 'profit'],
	(index) => ['#2563eb', '#16a34a'][index] ?? '#64748b',
	(index) => ['#1d4ed8', '#15803d'][index] ?? '#475569'
)
const faded = withAlpha('#2563eb', 0.4)
```

### Zod

`createZId` and `GenericId` create branded string ID schemas.

```ts
import { createZId, type GenericId } from 'hanzio/zod'

const UserId = createZId('User')
type UserId = GenericId<'User'>

const userId: UserId = UserId.parse('user_123')
```

`zSingleOrArray` accepts either one schema value or an array of schema values.

```ts
import { zSingleOrArray } from 'hanzio/zod'
import { z } from 'zod'

const Tags = zSingleOrArray(z.string())
Tags.parse('news')
Tags.parse(['news', 'product'])
```

`normalizeSingleOrArray` normalizes nullable single-or-array inputs to an array.

```ts
import { normalizeSingleOrArray } from 'hanzio/zod'

const values = normalizeSingleOrArray('tag')
// ['tag']
```

`zodMinMaxFilter` and `toGteLteFilter` model common min/max filters.

```ts
import { toGteLteFilter, zodMinMaxFilter } from 'hanzio/zod'

const filter = zodMinMaxFilter.parse({ min: 10, max: 20 })
const query = toGteLteFilter(filter)
// { gte: 10, lte: 20 }
```

`jsonToZodSchemaMapper` maps raw JSON into a Zod schema shape with optional field
mapping.

```ts
import { jsonToZodSchemaMapper } from 'hanzio/zod'
import { z } from 'zod'

const User = z.object({ id: z.string(), name: z.string() })
const user = jsonToZodSchemaMapper({ user_id: '1', name: 'Ada' }, User, {
	id: (json) => json.user_id
})
```

`zodToTypeString` and `zodToExample` render simple documentation artifacts from
Zod schemas.

```ts
import { zodToExample, zodToTypeString } from 'hanzio/zod'
import { z } from 'zod'

const schema = z.object({ id: z.string() })
const typeString = zodToTypeString(schema)
const example = zodToExample(schema)
```

### API Wrapper

`createApiClient` and `createApiWrapper` create a Zod-backed API client with
typed request inputs and response data.

```ts
import { createApiClient } from 'hanzio/api-wrapper'
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

const result = await api.request('getUser', { reqParams: { id: 1 } })
```

`ResponseValidationError` and `HttpResponseError` are thrown for invalid
responses and non-OK HTTP statuses.

```ts
import { HttpResponseError, ResponseValidationError } from 'hanzio/api-wrapper'

try {
	await api.request('getUser', { reqParams: { id: 1 } })
} catch (error) {
	if (error instanceof ResponseValidationError) {
		console.error(error.validationIssues)
	}
	if (error instanceof HttpResponseError) console.error(error.status)
}
```

### JWT

`jwtSign` signs a payload with HS256, and `jwtVerify` verifies a token or returns
`null`.

```ts
import { jwtSign, jwtVerify } from 'hanzio/jwt'

const token = await jwtSign({ sub: 'user_1' }, 'secret')
const payload = await jwtVerify<{ sub: string }>(token, 'secret')
```

### Gzip

`compressString` and `decompressString` gzip roundtrip strings as base64.

```ts
import { compressString, decompressString } from 'hanzio/gzip'

const compressed = compressString('hello')
const text = decompressString(compressed)
```

### Sitemap

`getDomainSitemap` discovers and crawls sitemap URLs for a domain.

```ts
import { getDomainSitemap } from 'hanzio/sitemap'

const urls = await getDomainSitemap('example.com', {
	concurrency: 5,
	maxDepth: 3
})
```

### PQueue

`PQueue` runs promise-returning tasks with concurrency, priority, timeout, abort,
and rate-limit controls.

```ts
import PQueue from 'hanzio/p-queue'

const queue = new PQueue({ concurrency: 2 })

const result = await queue.add(async () => 'done')
await queue.onIdle()
```

`PriorityQueue` and `TimeoutError` are exported for custom queue behavior and
timeout handling.

```ts
import PQueue, { TimeoutError } from 'hanzio/p-queue'

try {
	await new PQueue({ timeout: 100 }).add(() => new Promise(() => {}))
} catch (error) {
	if (error instanceof TimeoutError) console.error('Task timed out')
}
```

### Cool console log

ANSI-colored logging for terminals. Exports include `terminalColors`, `createCoolLogger`,
`logOperationSummary`, `colorize`, and `logBanner`. By default colors and banners are
development-only (`NODE_ENV !== 'production'`); loggers honor `colorsInDevOnly`
and callbacks via `CoolLoggerOptions.onLog`.

```ts
import {
	createCoolLogger,
	colorize,
	logBanner,
	logOperationSummary,
	terminalColors
} from 'hanzio'

const log = createCoolLogger()
log.info('User logged in', { userId: '123' })
log.warn('Rate limit approaching', { remaining: 10 })

const start = performance.now()
await doSomething()
logOperationSummary('user.create', performance.now() - start, true)

console.log(colorize('OK', 'brightGreen'))
logBanner('Server started', 'cyan')
```

## Development

```bash
bun run typecheck
bun test
bun run lint
bun run build
```
