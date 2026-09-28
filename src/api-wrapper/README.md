# hanzio/api-wrapper

Typed HTTP clients from Zod schemas: `createApiClient` validates requests and
responses, retries with exponential backoff, and throws structured errors.

Building a new wrapper with an AI agent? See [AGENTS.md](./AGENTS.md) for the
step-by-step workflow and folder conventions.

## Quick Start

```ts
import { createApiClient, defineEndpoint } from 'hanzio/api-wrapper'
import { z } from 'zod'

const usersGet = defineEndpoint({
	method: 'GET',
	path: '/users/:userId',
	resSchema: z.object({ id: z.number(), name: z.string(), email: z.string() })
})

export const exampleApi = createApiClient({
	name: 'exampleApi',
	baseApiUrls: { default: 'https://api.example.com' },
	defaultHeaders: () => ({ Authorization: `Bearer ${getSecret('EXAMPLE_TOKEN')}` }),
	endpoints: { usersGet }
})
```

## Defining Endpoints

`defineEndpoint` infers everything from the definition:

- **Path params:** a literal `path` types its `:params`, so `reqParams` is
  required and checked even without a `reqParamsSchema`
  (`'/users/:userId'` → `{ userId: string | number }`).
- **Request types are schema inputs:** callers pass what the schema accepts
  (`z.input`), so fields with `.default()` are optional and
  `z.string().transform(Number)` takes a string. The response is the parsed
  output (`z.output`).
- **`resFormatter` is checked:** it must return what `resSchema` parses.

`satisfies ApiEndpoint` still works, but it widens `path` to `string` (so
params fall back to an optional `Record<string, string | number>`) and leaves
`resFormatter` unchecked.

Object and array bodies are sent as JSON unless you set another
`Content-Type`; `reqBodyFormat: 'form-data'` sends `FormData`.

## Calling Endpoints

`createApiClient` returns a client with both a generic `request` method and
per-endpoint methods (created via Proxy) for autocomplete.

```ts
await exampleApi.request('usersGet', { reqParams: { userId: 'u1' } })
await exampleApi.usersGet({ reqParams: { userId: 'u1' } })
```

When a schema is defined for `reqParams`, `reqBody`, `reqQuery`, or
`reqHeaders` (or the path has `:params`), the corresponding input field is
**required at the type level**. Endpoint and action names can't be `request`,
`cache` or `safe`; the client reserves them.

### Handling Errors Without try/catch

`api.safe` has the same endpoints and actions but resolves to a `Result`
instead of throwing `ApiError`s. Narrow on `error.category`. Other errors, such
as bugs in hooks or middleware, still throw.

```ts
const result = await exampleApi.safe.usersGet({ reqParams: { userId: 'u1' } })
if (!result.ok) {
	if (result.error.category === 'client_error') return null
	throw result.error
}
result.data.data // parsed response
```

### Type Helpers

```ts
import type {
	AnyApiClient,
	EndpointRequest,
	EndpointResponse,
	InferRequest,
	InferResponse
} from 'hanzio/api-wrapper'

type User = InferResponse<typeof exampleApi, 'usersGet'> // response data
type UsersGetInput = InferRequest<typeof exampleApi, 'usersGet'>
type Same = EndpointResponse<typeof usersGet> // from the endpoint definition
type Input = EndpointRequest<typeof usersGet>

// Helpers that take whichever client they're given:
async function ping(api: AnyApiClient) {
	return api.safe.health?.()
}
```

### Typed `meta`

`meta` is `Record<string, unknown>` by default. Augment `ApiRequestMeta` once
to type it on every call, action, hook, middleware and error context:

```ts
declare module 'hanzio/api-wrapper' {
	interface ApiRequestMeta {
		traceId: string
		tenantId?: string
	}
}

await exampleApi.usersGet({ reqParams: { userId: 'u1' }, meta: { traceId } })
```

### Query Parameters

`reqQuery` values may be strings, numbers, booleans, or arrays of those. Arrays
repeat the key, and `null`/`undefined` values are skipped:

```ts
await api.search({ reqQuery: { tag: ['a', 'b'], q: undefined } })
// GET /search?tag=a&tag=b
```

Values are URL-encoded unless the endpoint sets `doNotEncodeQueryParams: true`.
APIs that expect `tag=a,b` or `tag[]=a` need the value joined or the key renamed
in `reqQuery` before the call.

### Per-Call Overrides

Every `RequestInput` accepts these extra options:

