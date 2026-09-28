/** The part of the Web `Storage` API (`localStorage`, `sessionStorage`) used here. */
export interface SyncStorageLike {
	getItem(key: string): string | null
	setItem(key: string, value: string): void
	removeItem(key: string): void
}

/** An async key-value store such as React Native's `AsyncStorage`. */
export interface AsyncStorageLike {
	getItem(key: string): Promise<string | null>
	setItem(key: string, value: string): Promise<void>
	removeItem(key: string): Promise<void>
}

export interface StorageItemOptions<T> {
	key: string
	/** Returned when nothing is stored or the stored value can't be read. */
	fallback: T
	/** Validates the deserialized value, e.g. `schema.parse`. Throwing means `fallback`. */
	parse?: (raw: unknown) => T
	/** Defaults to `JSON.stringify`. */
	serialize?: (value: T) => string
	/** Defaults to `JSON.parse`. */
	deserialize?: (raw: string) => unknown
}

export interface StorageItem<T> {
	readonly key: string
	get(): T
	set(value: T): void
	remove(): void
	/**
	 * Calls `listener` when another tab changes this key (the `storage` event).
	 * A no-op outside browsers. Returns an unsubscribe function.
	 */
	subscribe(listener: (value: T) => void): () => void
}

export interface AsyncStorageItem<T> {
	readonly key: string
	get(): Promise<T>
	set(value: T): Promise<void>
	remove(): Promise<void>
}

/** A `Map`-backed `SyncStorageLike`, for tests, SSR, or as a stand-in. */
export function createMemoryStorage(): SyncStorageLike {
	const map = new Map<string, string>()
	return {
		getItem: (key) => map.get(key) ?? null,
		setItem: (key, value) => {
			map.set(key, String(value))
		},
		removeItem: (key) => {
			map.delete(key)
		}
	}
}

type StorageEventLike = { key: string | null; storageArea: unknown }
type EventTargetLike = Record<
	'addEventListener' | 'removeEventListener',
	(type: 'storage', listener: (event: StorageEventLike) => void) => void
>

let sharedMemoryStorage: SyncStorageLike | undefined

// Reading `localStorage` itself throws in sandboxed iframes and some private modes.
function defaultStorage(): SyncStorageLike {
	try {
		const storage = (globalThis as { localStorage?: SyncStorageLike })
			.localStorage
		if (storage) return storage
	} catch {}
	sharedMemoryStorage ??= createMemoryStorage()
	return sharedMemoryStorage
}

function createCodec<T>(options: StorageItemOptions<T>) {
	const {
		fallback,
		parse = (raw) => raw as T,
		serialize = JSON.stringify,
		deserialize = JSON.parse
	} = options
	return {
		serialize,
		decode(raw: string | null): T {
			if (raw === null) return fallback
			try {
				return parse(deserialize(raw))
			} catch {
				return fallback
			}
		}
	}
}

/**
 * A typed value persisted in `localStorage` (or any `SyncStorageLike`). Never
 * throws: missing, corrupt or invalid data reads as `fallback`, and when the
 * storage throws (quota, Safari private mode, sandboxed iframes) the latest
 * value is kept in memory for this item, so reads stay consistent this session.
 */
export function createStorageItem<T>(
	options: StorageItemOptions<T> & { storage?: SyncStorageLike }
): StorageItem<T> {
	const { key, fallback, storage = defaultStorage() } = options
	const { serialize, decode } = createCodec(options)
	// Set when a write failed; wins over whatever the storage still holds.
	let mirror: { value: T } | undefined

	const write = (value: T, action: () => void) => {
		try {
			action()
			mirror = undefined
		} catch {
			mirror = { value }
		}
	}

	const get = () => {
		if (mirror) return mirror.value
		try {
			return decode(storage.getItem(key))
		} catch {
			return fallback
		}
	}

	return {
		key,
		get,
		set: (value) => write(value, () => storage.setItem(key, serialize(value))),
		remove: () => write(fallback, () => storage.removeItem(key)),
		subscribe(listener) {
			const target = globalThis as unknown as Partial<EventTargetLike>
			if (!target.addEventListener || !target.removeEventListener) {
				return () => {}
			}
			const onStorage = (event: StorageEventLike) => {
				// `key` is null when the other tab called `storage.clear()`.
				if (event.storageArea !== storage) return
				if (event.key !== key && event.key !== null) return
				mirror = undefined
				listener(get())
			}
			target.addEventListener('storage', onStorage)
			return () => target.removeEventListener?.('storage', onStorage)
		}
	}
}

/**
 * `createStorageItem` for async stores such as React Native's `AsyncStorage`.
 * Never rejects; same fallback and in-memory mirror behavior.
 */
export function createAsyncStorageItem<T>(
	options: StorageItemOptions<T> & { storage: AsyncStorageLike }
): AsyncStorageItem<T> {
	const { key, fallback, storage } = options
	const { serialize, decode } = createCodec(options)
	let mirror: { value: T } | undefined

	const write = async (value: T, action: () => Promise<void>) => {
		try {
			await action()
			mirror = undefined
		} catch {
			mirror = { value }
		}
	}

	return {
		key,
		async get() {
			if (mirror) return mirror.value
			try {
				return decode(await storage.getItem(key))
			} catch {
				return fallback
			}
		},
		set: (value) => write(value, () => storage.setItem(key, serialize(value))),
		remove: () => write(fallback, () => storage.removeItem(key))
	}
}
