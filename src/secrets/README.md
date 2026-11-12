---
description: Typed secret sets with Infisical HTTP/CLI loading, validation, and runtime isolation.
---

# hanzio secrets

Define required keys and await a complete, validated snapshot before starting
an application. `secret()` and `secrets()` return strings; missing or empty
values fail startup.

```ts
import { defineSecretSet } from 'hanzio/secrets'

const infisical = {
	organizationId: 'infisical-organization-id',
	projectId: 'infisical-project-id',
	siteUrl: 'https://eu.infisical.com',
	secretPath: '/backend'
}

const secrets = await defineSecretSet(['DATABASE_URL', 'APP_SECRET'], {
	...infisical,
	optional: ['RESEND_API_KEY', 'EXA_API_KEY']
})

secrets.secret('DATABASE_URL')     // string
secrets.optional('RESEND_API_KEY') // string | undefined
```

### Optional keys

Keys listed in `optional` may be missing or empty without failing the load.
List a key there only, not in the required keys as well; a key in both fails
with `CONFIGURATION` when the set is declared. Optional keys are fetched in the
same loader call as required keys (`context.keys` includes them), local
environment overrides apply to them, and values they have are mirrored to
`process.env`. `reload()` reads them again, so a key added in Infisical later
appears after a reload. Read them with `optional(key)`; `secret()` accepts
required keys only, and `secrets()` and `parsed()` without a schema return the
required keys. `sources()` lists optional keys that have a value.

### Tests and offline runs

A `loader` next to Infisical options replaces Infisical, whose options are then
neither validated nor used. Keep one options object and swap in
`processEnvLoader`, which reads only `process.env` and fails with
`MISSING_SECRETS` naming the missing keys:

```ts
import { defineSecretSet, processEnvLoader } from 'hanzio/secrets'

const secrets = await defineSecretSet(['DATABASE_URL', 'APP_SECRET'], {
	...infisical,
	loader: process.env.NODE_ENV === 'test' ? processEnvLoader : undefined
})
```

## Import-safe declarations and public build configuration

Use `createSecretSet` when a module is imported by typechecking, build tooling,
or test runners. Declaration does not run a loader, evaluate the environment
callback, authenticate, or write environment values. Await `load()` at the
application entry point before starting servers or workers. Reading before a
successful load throws a clear configuration error.

```ts
// backend/config.ts — safe for tooling to import
import { createSecretSet } from 'hanzio/secrets'

export const secrets = createSecretSet(['DATABASE_URL', 'APP_SECRET'], {
	organizationId: 'infisical-organization-id',
	projectId: 'infisical-project-id',
	secretPath: '/backend'
})

// backend/start.ts
await secrets.load()
// Start the application only after validation succeeds.
```

`load()` is idempotent after successful initialization, shares concurrent loads,
and can retry a failed initialization. `reload()` always refreshes, retaining the
last successful snapshot on failure. The existing `defineSecretSet` API remains
an eager declaration plus load, with the same startup validation and overrides.
The runtime-neutral `hanzio/secrets/worker` entry exports both APIs too.

Frontend builds can read public values without a secret provider:

```ts
import { readPublicConfig, getViteDefine } from 'hanzio/secrets/vite'

const publicConfig = readPublicConfig(
	['VITE_API_URL', 'VITE_FIREBASE_API_KEY'],
	process.env
)

export default { define: getViteDefine(publicConfig) }
```

`readPublicConfig(keys, values, { optional })` is synchronous and
runtime-neutral. The caller supplies the values explicitly: production build
inputs or deterministic CI fixtures. It copies only the listed keys, never reads
unrelated values, and fails with their names if required values are missing,
empty, or not strings. Keys in `optional` may be missing; read them with
`optional(key)`.
It never fetches secrets, invents defaults, or writes `.env` / `process.env`.
Apply your own schema to `publicConfig.secrets()` to validate URLs and other
formats. The Vite allowlist policy still applies: non-`VITE_` keys require
`getViteDefine(publicConfig, { publicKeys: [...] })`.

Browser Firebase settings, public URLs, Turnstile site keys and PostHog browser
project keys are public build values. Server credentials and source-map upload
tokens belong in server or authenticated upload steps, outside this key list.

## Authentication and scope

`auth` supports three modes:

| Mode | Behavior |
| --- | --- |
| `auto` (default) | Uses HTTP when both client credentials are nonempty; otherwise uses the signed-in CLI session. |
| `http` | Requires both client credentials when remote loading is needed; never falls back to the CLI. |
| `cli` | Uses the signed-in CLI session even when client credentials exist. |

Credentials come from `INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET`.
Override those names with `clientIdEnvKey` and `clientSecretEnvKey`. When neither
is set, `auto` and `http` read a machine identity from
`~/.infisical/universal-auth.json` (`INFISICAL_UNIVERSAL_AUTH_FILE` overrides the
path): `{ "clientId", "clientSecret", "siteUrl" }`, used only for that `siteUrl`'s
instance. agentgate writes this file on every machine of a user. HTTP
failures never switch to another authentication mode. If every key, optional
ones included, is already supplied by genuine environment overrides,
authentication is skipped.

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
this filtering. CLI output stays in memory, is limited to 10 MiB per stream,
and never appears in errors. The helper closes stdin and never executes a shell
command or launches login itself.

Parallel `infisical user get token` runs can hang, so the CLI runs one at a
time. Within a process, concurrent sets on the same `siteUrl` share one read.
Across processes, a lock file at `~/.infisical/hanzio-cli.lock` queues them;
a lock older than 30 seconds, or left by a process that has exited, is taken
over. Waiting for the lock counts against the load's deadline and signal.