| Option | Description |
| --- | --- |
| `signal` | `AbortSignal` to cancel the request from the caller. |
| `timeoutMs` | Override the client-level timeout for this call. |
| `retries` | Override the retry count for this call. |
| `fetch` | Override the fetch implementation for this call. |
| `meta` | Arbitrary metadata forwarded to hooks and error context. |
| `url` | Bypass `baseApiUrls`/`path` and call this absolute URL. |

```ts
const controller = new AbortController()
const result = await api.usersGet({
	reqParams: { userId: 'u1' },
	signal: controller.signal,
	timeoutMs: 5000,
	retries: 0,
	meta: { traceId: 'abc-123' }
})
```

### Response Shape

```ts
type ApiWrapperResponse<T> = {
	data: T              // validated response body
	httpStatus: number
	retryCount: number
	responseTimeMs: number
	responseSizeMb: number
	requestBodySizeMb: number
}
```

## Client Configuration

In addition to `baseApiUrls`, `defaultHeaders`, and `endpoints`, `createApiClient`
accepts:

| Option | Description |
| --- | --- |
| `name` | Prefix used in error/log context, e.g. `exampleApi.usersGet`. |
| `defaultHeaders` | Static headers, or a (sync or async) function resolved on every request, e.g. `() => ({ Authorization: \`Bearer ${getSecret('TOKEN')}\` })`. |
| `defaultBaseApiUrl` | Key in `baseApiUrls` to use when an endpoint doesn't specify one. |
| `timeoutMs` | Default per-request timeout (uses `AbortController`). Applied **per attempt** — each retry gets its own timeout window, not a cumulative budget across retries. |
| `retries` | Default retry count (default `3`). |
| `retryDelayMs` | Delay between retries. `number \| (attempt) => number`, where `attempt` is `0` before the first retry. Default: exponential backoff with full jitter, a random delay in `[0, 300 * 2^attempt]` ms, capped at `maxRetryDelayMs`. |
| `maxRetryDelayMs` | Upper bound on retry delay (default `30000`). Caps the default backoff, `retryDelayMs`, and `Retry-After` headers on `429`/`503` responses. |
| `shouldRetry` | `(ctx) => boolean` to override the default retry policy. |
| `fetch` | Custom fetch implementation, typed as `FetchLike` (`(input, init?) => Promise<Response>`), so plain functions and mocks work without Bun's `preconnect`. |
| `use` | Middleware around each whole request (see [Middleware](#middleware)). |
| `checkResponse` | `(data, ctx) => void` run after `resSchema` validation on every attempt. Throw to reject a response that is an error in disguise (see [Rejecting 200 responses](#rejecting-200-responses)). |
| `logger` | `Pick<Console, 'debug' \| 'error'>`. Each failed request is logged once with a categorized summary (see [Debugging Failed Requests](#debugging-failed-requests)). |
| `onRequest` | Hook that runs once per request, before the first attempt. May return `{ headers, body }`; returned `headers` **replace** the outgoing headers, so spread `context.headers` to add one. For auth, prefer a `defaultHeaders` function. |
| `onResponse` | Hook that runs after each response is received (called per attempt). |
| `onRetry` | Hook called before each retry with `{ delayMs, nextAttempt, ... }`. |
| `onError` | Hook called when an `ApiError` is about to be thrown. |
| `redact` | Optional `(context: ApiErrorContext) => ApiErrorContext` applied before `logger` / `onError` and before errors store context. Built-in default redaction strips sensitive headers (`authorization`, `cookie`, `set-cookie`) and common secret-like body keys (`password`, `token`, `accessToken`, `refreshToken`, `secret`). Override wholly or layer on top of the default by copying fields you need from the incoming context. |

The default retry policy retries network errors and `5xx`/`429` responses, and
**does not retry** validation, abort, config, or `4xx` errors. `Retry-After`
headers on `429`/`503` are respected up to `maxRetryDelayMs`. Aborting the
caller's `signal` while waiting between retries throws `RequestAbortedError`
immediately.

### Middleware

`use` takes middleware that wraps one logical request: `onRequest`, every
retry attempt, validation and `checkResponse`. They run in array order (the
first is outermost), see the final `ApiWrapperResponse` (`httpStatus`,
`retryCount`, sizes, timing), and see thrown errors after redaction and
`onError`. Input validation and config errors (unknown endpoint, missing path
parameter) are thrown before middleware runs. Middleware applies to endpoint
calls made inside actions too.

```ts
import type { ApiMiddleware } from 'hanzio/api-wrapper'

const timing: ApiMiddleware = async (ctx, next) => {
	const result = await next()
	metrics.histogram('api.duration', result.responseTimeMs, {
		endpoint: `${ctx.client}.${ctx.endpoint}`,
		retries: result.retryCount
	})
	return result
}

const api = createApiClient({ name: 'stream', use: [timing], ...config })
```

`ctx` is `{ client?, endpoint, method, url, headers, meta? }`, where
`endpoint` is the endpoint key and `client` is the client's `name`. Mutating
`ctx.headers` before calling `next()` adds headers to the outgoing request.

### OpenTelemetry

`otelMiddleware` creates one CLIENT span per logical request (covering every
retry, validation and `checkResponse`), named `client.endpoint`, with the
standard HTTP attributes (`http.request.method`, `url.full`,
`server.address`, `http.response.status_code`, `http.request.resend_count`,
`error.type`) plus `api.error.category`. Failures get `recordException` and an
ERROR status. It's started as the active span, so auto-instrumented fetch
attempts become child spans.

hanzio does not depend on OpenTelemetry: `otelMiddleware` accepts any object
shaped like a tracer, and you pass your own `@opentelemetry/api` tracer.

```ts
import { context, propagation, trace } from '@opentelemetry/api'
import { createApiClient, otelMiddleware } from 'hanzio/api-wrapper'

const api = createApiClient({
	name: 'stream',
	use: [
		otelMiddleware(trace.getTracer('app'), {
			// Only needed when fetch isn't auto-instrumented:
			inject: (headers) => propagation.inject(context.active(), headers)
		})
	],
	...config
})
```

| Option | Description |
| --- | --- |
| `spanName` | `(ctx) => string`. Default `client.endpoint`. |
| `attributes` | `(ctx) => attributes` added when the span starts. |
| `includeQuery` | Default `true`: `url.full` keeps the query with sensitive values (`api_key`, `token`, `signature`, …) redacted. `false` drops the query string. |
| `inject` | Adds trace-context headers (`traceparent`) to the request. |

## Debugging Failed Requests

Every failed request is logged once through `logger.error(message, attributes)`
with a headline that says where it failed, the request line, and the details
needed to fix it:

```
✗ github.usersGet failed: output validation failed: the response doesn't match resSchema
  GET https://api.github.com/users/1 · attempt 1/4 · 212ms
  [1] age: Invalid input: expected number, received string
      (expected number, received string)
      value: "old"
  fix: update resSchema (or resFormatter), or mark changed fields optional

✗ github.usersGet failed: server error (HTTP 503): the API failed while handling the request
  GET https://api.github.com/users/1 · attempt 4/4 · 2381ms · request id req_42
  response: {"message":"Service Unavailable"}

✗ github.usersCreate failed: input validation failed: the caller's body doesn't match reqBodySchema (nothing was sent)
  POST /users · 1ms
  [1] email: Invalid email address
      value: "nope"
      …
```

| Category | Headline | Details |
| --- | --- | --- |
| `server_error` | `server error (HTTP 5xx): the API failed while handling the request` | response body, request id |
| `client_error` | `request rejected (HTTP 4xx): …` with a hint for 401/403, 404 and 429 | response body, request id |
| `input_validation` | `input validation failed: the caller's body doesn't match reqBodySchema (nothing was sent)` | each issue with path and value |
| `output_validation` | `output validation failed: the response doesn't match resSchema` (or `…is not valid JSON`) | each issue with path and value, fix hint |
| `response_rejected` | `response rejected by checkResponse: …` | response preview |
| `network` / `timeout` / `aborted` / `config` / `action` | what happened | cause for actions |

The attributes are flat and primitive (`category`, `endpoint`, `method`,
`url`, `status`, `attempt`, `maxRetries`, `elapsedMs`, `requestId`,
`issueCount`, `issues`, `target`, `timeoutMs`), so structured loggers can
filter on them. Every `ApiError` also has `error.category`, and
`describeApiError(error)` / `apiErrorLogAttributes(error)` are exported for
your own error handlers.

Logs never contain credentials. Sensitive headers and body keys are redacted
(see `redact`), and so are sensitive query parameters in URLs and error
messages. Debug logs (`API request`) only include the endpoint, method,
redacted URL and attempt number.

### Rejecting 200 responses

Some APIs return HTTP 200 with an error envelope (Cloudflare:
`{ success: false, errors }`). `checkResponse` runs after `resSchema`
validation on every attempt; anything it throws becomes an `ApiResponseError`
carrying the request context and the response `data`, and goes through
redaction and `onError` like any other error. It is not retried by default,
but a custom `shouldRetry` can opt in.

```ts
const api = createApiClient({
	...config,
	checkResponse: (data) => {
		const body = data as { success: boolean; errors?: { message: string }[] }
		if (!body.success) {
			throw new Error(body.errors?.map((e) => e.message).join(', '))
		}
	},
	shouldRetry: (ctx) =>
		isApiResponseError(ctx.error) || defaultShouldRetry(ctx)
})
```

## Testing

`hanzio/api-wrapper/testing` has a test-runner-agnostic fetch mock to pass as
the client's `fetch` option, so tests never replace `globalThis.fetch`.
`calls` records every `Request`, with bodies still readable.

```ts
import { createMockFetch, jsonResponse } from 'hanzio/api-wrapper/testing'

const fetch = createMockFetch((request, callIndex) =>
	request.url.endsWith('/users/1')
		? jsonResponse({ id: 1, name: 'Ada' })
		: jsonResponse({ error: 'not found' }, { status: 404 })
)
const api = createApiClient({ ...config, fetch })

await api.usersGet({ reqParams: { userId: '1' } })
expect(fetch.calls[0]?.headers.get('authorization')).toBe('Bearer token')
```

## Pagination

`paginate(fetchPage, getNext, { maxPages?, signal? })` is an async generator
that works with any cursor type. `fetchPage` receives `undefined` first, then
whatever `getNext` returned; iteration stops when `getNext` returns `null` or
`undefined`. Pages are fetched lazily, so `break` stops further requests.
`signal` is checked before each page (forward it to the request as well to
cancel the in-flight one).

```ts
import { paginate } from 'hanzio/api-wrapper'

// Cursor-based
for await (const res of paginate(
	(cursor?: string) => api.eventsList({ reqQuery: { cursor } }),
	(res) => res.data.next_cursor
)) {
	for (const event of res.data.items) handle(event)
}

// Page numbers, collected into one array
const pages = await Array.fromAsync(
	paginate(
		(page: number = 1) => api.usersList({ reqQuery: { page } }),
		(res) =>
			res.data.current_page < res.data.last_page
				? res.data.current_page + 1
				: null,
		{ maxPages: 50 }
	)
)
const users = pages.flatMap((res) => res.data.data)
```

## Errors

All errors thrown by the client extend `ApiError`, which carries an
`ApiErrorContext` with everything needed to diagnose the failure:

```ts
type ApiErrorContext = {
	endpoint: string       // e.g. "exampleApi.usersGet"
	method: HttpMethod
	url: string            // full URL with query string
	attempt: number
	maxRetries: number
	elapsedMs: number
	requestHeaders?: Record<string, string>
	requestBody?: unknown
	meta?: Record<string, unknown>
}
```

| Class | Thrown when |
| --- | --- |
| `HttpResponseError` | Response status >= 400. Exposes `status`, `body`, `bodyJson` (auto-parsed), `responseHeaders`, `requestId` (from `x-request-id`/`x-correlation-id`). |
| `ResponseValidationError` | Response failed `resSchema` validation, or `application/json` body wasn't valid JSON. Exposes `issues: FormattedZodIssue[]`, `rawResponse`. |
| `RequestValidationError` | Caller-supplied `reqBody`/`reqQuery`/`reqParams`/`reqHeaders` failed schema validation. Exposes `target`, `issues`, `rawInput`. |
| `RequestTimeoutError` | Internal `timeoutMs` exceeded. Exposes `timeoutMs`. |
| `RequestAbortedError` | The caller's `signal` aborted the request or the wait before a retry. |
| `NetworkError` | `fetch` itself threw (DNS, TCP, etc.). |
| `ConfigError` | Misconfiguration: unknown endpoint, missing base URL, missing path parameter, invalid action input, or plain-object body without JSON content type. |
| `ApiResponseError` | `checkResponse` rejected a response that passed validation. Exposes `data`; the original throw is the `cause`. |
| `ActionError` | A composite action handler threw a non-`ApiError`. Wraps the original cause. `ApiError` subclasses thrown inside actions propagate unchanged. |

Type guards are exported for all of them: `isApiError`, `isHttpResponseError`,
`isResponseValidationError`, `isRequestValidationError`,
`isRequestTimeoutError`, `isRequestAbortedError`, `isNetworkError`,
`isConfigError`, `isApiResponseError`, `isActionError`.

`isNonRetryableApiError` returns `true` for errors that the default retry
policy will not retry (`HttpResponseError`, `ResponseValidationError`,
`ApiResponseError`, `RequestValidationError`, `ConfigError`,
`RequestAbortedError`).

Every `ApiError` implements `toJSON()` so loggers (Sentry, Datadog) capture the
full structured payload, not just the message.

### Zod Validation Errors

`ResponseValidationError` and `RequestValidationError` produce multi-line
messages that point straight at the schema fix:

```
Response validation failed (GET https://api.example.com/things/1):
  [1] id: Expected number, received string
      (expected number, received string)
      value: "oops"
  [2] tags[1]: Expected string, received number
      value: 42
  [3] nested.count: Expected number, received string
      value: "not-a-number"
```

For programmatic handling, use the `issues` field:

```ts
try {
	await api.getThing({ reqParams: { id: 1 } })
} catch (err) {
	if (isResponseValidationError(err)) {
		for (const issue of err.issues) {
			// issue.path        -> "nested.count"
			// issue.expected    -> "number"
			// issue.received    -> "string"
			// issue.value       -> "not-a-number"
			// issue.valuePreview, issue.code, issue.message, issue.extra
		}
	}
}
```

### Example: handling errors

```ts
import {
	isHttpResponseError,
	isResponseValidationError,
	isRequestTimeoutError
} from 'hanzio/api-wrapper'

try {
	await api.usersGet({ reqParams: { userId: 'u1' } })
} catch (err) {
	if (isHttpResponseError(err)) {
		if (err.status === 404) return null
		console.error(err.status, err.bodyJson, err.requestId, err.context)
	} else if (isResponseValidationError(err)) {
		console.error('Schema drift:', err.issues, err.context)
	} else if (isRequestTimeoutError(err)) {
		console.error(`Timed out after ${err.timeoutMs}ms`)
	} else {
		throw err
	}
}
```

## Composite Actions

When a flow spans multiple endpoints (e.g. login then fetch profile, or
fetch + transform), define it as an **action** next to your endpoints instead
of writing a wrapper file. Actions are invoked with the same `api.x(...)`
ergonomics as endpoints and have access to the full client inside their
handler.

Use the **factory form** of `actions` so the `api` inside your handlers is
fully typed against your endpoints:

```ts
import { createApiClient } from 'hanzio/api-wrapper'

const api = createApiClient({
	baseApiUrls: { default: 'https://api.example.com' },
	endpoints: { login, usersGet },
	actions: ({ defineAction }) => ({
		loginAndGetMe: defineAction<{ email: string; password: string }>()({
			handler: async ({ input, api, signal }) => {
				// `api` is typed as ApiClient<typeof endpoints>
				const auth = await api.login({ reqBody: input, signal })
				const me = await api.usersGet({
					reqParams: { userId: auth.data.userId },
					reqHeaders: { Authorization: `Bearer ${auth.data.token}` },
					signal
				})
				return { id: me.data.id, name: me.data.name }
			}
		})
	})
})

const me = await api.loginAndGetMe({ email, password })
// also: await api.request('loginAndGetMe', { email, password })
```

The factory receives `{ api, defineAction }`. `defineAction` returned by the
factory is bound to your endpoints, so `ctx.api` (and `ctx.input`,
`ctx.cache`, etc.) are all properly typed. There is also a top-level
`defineAction` import for ad-hoc usage outside `createApiClient`, but its
`ctx.api` is typed as `any` — prefer the factory form.

### `defineAction`

Pass an `input` schema to validate action input at runtime. Callers pass the
schema's input type, the handler receives the parsed output, and invalid input
throws `RequestValidationError` (target `input`, category `input_validation`)
before the handler runs. Without a schema, the input type is a
TypeScript-only contract.

**Examples:**

```ts
// Validated input
defineAction({
	input: z.object({ id: z.coerce.number() }),
	handler: ({ input }) => input.id // number
})

// Typed-only input
defineAction<{ id: number }>()({
	handler: ({ input }) => input.id
})

// No input
defineAction({
	handler: () => 'ok'
})
```

`ctx` provides:

| Field | Description |
| --- | --- |
| `input` | The caller input: parsed by the `input` schema, or typed via the generic on `defineAction`. |
| `api` | The full client — endpoints and other actions. Calls inside the handler benefit from the same hooks/retries/errors as direct calls. |
| `signal` | Caller's `AbortSignal`. Forward it into inner `api.endpoint({ signal })` calls to make cancellation work. |
| `meta` | Arbitrary metadata passed by the caller. |
| `logger` | Same logger as the client. |
| `cache` | A shared cache (see below). |

The action's **return type is inferred from the handler**. Errors thrown
inside the handler that are already `ApiError` subclasses propagate as-is;
anything else is wrapped in `ActionError`.

Per-call options:

```ts
await api.loginAndGetMe({ email, password }, { signal, meta })
```

Action names must not collide with endpoint names — a `ConfigError` is
thrown at `createApiClient` time if they do.

### Sharing Auth (and Anything Else) Across Actions

`ctx.cache` is a shared key/value cache scoped to the client. The first
`cache(key, fn)` call runs `fn`; subsequent callers get the cached value.
Concurrent callers requesting the same key share a single in-flight promise,
so login isn't fired twice.

```ts
createApiClient({
	baseApiUrls: { default: 'https://api.example.com' },
	endpoints: { login, usersGet },
	actions: ({ defineAction }) => ({
		usersGet: defineAction<{ id: number }>()({
			handler: async ({ input, api, cache, signal }) => {
				const token = await cache(
					'authToken',
					async () => {
						const res = await api.login({
							reqBody: { email, password },
							signal
						})
						return res.data.token
					},
					{ ttlMs: 50 * 60 * 1000 } // optional; without it, lives for the client
				)

				try {
					return await api.usersGet({
						reqParams: { userId: input.id },
						reqHeaders: { Authorization: `Bearer ${token}` },
						signal
					})
				} catch (err) {
					if (isHttpResponseError(err) && err.status === 401) {
						cache.invalidate('authToken')
						// then retry, or rethrow to let the caller handle it
					}
					throw err
				}
			}
		})
	})
})
```

Cache API:

| Method | Description |
| --- | --- |
| `cache(key, fn, { ttlMs? })` | Get-or-compute. De-duplicates concurrent callers. Rejected promises are **not** cached. |
| `cache.get(key)` | Synchronous read; `undefined` if missing or expired. |
| `cache.set(key, value, { ttlMs? })` | Write a value directly. |
| `cache.invalidate(key)` | Drop an entry; next `cache(key, fn)` re-runs `fn`. |
| `cache.clear()` | Drop everything. |

The cache is also exposed on the client itself as `api.cache` for use outside
of action handlers (e.g. clearing auth on logout).

## Endpoint Configuration Reference

| Option | Required | Description |
| --- | --- | --- |
| `method` | Yes | HTTP method: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS`. |
| `path` | Yes | URL path with `:param` placeholders for path params. Joined to the base URL with exactly one `/`. |
| `resSchema` | Yes | Zod schema to validate the response. |
| `reqBodySchema` | No | Zod schema for request body. |
| `reqParamsSchema` | No | Zod schema for path parameters. |
| `reqQuerySchema` | No | Zod schema for query parameters. |
| `reqHeadersSchema` | No | Zod schema for request-specific headers. |
| `reqBodyFormat` | No | `json` or `form-data`. Object and array bodies default to JSON when no `Content-Type` is set. |
| `baseApiUrl` | No | Key for a non-default base URL. |
| `defaultHeaders` | No | Endpoint-specific headers. |
| `resFormatter` | No | Transform response data before validation. |
| `reqDefaultQueryParams` | No | Default query parameters, overridden per key by `reqQuery`. |
| `doNotEncodeQueryParams` | No | Skip URL encoding for query params. |

## Common Patterns

### Response Formatter

Use `resFormatter` when the raw API response does not match the schema you want
callers to receive.

```ts
export const endpoint = defineEndpoint({
	method: 'GET',
	path: '/data',
	resSchema: z.object({ items: z.array(z.string()) }),
	resFormatter: (data) => {
		const raw = data as { results: { name: string }[] }
		return {
			items: raw.results.map((result) => result.name)
		}
	}
})
```

### Optional And Nullable Fields

```ts
const Schema = z.object({
	required_field: z.string(),
	optional_field: z.string().optional(),
	nullable_field: z.string().nullable(),
	optional_nullable: z.string().nullish()
})
```

### Array Responses

```ts
const resSchema = z.array(
	z.object({
		id: z.number(),
		name: z.string()
	})
)
```
