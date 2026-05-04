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