A logged-in CLI prints its token at once, so the subprocess gets 5 seconds of
its own. When the session has expired, the CLI starts an interactive login
instead: the helper stops it as soon as it prints a login prompt, or when the 5
seconds run out, and fails with `AUTHENTICATION`:

```text
The Infisical CLI session for https://eu.infisical.com has expired or needs a login. Run infisical login --domain=https://eu.infisical.com.
```

After a timeout the message adds that a logged-in CLI that was only slow can be
retried.

### Multiple organizations and projects

Set `organizationId` alongside `projectId` to use the same signed-in user across
organizations on the configured Infisical instance. Concurrent sets share one
CLI read, so loading them with `Promise.all` is safe:

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
authentication challenges.

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

### Monorepos

When several processes start together, such as `turbo dev`, the lock queues
their CLI reads. It is faster to let one parent process load the secrets and
pass the values to its children through the environment: genuine environment
overrides skip the fetch once every key, optional ones included, has a value.

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
`{ slug }`. It is resolved on the first load (`defineSecretSet` loads immediately); reload keeps that scope.
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

Trigger `reload()` only from an authenticated caller, such as a webhook whose
signature you check with `verifyHmacSignature` from `hanzio/crypto`. An
unauthenticated endpoint lets anyone make the app fetch from Infisical
repeatedly.

## Deadlines and cancellation

`timeoutMs` defaults to 60,000. The overall deadline covers authentication,
fetching, retries, response body reads, and schema validation. `signal` accepts
an `AbortSignal`; subprocesses and HTTP requests receive cancellation.

Infisical HTTP requests keep retrying until the deadline when the failure is
transient: a network error such as `ECONNREFUSED`, no response within 10
seconds, or a 429 or 5xx status. Waits grow exponentially from 0.5 seconds with
full jitter, capped at 5 seconds (`Retry-After` included), and the deadline
cuts a wait short. An app that boots during a short network outage therefore
starts once the network returns, and fails with `TIMEOUT` if the outage
outlasts `timeoutMs`. Any other 4xx response, such as a wrong client secret,
fails on the first answer. The Infisical CLI subprocess only reads its local
session: it has its own 5-second limit and is not retried; the HTTP requests
that follow it are.

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
the complete merged record: required keys as strings, plus optional keys that
have a value (mark them `.optional()` in the schema). Raw secret methods and
environment mirroring retain strings. `parsed()` returns the inferred schema
output, including transforms.

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

All required keys must have nonempty strings before schema validation.
Schema output must be structured-cloneable. Validation errors omit input
values and schema error messages, which may themselves contain secrets.

## Sources, logs, and errors

Successful loads emit `Loaded secrets` with environment, the number of keys
that have a value, duration, and counts for the sources that actually supplied
the final values. Nothing is reported as successfully loaded before fetching
and validation finish. The default logger writes every line to stderr, so a
CLI that prints JSON on stdout stays parseable.

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

Each retry logs a warning first, so a slow startup shows what it waits for:

```text
Retrying secret load environment=prod operation=login attempt=3 delayMs=1840 reason=ECONNREFUSED
```

`reason` is `status <code>`, `timeout`, or the network error code. It never
contains URLs, responses or tokens.

Set `logger: false` to disable logs, or pass an object with `info(message,
attributes)` and `error(message, attributes)` methods, plus an optional
`warn(message, attributes)` for retries. The `sources` attribute is a
source-to-count object. Failures log only environment, count, duration, and an
error code. Logger exceptions do not change the load result. A custom loader
can report its own retries with `context.reportRetry({ operation, attempt,
delayMs, reason })`.

`SecretLoadError` exposes a stable `code`, and optionally HTTP `operation` and
`status`. Codes include `CONFIGURATION`, `AUTHENTICATION`, `HTTP`, `CLI`,
`VALIDATION`, `MISSING_SECRETS`, `TIMEOUT`, `ABORTED`, and `LOADER`. HTTP and CLI
boundaries omit raw requests, responses, subprocess output, and underlying
causes. Custom-loader exceptions are replaced with a generic safe error.

Infisical errors say what to fix, naming keys, IDs and paths but never values.
Configuration errors name the bad field (`projectId`, `environment`,
`secretPath`). A rejected login says which credential variables to check, such
as `INFISICAL_CLIENT_ID and INFISICAL_CLIENT_SECRET`. A denied or missing
secret list names the project, environment and path the identity cannot read.

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

Import the Vite helpers from `hanzio/secrets/vite`. The default helpers accept
only sets consisting of `VITE_` keys. A set containing any other key is
rejected unless you explicitly supply `publicKeys`. An explicit list exports
only those keys; it may intentionally include a non-prefixed public key. Vite
built-in constants cannot be overridden. Optional keys without a value are left
out, including ones named in `publicKeys`.

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

- The default logger writes `Loaded secrets` to stderr instead of stdout. Pass
  your own `logger` if something parsed it from stdout.
- `getViteDefine`, `viteSecretSetPlugin` and `readPublicConfig` are no longer
  exported from `hanzio/secrets`. Import them from `hanzio/secrets/vite`
  (`readPublicConfig` is also on `hanzio/secrets/worker`).
- An expired Infisical CLI session now fails within seconds with
  `AUTHENTICATION` instead of waiting out the load deadline with `TIMEOUT`.
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
errors, authentication selection, paths, deadlines, retries, and cancellation.
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
