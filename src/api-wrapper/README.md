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
