---
name: hanzio-api-wrapper
description: Building typed HTTP API wrappers with createApiClient and Zod in hanzio/api-wrapper. Covers folder layout, index factory, endpoint files with defineEndpoint, shared types, pagination with paginate, and common REST API integration patterns.
---

# AI Agent Guide: Building API Wrappers

This guide is for AI assistants to follow when building API wrappers using the
`createApiClient` utility from `hanzio/api-wrapper`. The API reference
(configuration, errors, actions, retries, pagination) lives in
[README.md](./README.md).

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

The index file creates and exports the API client. When the token comes from
a secret store, create the client at module level and resolve the header
lazily with a `defaultHeaders` function; take the token as a parameter only
when callers supply it per instance.

```ts
import { createApiClient } from 'hanzio/api-wrapper'
import { endpointOne } from './endpointOne'
import { endpointTwo } from './endpointTwo'

export const exampleApi = createApiClient({
	name: 'exampleApi',
	baseApiUrls: {
		default: 'https://api.example.com'
	},
	defaultHeaders: () => ({
		Authorization: `Bearer ${getSecret('EXAMPLE_API_TOKEN')}`
	}),
	endpoints: {
		endpointOne,
		endpointTwo
	}
})
```

If the project uses OpenTelemetry, add
`use: [otelMiddleware(trace.getTracer('app'))]`; for other shared middleware
(metrics), pass it with `use: [...]` instead of wrapping `fetch`. Pass a
`logger` so failures are logged with their category (server, input or output
validation). If the API returns HTTP 200 with an
error envelope (e.g. `{ success: false, errors }`), add a `checkResponse` that
throws on failure rather than checking after every call.

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
import { defineEndpoint } from 'hanzio/api-wrapper'
import { z } from 'zod'

export const UserResponse = z.object({
	id: z.number(),
	name: z.string(),
	email: z.string()
})

export const usersGet = defineEndpoint({
	method: 'GET',
	path: '/users/:userId',
	reqQuerySchema: z.object({ includeInactive: z.boolean().optional() }),
	resSchema: UserResponse
})
```

`defineEndpoint` types `reqParams` from the `:params` in `path`, so add a
`reqParamsSchema` only when params need validation or coercion.

### Step 6: Create Utility Functions

Place reusable helpers in `utils/`, e.g. response normalization or rate-limit
handling. For pagination, use the built-in `paginate` instead of a hand-written
loop:

```ts
import { paginate } from 'hanzio/api-wrapper'
import type { GetExampleApi } from '../index'

export const usersGetAll = (api: GetExampleApi) =>
	Array.fromAsync(
		paginate(
			(page: number = 1) => api.usersList({ reqQuery: { page } }),
			(res) =>
				res.data.current_page < res.data.last_page
					? res.data.current_page + 1
					: null
		)
	)
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

## Checklist

- [ ] Create folder with API name in kebab-case.
- [ ] Create `index.ts` with a `createApiClient` call.
- [ ] Set `baseApiUrls` and `defaultHeaders` (a function when the token comes from a secret store).
- [ ] Add `checkResponse` if the API returns errors inside 200 responses.
- [ ] Create `types.ts` for shared schemas when needed.
- [ ] Create one file per endpoint.
- [ ] Define Zod schemas for all request and response data.
- [ ] Use `defineEndpoint` for endpoint definitions.
- [ ] Create helpers in `utils/` when needed.
- [ ] Export the API type, for example `export type ExampleApi = typeof exampleApi`.
- [ ] Test with `createMockFetch` from `hanzio/api-wrapper/testing` passed as `fetch`; don't replace `globalThis.fetch`.

## Tips

1. Always use `defineEndpoint` for endpoint definitions (it checks `resFormatter` and types path params).
2. Import Zod from `zod`.
3. Be strict with schemas and mark unstable fields as `.optional()` or `.nullish()`.
4. Use descriptive endpoint names like `usersGet`, `usersCreate`, and `ordersListByStatus`.
5. Keep files small by using one endpoint per file.
6. Extract schemas to `types.ts` when used by two or more endpoints.
7. Use `paginate` when APIs use pagination.
8. Ask for sample responses if the user only provides cURL commands.
