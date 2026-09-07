---
description: Typed secret sets with Infisical HTTP/CLI loading, validation, and runtime isolation.
---

# hanzio secrets

Define required keys and await a complete, validated snapshot before starting
an application. `secret()` and `secrets()` return strings; missing or empty
values fail startup.

```ts
import { defineSecretSet } from 'hanzio/secrets'

const secrets = await defineSecretSet(['DATABASE_URL', 'APP_SECRET'], {
	organizationId: 'infisical-organization-id',
	projectId: 'infisical-project-id',
	siteUrl: 'https://eu.infisical.com',
	secretPath: '/backend'
})

const databaseUrl = secrets.secret('DATABASE_URL')
```

## Authentication and scope

`auth` supports three modes:

| Mode | Behavior |
| --- | --- |
| `auto` (default) | Uses HTTP when both client credentials are nonempty; otherwise uses the signed-in CLI session. |
| `http` | Requires both client credentials when remote loading is needed; never falls back to the CLI. |
| `cli` | Uses the signed-in CLI session even when client credentials exist. |

Credentials come from `INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET`.
Override those names with `clientIdEnvKey` and `clientSecretEnvKey`. HTTP
failures never switch to another authentication mode. If all required keys
are already supplied by genuine environment overrides, authentication is skipped.

