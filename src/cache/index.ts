import { stableStringify } from '../string'

type AnyFunction = (...args: never[]) => unknown
type CachedFunction<
	T extends AnyFunction,
	TPeek = Awaited<ReturnType<T>> | undefined
> = {
	(...args: Parameters<T>): ReturnType<T>
	clearCache: () => void
	/** Drops the entry (and any in-flight call) for these arguments. */
	invalidate: (...args: Parameters<T>) => void
	/**
	 * What a call would return from the cache right now (including a stale
	 * value with refreshInBackground), without calling fn, starting a refresh
	 * or counting as a use for maxEntries. `undefined` on a miss. With a
	 * `store` this reads the store and returns a Promise.
	 */
	peek: (...args: Parameters<T>) => TPeek
}

export type CacheStoreEntry = {
	value: unknown
	timestamp: number
}

/**
 * Contract for external cache stores (e.g. a Redis adapter).
 * Serialization is the adapter's responsibility; this library never imports
 * the underlying client.
 */
export type CacheStore = {
	get: (key: string) => Promise<CacheStoreEntry | undefined>
	/** `ttlMs` maps to the store's native expiry (e.g. Redis `PX`). */
	set: (key: string, entry: CacheStoreEntry, ttlMs: number) => Promise<void>
	delete: (key: string) => Promise<void>
	/** Optional; called by clearCache when defined. */
	clear?: () => Promise<void>
}

export type CacheFunctionOptions<T extends AnyFunction> = {
	name: string
	fn: T
	cacheTimeMs?: number
	refreshInBackground?: boolean
	cacheKeyArgs?: number[]
	cacheKeyFn?: (...args: Parameters<T>) => unknown[]
	/** Called when a background refresh fails (default: silent). */
	onBackgroundRefreshError?: (error: unknown, context: { name: string }) => void
	/**
	 * External cache store (e.g. a Redis adapter). Only supported for async
	 * functions; when omitted the built-in in-memory cache is used.
	 */
	store?: ReturnType<T> extends Promise<unknown> ? CacheStore : never
	/** Called when a store get/set/delete/clear fails (default: silent). */
	onStoreError?: (error: unknown, context: { name: string }) => void
	/**
	 * Evicts the least recently used entry beyond this many entries (default:
	 * unbounded). Applies to the in-memory cache only.
	 */
	maxEntries?: number
}

