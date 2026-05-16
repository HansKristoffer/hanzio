---
name: hanzio-api-wrapper
description: Building typed HTTP API wrappers with createApiClient and Zod in hanzio/api-wrapper. Covers folder layout, index factory, endpoint files with satisfies ApiEndpoint, shared types, pagination helpers, and common REST API integration patterns.
---

# AI Agent Guide: Building API Wrappers

This guide is for AI assistants to follow when building API wrappers using the
`createApiClient` utility from `hanzio/api-wrapper`.

## Folder Structure

When creating a new API wrapper, follow this structure:

```txt
src/api-wrapper/{api-name}/
├── index.ts
├── types.ts
├── {endpointName}.ts
├── {anotherEndpoint}.ts
└── utils/
    ├── {utilName}.ts
    └── ...
```

### Naming Conventions

- Folder name: lowercase, kebab-case, for example `github-api`, `stripe`, `template-persona`.
- Endpoint files: camelCase and action-oriented, for example `topicsGet.ts`, `usersCreate.ts`, `ordersUpdate.ts`.
- Utility files: camelCase and descriptive, for example `paginateResults.ts`, `templateGetAll.ts`.

## Step-By-Step Process

### Step 1: Gather Information

The user will typically provide one or more of:

1. cURL command: extract method, URL, headers, and body.
2. Request/response examples: use them to build Zod schemas.
3. Chrome DevTools Network logs: extract request and response details.
4. API documentation: reference schemas, auth, pagination, and endpoints.

### Step 2: Create The Folder

```bash
mkdir -p src/api-wrapper/{api-name}/utils
```

### Step 3: Create The Index File

The index file creates and exports the API wrapper instance.

```ts
import { createApiClient } from 'hanzio/api-wrapper'
import { endpointOne } from './endpointOne'
import { endpointTwo } from './endpointTwo'

export type GetExampleApi = ReturnType<typeof getExampleApi>

export const getExampleApi = (apiToken: string) => {
	return createApiClient({
		name: 'exampleApi',
		baseApiUrls: {
			default: 'https://api.example.com'
		},
		defaultHeaders: {
			Authorization: `Bearer ${apiToken}`
		},
		endpoints: {
			endpointOne,
			endpointTwo
		}
	})
}
```

### Step 4: Create Shared Types

If multiple endpoints share schemas, create a `types.ts` file.

```ts
import { z } from 'zod'

export const ListQueryInput = z.object({
	page: z.number().optional(),
	page_size: z.number().optional()
})
export type ListQueryInput = z.infer<typeof ListQueryInput>

export const ListQueryOutput = <T extends z.ZodType>(itemSchema: T) =>
	z.object({
		data: z.array(itemSchema),
		current_page: z.number(),
		last_page: z.number(),
		per_page: z.number(),
		total: z.number()
	})

export type ListQueryOutput<T> = {
	data: T[]
	current_page: number
	last_page: number
	per_page: number
	total: number
}
```

### Step 5: Create Endpoint Files

Each endpoint gets its own file with request/response schemas and endpoint
configuration.

```ts
import type { ApiEndpoint } from 'hanzio/api-wrapper'
import { z } from 'zod'

export const UserResponse = z.object({
	id: z.number(),
	name: z.string(),
	email: z.string()
})

export const usersGet = {
	method: 'GET',
	path: '/users/:userId',
	reqParamsSchema: z.object({ userId: z.string() }),
	reqQuerySchema: z.object({ includeInactive: z.boolean().optional() }),
	resSchema: UserResponse
} satisfies ApiEndpoint
```

### Step 6: Create Utility Functions

Place reusable helpers in `utils/`. Common helpers include pagination, response
normalization, and rate-limit handling.

```ts
import type { ApiWrapperResponse } from 'hanzio/api-wrapper'

export async function getAllPages<T>(
	fetchPage: (
		page: number
	) => Promise<ApiWrapperResponse<{ data: T[]; total_pages: number }>>
): Promise<T[]> {
	let page = 1
	let totalPages = Number.POSITIVE_INFINITY
	const allData: T[] = []

	while (page <= totalPages) {
		const response = await fetchPage(page)
		allData.push(...response.data.data)
		totalPages = response.data.total_pages
		page += 1
	}

	return allData
}
```

## Extracting Information From User Input

### From cURL Commands

```bash
curl -X POST 'https://api.example.com/users' \
  -H 'Authorization: Bearer token123' \
  -H 'Content-Type: application/json' \
  -d '{"name": "John", "email": "john@example.com"}'
```

Extract:

- Method: `POST`
- Base URL: `https://api.example.com`
- Path: `/users`
- Headers: `Authorization`, `Content-Type`
- Body schema: `{ name: string, email: string }`

### From Chrome DevTools

Look for:

1. Request URL: base URL plus path.
2. Request method: HTTP method.
3. Request headers: auth and custom headers.
4. Request payload: body schema.
5. Response body: response schema.
6. Query string parameters: query schema.

### Building Zod Schemas From JSON

Given this response:

```json
{
	"id": 123,
	"name": "John Doe",
	"email": "john@example.com",
	"created_at": "2024-01-15T10:30:00Z",
	"roles": ["admin", "user"],
	"profile": {
		"avatar_url": "https://example.com/avatar.png",
		"bio": "Developer"
	},
	"is_active": true
}
```

Create this schema:

```ts
const UserResponse = z.object({
	id: z.number(),
	name: z.string(),
	email: z.string(),
	created_at: z.string(),
	roles: z.array(z.string()),
	profile: z.object({
		avatar_url: z.string(),
		bio: z.string()
	}),
	is_active: z.boolean()
})
```

## Calling Endpoints

