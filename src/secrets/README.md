---
description: Typed Infisical-backed secret sets with fail-fast startup loading.
---

# hanzio secrets

`defineSecretSet` lets an application define its own required secret keys and
load them before the rest of the program starts.

```ts
import { defineSecretSet } from 'hanzio/secrets'

export const backendSecrets = await defineSecretSet(
	['DATABASE_URL', 'APP_SECRET'] as const,
	{
		projectId: 'infisical-project-id',
		siteUrl: 'https://eu.infisical.com'
	}
)

const databaseUrl = backendSecrets.secret('DATABASE_URL')
```

The returned secret set is only available after every configured key has been
loaded from `process.env` or Infisical. Local environment values take precedence
over remote values, and loaded values are written back to `process.env`.

## Secret loaders

By default, `defineSecretSet` uses Infisical universal auth. It reads
`INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET` from the environment (or
override via `clientIdEnvKey` / `clientSecretEnvKey` on the options object).

Set `loader` to choose a different strategy (then `projectId` is not used on
`defineSecretSet`; put it on `infisicalLoader` instead):

- **`infisicalLoader({ projectId, clientId, clientSecret, siteUrl? })`** — Same
  Infisical HTTP flow with explicit credentials and project id. Optional
  `siteUrl` defaults to `https://eu.infisical.com`. Prefer reading credentials
  from `process.env` (or another secret store) rather than hard-coding long-lived
  secrets in source.

- **`processEnvLoader`** — Only uses `process.env` for the configured keys. The
  loader never calls Infisical. Missing keys still fail fast with the same error
  as other loaders.

- **`cloudflareWorkerEnvLoader(workerEnv)`** — Fills missing keys from a
  Cloudflare Worker bindings object (the `env` argument on your fetch handler).
  Use this when secrets and vars are *not* available on `process.env` (typical
  without `nodejs_compat_populate_process_env`). Does not depend on Wrangler or
  import `cloudflare:workers`; pass your `env` (or a snapshot of it) from your
  Worker code. String bindings are used as-is; JSON `vars` objects are
  serialized with `JSON.stringify`. `process.env` still wins when both are set.

```ts
import {
	cloudflareWorkerEnvLoader,
	defineSecretSet,
	infisicalLoader,
	processEnvLoader
} from 'hanzio/secrets'

await defineSecretSet(['DATABASE_URL'] as const, {
	loader: infisicalLoader({
		projectId: 'infisical-project-id',
		clientId: process.env.MY_INFISICAL_CLIENT_ID!,
		clientSecret: process.env.MY_INFISICAL_CLIENT_SECRET!,
		siteUrl: 'https://eu.infisical.com'
	})
})

await defineSecretSet(['DATABASE_URL'] as const, {
	loader: processEnvLoader
})

// Inside a Worker (or any code that holds `env`):
await defineSecretSet(['DATABASE_URL'] as const, {
	loader: cloudflareWorkerEnvLoader(env)
})
```

## Vite

Use `viteSecretSetPlugin` when secrets should be exposed through
`import.meta.env.*` replacements in Vite.

```ts
import { defineConfig } from 'vite'
import { defineSecretSet } from 'hanzio/secrets'
import { viteSecretSetPlugin } from 'hanzio/secrets/vite'

const frontendSecrets = await defineSecretSet(
	['VITE_POSTHOG_API_KEY', 'VITE_POSTHOG_HOST'] as const,
	{ projectId: 'infisical-project-id' }
)

export default defineConfig({
	plugins: [viteSecretSetPlugin(frontendSecrets)]
})
```

If you need to merge the values manually, use `getViteDefine(frontendSecrets)`.

`SECRETS_ENV` controls the Infisical environment. If it is not set,
`NODE_ENV=production` maps to `prod`, `NODE_ENV=staging` maps to `staging`, and
all other values use `dev`.