export function cacheFunction<T extends AnyFunction>(
	options: CacheFunctionOptions<T> & { store: CacheStore }
): CachedFunction<T, Promise<Awaited<ReturnType<T>> | undefined>>
export function cacheFunction<T extends AnyFunction>(
	options: CacheFunctionOptions<T>
): CachedFunction<T>
export function cacheFunction<T extends AnyFunction>(
	options: CacheFunctionOptions<T>
): CachedFunction<T, unknown> {
	const {
		name,
		fn,
		cacheTimeMs = 10 * 60 * 1000,
		refreshInBackground = false,
		cacheKeyArgs,
		cacheKeyFn,
		onBackgroundRefreshError,
		store,
		onStoreError,
		maxEntries
	} = options

	const externalStore = store as CacheStore | undefined

	const cache = new Map<string, CacheStoreEntry>()
	const pendingPromises = new Map<string, Promise<unknown>>()

	// Stale entries are kept for an extra TTL so refreshInBackground can serve
	// them while revalidating.
	const entryLifetimeMs = refreshInBackground ? cacheTimeMs * 2 : cacheTimeMs

	let cleanupInterval: ReturnType<typeof setInterval> | undefined

	const stopCleanup = () => {
		if (cleanupInterval !== undefined) {
			clearInterval(cleanupInterval)
			cleanupInterval = undefined
		}
	}

	// Created lazily on first write and unref'd so it never keeps the process
	// alive. Stops itself once the cache is empty and restarts on the next
	// write, so clearCache does not permanently disable sweeping.
	const ensureCleanup = () => {
		if (cleanupInterval !== undefined) {
			return
		}
		cleanupInterval = setInterval(
			() => {
				const now = Date.now()
				for (const [key, entry] of cache.entries()) {
					if (now - entry.timestamp >= entryLifetimeMs) {
						cache.delete(key)
					}
				}
				if (cache.size === 0) {
					stopCleanup()
				}
			},
			Math.min(cacheTimeMs / 2, 5 * 60 * 1000)
		)
		cleanupInterval.unref?.()
	}

	const buildKey = (args: Parameters<T>): string => {
		const keyArgs = cacheKeyFn
			? cacheKeyFn(...args)
			: cacheKeyArgs
				? cacheKeyArgs.map((i) => args[i])
				: args
		return `${name}:${stableStringify(keyArgs)}`
	}

	const isFresh = (entry: CacheStoreEntry) =>
		Date.now() - entry.timestamp < cacheTimeMs

	// The value a call would return straight from the cache, if any.
	const servable = (entry: CacheStoreEntry | undefined) =>
		entry && (refreshInBackground || isFresh(entry)) ? entry : undefined

	// Map keeps insertion order, so re-inserting on every hit and write makes
	// the first key the least recently used.
	const touch = (key: string, entry: CacheStoreEntry) => {
		cache.delete(key)
		cache.set(key, entry)
		if (maxEntries !== undefined && cache.size > maxEntries) {
			cache.delete(cache.keys().next().value as string)
		}
	}

	const guardStore = async <R>(
		operation: () => Promise<R>
	): Promise<R | undefined> => {
		try {
			return await operation()
		} catch (error) {
			onStoreError?.(error, { name })
			return undefined
		}
	}

	const save = (key: string, value: unknown) => {
		const entry = { value, timestamp: Date.now() }
		if (externalStore) {
			return guardStore(() => externalStore.set(key, entry, entryLifetimeMs))
		}
		touch(key, entry)
		ensureCleanup()
	}

	// Calls fn and saves the result. Async calls are tracked in
	// pendingPromises for dedupe. A failed background refresh (`stale` given)
	// resolves to the stale value instead of rejecting.
	const run = (
		key: string,
		args: Parameters<T>,
		stale?: CacheStoreEntry
	): unknown => {
		const result = fn(...args)

		if (!isPromiseLike(result)) {
			save(key, result)
			return result
		}

		const promise: Promise<unknown> = Promise.resolve(result)
			.then(
				async (value) => {
					// Skip the save when invalidate/clearCache ran meanwhile.
					if (pendingPromises.get(key) === promise) {
						await save(key, value)
					}
					return value
				},
				(error: unknown) => {
					if (!stale) throw error
					onBackgroundRefreshError?.(error, { name })
					return stale.value
				}
			)
			.finally(() => {
				if (pendingPromises.get(key) === promise) {
					pendingPromises.delete(key)
				}
			})

		pendingPromises.set(key, promise)
		return promise
	}

	// Serves a cached entry, starting a background refresh when it is stale.
	const serve = (key: string, args: Parameters<T>, entry: CacheStoreEntry) => {
		if (!isFresh(entry) && !pendingPromises.has(key)) {
			run(key, args, entry)
		}
		return entry.value
	}

	const callWithStore = (
		cacheStore: CacheStore,
		key: string,
		args: Parameters<T>
	): Promise<unknown> => {
		const pending = pendingPromises.get(key)
		// Background refresh callers can still use an entry from the store.
		if (pending && !refreshInBackground) {
			return pending
		}

		return (async () => {
			const entry = await guardStore(() => cacheStore.get(key))
			const cached = servable(entry)

			if (cached) {
				return serve(key, args, cached)
			}
			if (entry) {
				await guardStore(() => cacheStore.delete(key))
			}

			// A concurrent caller may have started a fetch while we awaited the
			// store lookup.
			return pendingPromises.get(key) ?? run(key, args)
		})()
	}

	const wrappedFn = (...args: Parameters<T>): ReturnType<T> => {
		const key = buildKey(args)

		if (externalStore) {
			return callWithStore(externalStore, key, args) as ReturnType<T>
		}

		const cached = servable(cache.get(key))
		if (cached) {
			touch(key, cached)
			return serve(key, args, cached) as ReturnType<T>
		}
		cache.delete(key)

		return (pendingPromises.get(key) ?? run(key, args)) as ReturnType<T>
	}

	wrappedFn.clearCache = () => {
		cache.clear()
		pendingPromises.clear()
		stopCleanup()
		const clearStore = externalStore?.clear?.bind(externalStore)
		if (clearStore) {
			void guardStore(clearStore)
		}
	}

	wrappedFn.invalidate = (...args: Parameters<T>) => {
		const key = buildKey(args)
		cache.delete(key)
		pendingPromises.delete(key)
		if (externalStore) {
			void guardStore(() => externalStore.delete(key))
		}
	}

	wrappedFn.peek = (...args: Parameters<T>): unknown => {
		const key = buildKey(args)
		if (externalStore) {
			return guardStore(() => externalStore.get(key)).then(
				(entry) => servable(entry)?.value
			)
		}
		return servable(cache.get(key))?.value
	}

	return wrappedFn
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		'then' in value &&
		typeof value.then === 'function'
	)
}
export * from './createCache'