`createApiClient` returns a client with both a generic `request` method and
per-endpoint methods (created via Proxy) for autocomplete.

```ts
const api = getExampleApi(token)

await api.request('usersGet', { reqParams: { userId: 'u1' } })
await api.usersGet({ reqParams: { userId: 'u1' } })
```

When a schema is defined for `reqParams`, `reqBody`, `reqQuery`, or
`reqHeaders`, the corresponding input field is **required at the type level**.

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
| `defaultBaseApiUrl` | Key in `baseApiUrls` to use when an endpoint doesn't specify one. |
| `timeoutMs` | Default per-request timeout (uses `AbortController`). |
| `retries` | Default retry count (default `3`). |
| `retryDelayMs` | Delay between retries. `number \| (attempt) => number`. |
| `shouldRetry` | `(ctx) => boolean` to override the default retry policy. |
| `fetch` | Custom fetch implementation. |
| `logger` | `Pick<Console, 'debug' \| 'error'>` for debug + error logging. |
| `onRequest` | Hook that runs before each attempt. May return `{ headers, body }` to mutate the outgoing request (useful for auth refresh, tracing). |
| `onResponse` | Hook that runs after each response is received (called per attempt). |
| `onRetry` | Hook called before each retry with `{ delayMs, nextAttempt, ... }`. |
| `onError` | Hook called when an `ApiError` is about to be thrown. |
| `redact` | Optional `(context: ApiErrorContext) => ApiErrorContext` applied before `logger` / `onError` and before errors store context. Built-in default redaction strips sensitive headers (`authorization`, `cookie`, `set-cookie`) and common secret-like body keys (`password`, `token`, `accessToken`, `refreshToken`, `secret`). Override wholly or layer on top of the default by copying fields you need from the incoming context. |

The default retry policy retries network errors and `5xx`/`429` responses, and
**does not retry** validation, abort, config, or `4xx` errors. `Retry-After`
headers on `429`/`503` are respected.

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
| `RequestAbortedError` | The caller's `signal` aborted the request. |
| `NetworkError` | `fetch` itself threw (DNS, TCP, etc.). |
| `ConfigError` | Misconfiguration: unknown endpoint, missing base URL, missing path parameter. |

Type guards are exported for all of them: `isApiError`, `isHttpResponseError`,
`isResponseValidationError`, `isRequestValidationError`,
`isRequestTimeoutError`, `isRequestAbortedError`, `isNetworkError`,
`isConfigError`.

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
`ctx.api` is typed as `any` \u2014 prefer the factory form.

### `defineAction`

Actions are internal functions called from your own code. Their `input` type
is a **TypeScript-only contract**: there is no Zod or other runtime validation
on the action boundary. **Endpoints** remain the runtime validation layer:
`reqBodySchema`, `reqQuerySchema`, `reqParamsSchema`, and `resSchema` run on
every HTTP call. For data that enters from outside your app (HTTP handlers,
CLI, untrusted JSON), validate with Zod (or similar) at that boundary, or rely
on the endpoint schemas when the action forwards into `api.someEndpoint(...)`.

**Examples:**

```ts
// With input
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
| `input` | The caller input, typed via the generic on `defineAction`. |
| `api` | The full client \u2014 endpoints and other actions. Calls inside the handler benefit from the same hooks/retries/errors as direct calls. |
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

Action names must not collide with endpoint names \u2014 a `ConfigError` is
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
| `path` | Yes | URL path with `:param` placeholders for path params. |
| `resSchema` | Yes | Zod schema to validate the response. |
| `reqBodySchema` | No | Zod schema for request body. |
| `reqParamsSchema` | No | Zod schema for path parameters. |
| `reqQuerySchema` | No | Zod schema for query parameters. |
| `reqHeadersSchema` | No | Zod schema for request-specific headers. |
| `reqBodyFormat` | No | Request body format: `json` or `form-data`. |
| `baseApiUrl` | No | Key for a non-default base URL. |
| `defaultHeaders` | No | Endpoint-specific headers. |
| `resFormatter` | No | Transform response data before validation. |
| `reqDefaultQueryParams` | No | Default query parameters. |
| `doNotEncodeQueryParams` | No | Skip URL encoding for query params. |

## Checklist

- [ ] Create folder with API name in kebab-case.
- [ ] Create `index.ts` with a `createApiClient` call.
- [ ] Set `baseApiUrls` and `defaultHeaders`.
- [ ] Create `types.ts` for shared schemas when needed.
- [ ] Create one file per endpoint.
- [ ] Define Zod schemas for all request and response data.
- [ ] Use `satisfies ApiEndpoint` for endpoint definitions.
- [ ] Create helpers in `utils/` when needed.
- [ ] Export the API type, for example `export type GetExampleApi = ReturnType<typeof getExampleApi>`.

## Common Patterns

### Response Formatter

Use `resFormatter` when the raw API response does not match the schema you want
callers to receive.

```ts
export const endpoint = {
	method: 'GET',
	path: '/data',
	resSchema: z.object({ items: z.array(z.string()) }),
	resFormatter: (data) => {
		const raw = data as { results: { name: string }[] }
		return {
			items: raw.results.map((result) => result.name)
		}
	}
} satisfies ApiEndpoint
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

## Tips

1. Always use `satisfies ApiEndpoint` for endpoint definitions.
2. Import Zod from `zod`.
3. Be strict with schemas and mark unstable fields as `.optional()` or `.nullish()`.
4. Use descriptive endpoint names like `usersGet`, `usersCreate`, and `ordersListByStatus`.
5. Keep files small by using one endpoint per file.
6. Extract schemas to `types.ts` when used by two or more endpoints.
7. Create pagination helpers when APIs use pagination.
8. Ask for sample responses if the user only provides cURL commands.