For local development, install the [Infisical CLI](https://infisical.com/docs/cli/overview),
ensure `infisical` is on your application's `PATH`, and sign in:

```sh
infisical login --domain=https://eu.infisical.com
```

Use your configured `siteUrl` for login. The default is
`https://eu.infisical.com`. The helper passes project, environment, domain,
and `secretPath` (default `/`) explicitly, so `.infisical.json` is unnecessary.
Both authentication modes fetch secrets over HTTP, including imports and
expanded secret references.

The child environment omits `INFISICAL_TOKEN`,
`INFISICAL_UNIVERSAL_AUTH_ACCESS_TOKEN`, and legacy `TOKEN` so they do not
replace the signed-in user session. The parent environment is unchanged by
this filtering. CLI output stays in memory and is limited to 10 MiB per stream.
The helper closes stdin and never executes a shell command or launches login
itself. Some CLI versions may attempt browser login while reading the token
if the session expires. Sign in before starting the app.

### Multiple organizations and projects

Set `organizationId` alongside `projectId` to use the same signed-in user across
organizations on the configured Infisical instance:

```ts
const [first, second] = await Promise.all([
	defineSecretSet(['DATABASE_URL'], {
		organizationId: 'organization-a',
		projectId: 'project-a',
		auth: 'cli',
		writeToProcessEnv: false
	}),
	defineSecretSet(['DATABASE_URL'], {
		organizationId: 'organization-b',
		projectId: 'project-b',
		auth: 'cli',
		writeToProcessEnv: false
	})
])
```

CLI authentication runs `infisical user get token --plain`
to read the active user's session. If its organization differs, the helper
exchanges it through `/api/v3/auth/select-organization`, then fetches secrets
over HTTP. Already matching sessions skip the exchange. Tokens stay in memory
for that operation; the helper does not persist the exchanged token, switch
the active CLI organization, or cache tokens between sets or reloads.

Organization selection uses the same internal endpoint as
[Infisical CLI init](https://github.com/Infisical/cli/blob/main/packages/cmd/init.go).
The adapter may need updating if that contract changes. It honors organization
access restrictions; MFA challenges, expired sessions, and denied access fail
with sanitized errors. Complete login for the target organization and domain
when additional MFA or SSO is required. The helper cannot satisfy interactive
authentication challenges. The CLI itself may attempt login when its session
is missing or expired, including during `user get token`.

Sign in to the same instance as `siteUrl`: reading a token uses the CLI's active
profile, and does not automatically choose a different account or instance.
This HTTP flow requires network access and does not use the CLI's offline
secret backup. Project, environment, folder, imports, and reference expansion
use the same HTTP loading options as machine authentication.

`organizationId` is required alongside `projectId` in all Infisical options,
including explicit HTTP loaders. Missing, empty, or whitespace-containing IDs
fail configuration validation, even when environment overrides supply every
secret. Custom loaders do not require Infisical configuration.
With machine credentials (`auth: 'http'`, or `auto` with both credentials), the
identity's existing organization and permissions apply; `organizationId` does
not switch a machine identity into another organization. Use `auth: 'cli'` to
force user authentication locally when machine credentials are also present.

Keep `writeToProcessEnv: false` when loading multiple organizations in one
process. Genuine environment overrides still apply to all sets using that key.

For deployments, use `auth: 'http'` and provide machine identity credentials.
The CLI requires Node.js/Bun subprocess support; it is not available in Workers.

## Environments

Selection order is the explicit `environment` option, `SECRETS_ENV`, then
`NODE_ENV`. An explicitly configured invalid environment fails instead of
silently selecting development.

- `dev` / `development` resolve to `dev`.
- `staging` resolves to `staging`.
- `prod` / `production` resolve to `prod`.
- An absent `SECRETS_ENV` uses the usual `NODE_ENV` mapping; unset, test, and
  other `NODE_ENV` values default to `dev`.
- A custom Infisical environment must be explicit: `environment: { slug: 'preview-123' }`.

`environment` also accepts a function returning a standard environment or
`{ slug }`. It is resolved once when the set is created; reload keeps that scope.
An empty `SECRETS_ENV` is invalid—unset it to use the default.

## Overrides, isolation, and reload

Genuine `process.env` overrides take precedence. By default, fetched values
are also written to `process.env` for compatibility with existing applications.
The helper tracks its own writes: a second set cannot mistake another set's
fetched values for user overrides. Original local overrides remain valid on
reload, even if their values never change.

```ts
const secrets = await defineSecretSet(['DATABASE_URL'], {
	organizationId: 'organization-id',
	projectId: 'project-id',
	writeToProcessEnv: false
})

await secrets.reload()
```

`writeToProcessEnv: false` keeps fetched values within the set. Existing local
overrides still apply. Use this for multiple projects/environments in one
process and for build-time frontend configuration. With mirroring enabled,
`process.env` holds the most recently written values; each set retains its own
snapshot regardless of other sets' writes.

If another part of the app changes a mirrored environment value, it becomes a
local override. Reassigning exactly the same string is indistinguishable from
leaving the mirror untouched; use an explicit custom loader with isolated sets
when that distinction matters. Write tracking is shared across package copies
within the same JavaScript realm, not across processes or worker threads.

Reload refreshes keys without genuine local overrides. Concurrent reloads
share one operation, using the first caller's timeout and signal. Failed,
cancelled, or invalid refreshes preserve the previous cache. Validation and
cancellation checks happen before values are committed. `secrets()`, `sources()`,
and `parsed()` return copies.

## Deadlines and cancellation

`timeoutMs` defaults to 30,000. The overall deadline covers authentication,
fetching, retries, response body reads, and schema validation. `signal` accepts
an `AbortSignal`; subprocesses and HTTP requests receive cancellation.

```ts
const controller = new AbortController()
const secrets = await defineSecretSet(['APP_SECRET'], {
	organizationId: 'organization-id',
	projectId: 'project-id',
	timeoutMs: 10_000,
	signal: controller.signal
})

await secrets.reload({ timeoutMs: 5_000, signal: anotherController.signal })
```

A reload can override the original timeout/signal. Custom loaders should honor
`context.signal`. A loader that ignores cancellation may continue its own work,
but its late result cannot update the secret set.

## Schema validation and typed values

Use an optional Zod schema (or an object implementing `parseAsync`) to validate
the complete merged record. Raw secret methods and environment mirroring retain
strings. `parsed()` returns the inferred schema output, including transforms.

```ts
import { z } from 'zod'
import { defineSecretSet } from 'hanzio/secrets'

const secrets = await defineSecretSet(['DATABASE_URL', 'PORT', 'FLAGS'], {
	organizationId: 'organization-id',
	projectId: 'project-id',
	writeToProcessEnv: false,
	schema: z.object({
		DATABASE_URL: z.url(),
		PORT: z.coerce.number().int().positive(),
		FLAGS: z.string().transform(JSON.parse).pipe(z.object({ debug: z.boolean() }))
	})
})

const port: number = secrets.parsed().PORT
const rawPort: string = secrets.secret('PORT')
```

All configured keys must have nonempty strings before schema validation.
Schema output must be structured-cloneable. Validation errors omit input
values and schema error messages, which may themselves contain secrets.

## Sources, logs, and errors

Successful loads emit `Loaded secrets` with environment, count, duration, and
counts for the sources that actually supplied the final values. Nothing is
reported as successfully loaded before fetching and validation finish.

```text
Loaded secrets environment=dev count=3 source=process.env + Infisical HTTP durationMs=120
```

Use `secrets.sources()` for per-key source labels. Built-in labels are
`process.env`, `Infisical HTTP`, and `Cloudflare Worker bindings`.
Organization-scoped user loads use
`Infisical CLI session (organization=<id> project=<id> environment=<slug>)`;
this indicates CLI authentication followed by HTTP fetching. The same label
appears in source counts and per-key metadata, without tokens or secret values.
A custom loader defaults to `custom loader`; set its `source` property or call
`context.reportSource('provider name')` for a dynamic source. Source labels are
caller-controlled metadata: never put secret values in them.

Set `logger: false` to disable logs, or pass an object with `info(message,
attributes)` and `error(message, attributes)` methods. The `sources` attribute
is a source-to-count object. Failures log only environment, count, duration,
and an error code. Logger exceptions do not change the load result.

`SecretLoadError` exposes a stable `code`, and optionally HTTP `operation` and
`status`. Codes include `CONFIGURATION`, `AUTHENTICATION`, `HTTP`, `CLI`,
`VALIDATION`, `MISSING_SECRETS`, `TIMEOUT`, `ABORTED`, and `LOADER`. HTTP and CLI
boundaries omit raw requests, responses, subprocess output, and underlying
causes. Custom-loader exceptions are replaced with a generic safe error.

## Explicit loaders

The `loader` option replaces the default Infisical strategy:

- `infisicalLoader({ organizationId, projectId, clientId, clientSecret, siteUrl?, secretPath?, timeoutMs? })`
  uses explicit credentials over HTTP. The enclosing set's deadline and signal
  still apply. Read credentials from the environment or another secret store;
  do not hard-code them.
- `processEnvLoader` uses only genuine process environment values. Reload
  preserves unchanged overrides. It does not adopt another set's mirrored values.
- `cloudflareWorkerEnvLoader(bindings)` reads a bindings object. Strings are
  retained; numbers and booleans become strings; JSON objects are serialized.
  Schema validation can turn them into typed values afterward.

## Cloudflare Workers

Use `hanzio/secrets/worker` for a runtime-neutral entry point with no CLI or
HTTP adapter dependency and no reliance on `process.env` or Node compatibility.
This entry point requires an explicit loader and does not read or write process
environment variables. Pass the environment option explicitly when needed.

```ts
import { defineSecretSet, cloudflareWorkerEnvLoader } from 'hanzio/secrets/worker'

export default {
	async fetch(request: Request, env: { APP_SECRET: string }) {
		const secrets = await defineSecretSet(['APP_SECRET'], {
			loader: cloudflareWorkerEnvLoader(env),
			environment: 'prod',
			logger: false
		})
		// Use secrets.secret('APP_SECRET') on the server.
		return new Response('Ready')
	}
}
```

Keep tenant/request-specific bindings in separate sets rather than caching
them in a module-level singleton.

## Vite: public values only

The default Vite helpers accept only sets consisting of `VITE_` keys. A set
containing any other key is rejected unless you explicitly supply `publicKeys`.
An explicit list exports only those keys; it may intentionally include a
non-prefixed public key. Vite built-in constants cannot be overridden.

```ts
import { defineConfig } from 'vite'
import { defineSecretSet } from 'hanzio/secrets'
import { viteSecretSetPlugin } from 'hanzio/secrets/vite'

const frontend = await defineSecretSet(['VITE_POSTHOG_API_KEY', 'VITE_POSTHOG_HOST'], {
	organizationId: 'organization-id',
	projectId: 'project-id',
	writeToProcessEnv: false
})

export default defineConfig({
	plugins: [viteSecretSetPlugin(frontend)]
})
```

For a mixed set, use `viteSecretSetPlugin(set, { publicKeys: ['VITE_PUBLIC_KEY'] })`.
`getViteDefine(set, options)` accepts the same options for manual integration.
Every selected value is public and may be included in browser code; `VITE_`
is a naming convention, not encryption. Keep private credentials on the server.
Vite mode and `NODE_ENV` are separate; pass `environment: 'staging'` explicitly
when building a staging configuration.

## Migration notes

- Add `organizationId` to every Infisical configuration, including explicit HTTP
  loaders. CLI authentication now always uses the organization-scoped session
  flow; the unscoped CLI export fallback has been removed.

- Vite calls that exposed non-`VITE_` keys now fail. Rename public keys or pass
  an explicit `publicKeys` list. Never allowlist server credentials.
- Unknown/empty explicit environments now fail. Use `{ slug: 'custom-name' }`
  for custom environments, or unset `SECRETS_ENV` to use defaults.
- A second set no longer silently inherits remote values mirrored by a first
  set. Give each set its loader configuration; use `writeToProcessEnv: false`
  to keep remote values isolated.
- `reload()` now preserves genuine environment overrides and shares concurrent
  calls. Loaders receive only keys requiring remote loading, including on reload.
- Success logging changes from `Loading secrets` to `Loaded secrets`, with
  actual source counts and duration. Failures emit a separate sanitized event.
- Infisical failures now use `SecretLoadError`; code inspecting raw API-wrapper
  errors must switch to `code`, `operation`, and `status`.
- Custom loader context `environment` is now a string to accommodate custom slugs.

## Validation

`bun test` covers ownership, reload races, validation, source reports, safe
errors, authentication selection, paths, deadlines, and cancellation.
Organization tests cover concurrent sets, rereading the session on reload, MFA,
expired tokens, denied access, and sanitized errors.
`bun run test:secrets:runtime` builds and packs the package, exercises a fake
CLI under Node and Bun, tests concurrent organization scopes against a local
HTTP server, checks a Vite browser bundle for a private fixture,
and executes the Worker entry point in local workerd through Miniflare without
Node compatibility. Runtime verification requires macOS/Linux, Node 22.12+, and Bun on PATH;
it never uses a real Infisical session or deploys a Worker.
The CLI, runtime, and Worker fixtures live in `scripts/fixtures` so their code
can be read and edited directly.
