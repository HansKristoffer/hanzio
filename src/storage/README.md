---
description: Typed persisted values over localStorage/sessionStorage or async stores like React Native AsyncStorage, with fallbacks that never throw.
---

# hanzio/storage

`createStorageItem` wraps one key in `localStorage` (or any `SyncStorageLike`) as a typed value. It never throws:

- A missing, corrupt (bad JSON) or invalid (`parse` throws) value reads as `fallback`.
- When the storage throws (quota exceeded, Safari private mode, sandboxed iframes), the latest `set`/`remove` is kept in memory for that item, so reads stay consistent for the session.
- Without an accessible `globalThis.localStorage` (SSR, Node, Bun, blocked access) it uses a shared in-memory store.

```ts
import { z } from 'zod'
import { createStorageItem } from 'hanzio/storage'

const PanelPrefs = z.object({ open: z.boolean(), width: z.number() })

const panelPrefs = createStorageItem({
	key: 'panel-prefs',
	fallback: { open: false, width: 320 },
	parse: PanelPrefs.parse
})

panelPrefs.get() // { open: false, width: 320 }
panelPrefs.set({ open: true, width: 400 })
panelPrefs.remove()

// Another tab changed it (the `storage` event). Returns an unsubscribe function.
const stop = panelPrefs.subscribe((prefs) => console.log(prefs))
```

Use `sessionStorage` or plain strings:

```ts
const sendOnEnter = createStorageItem({
	key: 'send-on-enter',
	fallback: false,
	storage: sessionStorage,
	serialize: String,
	deserialize: (raw) => raw === 'true'
})
```

## Async stores

`createAsyncStorageItem` takes the same options, but `storage` is required and the methods return promises. It never rejects.

```ts
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createAsyncStorageItem } from 'hanzio/storage'

const readIds = createAsyncStorageItem({
	key: '@notification_read_session_ids',
	fallback: [] as string[],
	storage: AsyncStorage,
	parse: z.array(z.string()).parse
})

await readIds.set([...(await readIds.get()), 'abc'])
```

## API

| Export | Description |
| --- | --- |
| `createStorageItem(options)` | `{ key, get, set, remove, subscribe }` over a `SyncStorageLike` (default `localStorage`). |
| `createAsyncStorageItem(options)` | `{ key, get, set, remove }` over an `AsyncStorageLike`. |
| `createMemoryStorage()` | A `Map`-backed `SyncStorageLike`, for tests and SSR. |

Options: `key`, `fallback`, `storage`, `parse` (validate the deserialized value; throwing means `fallback`), `serialize` (default `JSON.stringify`), `deserialize` (default `JSON.parse`).
