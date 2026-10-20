---
description: bun:test helpers - restorable module mocks, a deep Prisma mock, a minimal window shim, and a race contract for API clients that share logins.
---

# hanzio/testing

For `bun:test`. The module can be imported outside Bun; `bun:test` is only
loaded when a helper that needs it runs.

```ts
import {
	connectionAuthContract,
	createPrismaMock,
	installWindowShim,
	ModuleMocker,
	mockCallArg,
	noopLogger
} from 'hanzio/testing'
```

## Restorable module mocks

Bun's `mock.module` replaces a module for the whole test run, and
`mock.restore()` does not undo it, so a stub in one file leaks into every file
that runs after it. `ModuleMocker` spreads the real exports under your
overrides and `clear()` puts the originals back.

```ts
const moduleMocker = new ModuleMocker()
await moduleMocker.mock(path.resolve(import.meta.dir, '../lib/posthog.ts'), () => ({
	captureException: mock()
}))
afterAll(() => moduleMocker.clear())
```

Bun resolves a relative specifier from the file that registers the mock, which
would be hanzio's. Pass absolute paths or package names, or give the
constructor a resolver for your own shorthand:

```ts
const moduleMocker = new ModuleMocker((specifier) =>
	specifier.startsWith('@/') ? path.resolve(srcDir, specifier.slice(2)) : specifier
)
```

## Prisma

`createPrismaMock<Client>(mock)` builds a client where every model method is a
Bun mock created on first access. Register it in place of the module that
exports your client, spreading that module's other exports so they keep
working for every file in the run:

```ts
import { mock } from 'bun:test'
import * as prismaClientExports from '@prisma/client'
import type { prisma } from '../lib/prisma'

export const prismaMock = createPrismaMock<typeof prisma>(mock)
mock.module(path.resolve(import.meta.dir, '../lib/prisma/index.ts'), () => ({
	...prismaClientExports,
	prisma: prismaMock
}))

beforeEach(() => prismaMock.$reset())
prismaMock.user.findUnique.mockResolvedValue({ id: 'u1' })
```

Model and method names are checked against the client type; arguments and
return values are not.

## Window shim

`installWindowShim(href?)` installs a minimal `window` (`location`,
`localStorage`, no-op event listeners) for code that only probes for one, and
returns a reset for `afterEach`. Tests may assign a partial `window`; the shim
keeps the `location`, `localStorage` and listeners from it, because libraries
such as axios and PostHog read them at import time. It deliberately installs no
`document`, which Vue and PrismJS would treat as a full DOM.

```ts
// test-setup.ts, preloaded through bunfig.toml
afterEach(installWindowShim())
```

`createTestStorage()` is the in-memory `Storage` it uses.

## Connection auth contract

`connectionAuthContract` registers the race tests every API client built on
`ConnectionAuthCache` ([`hanzio/api-wrapper/connection-auth`](../api-wrapper/README.md#sharing-a-login-across-clients))
must pass, run through the real client and transport: shared refreshes,
rotated credentials, late 401s, aborted waiters and failed fresh logins.

```ts
await connectionAuthContract({
	reset: () => authCache.clear(),
	create: (fetch, variant) => new ShopApi(credentialsFor(variant), fetch),
	identityChanges: ['apiKey', 'secret'],
	isLogin: (url) => url.endsWith('/oauth/token'),
	loginResponse: (token) => Response.json({ access_token: token, expires_in: 3600 }),
	readResponse: () => Response.json({ items: [] }),
	tokenHeader: 'authorization'
})
```

`create(fetch, variant)` builds a client. `variant` is one of
`identityChanges` (must force a new login), `'settings'` (must reuse it),
`'connection'` (another connection) or `'secret'` (a rotated secret). `read()`
makes one request and, on a 401, calls `reject` and retries once; `login()`
forces a fresh login.

## Small helpers

```ts
const input = mockCallArg<CreateUserInput>(createUser) // call 0, argument 0
mockCallArg<boolean>(createUser, 1, 1) // call 1, argument 1

runJob({ logger: noopLogger }) // trace…fatal discard; bind/child return itself
```
