type CacheEntry<T> = {
	value: T
	timestamp: number
}

type AnyFunction = (...args: never[]) => unknown
type CachedFunction<T extends AnyFunction> = {
	(...args: Parameters<T>): ReturnType<T>
	clearCache: () => void
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
}

export function cacheFunction<T extends AnyFunction>(
	options: CacheFunctionOptions<T>
): CachedFunction<T> {
	const {
		name,
		fn,
		cacheTimeMs = 10 * 60 * 1000,
		refreshInBackground = false,
		cacheKeyArgs,
		cacheKeyFn,
		onBackgroundRefreshError,
		store,
		onStoreError
	} = options

	const externalStore = store as CacheStore | undefined

	const cache = new Map<string, CacheEntry<ReturnType<T>>>()
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
		return `${name}:${JSON.stringify(keyArgs)}`
	}

	const saveEntry = (key: string, value: ReturnType<T>) => {
		cache.set(key, { value, timestamp: Date.now() })
		ensureCleanup()
	}

	const fetchAndPopulate = (
		key: string,
		args: Parameters<T>
	): ReturnType<T> => {
		const result = fn(...args)

		if (!isPromiseLike(result)) {
			saveEntry(key, result as ReturnType<T>)
			return result as ReturnType<T>
		}

		const promise = (result as Promise<ReturnType<T>>)
			.then((value) => {
				saveEntry(key, value)
				pendingPromises.delete(key)
				return value
			})
			.catch((error: unknown) => {
				pendingPromises.delete(key)
				throw error
			})

		pendingPromises.set(key, promise)
		return promise as ReturnType<T>
	}

	const startBackgroundRefresh = (
		key: string,
		args: Parameters<T>,
		staleValue: ReturnType<T>
	) => {
		const result = fn(...args)

		if (!isPromiseLike(result)) {
			saveEntry(key, result as ReturnType<T>)
			return
		}

		const promise = (result as Promise<ReturnType<T>>)
			.then((value) => {
				saveEntry(key, value)
				pendingPromises.delete(key)
				return value
			})
			.catch((error: unknown) => {
				pendingPromises.delete(key)
				onBackgroundRefreshError?.(error, { name })
				// Anyone awaiting this promise gets the stale value instead of
				// undefined or a rejection.
				return staleValue
			})

		pendingPromises.set(key, promise)
	}

	const saveToStore = async (
		cacheStore: CacheStore,
		key: string,
		value: unknown
	) => {
		try {
			await cacheStore.set(
				key,
				{ value, timestamp: Date.now() },
				entryLifetimeMs
			)
		} catch (error) {
			onStoreError?.(error, { name })
		}
	}

	const callWithStore = (
		cacheStore: CacheStore,
		args: Parameters<T>
	): Promise<unknown> => {
		const key = buildKey(args)

		const pending = pendingPromises.get(key)
		// Background refresh callers can still use an entry from the store.
		if (pending && !refreshInBackground) {
			return pending
		}

		return (async () => {
			let entry: CacheStoreEntry | undefined
			try {
				entry = await cacheStore.get(key)
			} catch (error) {
				onStoreError?.(error, { name })
			}

			if (entry) {
				const isFresh = Date.now() - entry.timestamp < cacheTimeMs

				if (isFresh) {
					return entry.value
				}

				if (refreshInBackground) {
					if (!pendingPromises.has(key)) {
						const staleValue = entry.value
						const refresh = (fn(...args) as Promise<unknown>)
							.then(async (value) => {
								await saveToStore(cacheStore, key, value)
								pendingPromises.delete(key)
								return value
							})
							.catch((error: unknown) => {
								pendingPromises.delete(key)
								onBackgroundRefreshError?.(error, { name })
								return staleValue
							})
						pendingPromises.set(key, refresh)
					}
					return entry.value
				}

				try {
					await cacheStore.delete(key)
				} catch (error) {
					onStoreError?.(error, { name })
				}
			}

			// A concurrent caller may have started a fetch while we awaited the
			// store lookup.
			const existing = pendingPromises.get(key)
			if (existing) {
				return existing
			}

			const promise = (fn(...args) as Promise<unknown>)
				.then(async (value) => {
					await saveToStore(cacheStore, key, value)
					pendingPromises.delete(key)
					return value
				})
				.catch((error: unknown) => {
					pendingPromises.delete(key)
					throw error
				})

			pendingPromises.set(key, promise)
			return promise
		})()
	}

	const wrappedFn = (...args: Parameters<T>): ReturnType<T> => {
		if (externalStore) {
			return callWithStore(externalStore, args) as ReturnType<T>
		}

		const key = buildKey(args)
		const cached = cache.get(key)

		if (cached) {
			const isFresh = Date.now() - cached.timestamp < cacheTimeMs

			if (isFresh) {
				return cached.value
			}

			if (refreshInBackground) {
				if (!pendingPromises.has(key)) {
					startBackgroundRefresh(key, args, cached.value)
				}
				return cached.value
			}

			cache.delete(key)
		}

		const pending = pendingPromises.get(key)
		if (pending) {
			return pending as ReturnType<T>
		}

		return fetchAndPopulate(key, args)
	}

	wrappedFn.clearCache = () => {
		cache.clear()
		pendingPromises.clear()
		stopCleanup()
		if (externalStore?.clear) {
			externalStore.clear().catch((error: unknown) => {
				onStoreError?.(error, { name })
			})
		}
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
