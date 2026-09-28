type Entry = {
	value?: unknown
	hasValue: boolean
	expiresAt?: number
	/** `expiresAt - staleMarginMs`: getOrSet refreshes from here on. */
	refreshAt?: number
	inflight?: Promise<unknown>
}

export type CacheSetOptions<T = unknown> = {
	/** Lifetime of the entry; a function derives it from the value (e.g. a token's `expires_in`). */
	ttlMs?: number | ((value: T) => number)
	/** getOrSet recomputes this long before expiry; get still returns the entry until it expires. */
	staleMarginMs?: number
}

export type CreateCacheOptions = {
	/** TTL used when a call doesn't pass `ttlMs` (default: no expiry). */
	defaultTtlMs?: number
	/** `staleMarginMs` used when a call doesn't pass one (default: 0). */
	staleMarginMs?: number
	/** Evicts the least recently used entry beyond this size (default: unbounded). */
	maxEntries?: number
	/** Clock, for tests (default: `Date.now`). */
	now?: () => number
}

export type KeyValueCache = {
	/**
	 * Get-or-compute. Concurrent callers share one in-flight call; rejections
	 * aren't cached (a stale value stays readable until it expires).
	 */
	getOrSet<T>(
		key: string,
		fn: () => Promise<T> | T,
		options?: CacheSetOptions<T>
	): Promise<T>
	get<T>(key: string): T | undefined
	has(key: string): boolean
	set<T>(key: string, value: T, options?: CacheSetOptions<T>): void
	delete(key: string): void
	clear(): void
	readonly size: number
}

/** A small in-memory key/value cache with TTL, LRU bound and in-flight dedupe. */
export function createCache(options: CreateCacheOptions = {}): KeyValueCache {
	const {
		defaultTtlMs,
		staleMarginMs: defaultStaleMarginMs = 0,
		maxEntries,
		now = Date.now
	} = options
	const store = new Map<string, Entry>()

	// Stores `value` on `entry` with an expiry counted from `startedAt`.
	const fill = <T>(
		entry: Entry,
		value: T,
		startedAt: number,
		setOptions: CacheSetOptions<T> = {}
	) => {
		const { ttlMs = defaultTtlMs, staleMarginMs = defaultStaleMarginMs } =
			setOptions
		const ttl = typeof ttlMs === 'function' ? ttlMs(value) : ttlMs
		entry.value = value
		entry.hasValue = true
		entry.expiresAt = ttl === undefined ? undefined : startedAt + ttl
		entry.refreshAt =
			entry.expiresAt === undefined
				? undefined
				: entry.expiresAt - staleMarginMs
		return entry
	}

	const isExpired = (entry: Entry) =>
		entry.expiresAt !== undefined && entry.expiresAt <= now()

	const hasFreshValue = (entry: Entry | undefined) =>
		entry?.hasValue === true && !isExpired(entry)

	// Map keeps insertion order, so re-inserting on access makes the first key
	// the least recently used.
	const touch = (key: string, entry: Entry) => {
		store.delete(key)
		store.set(key, entry)
		if (maxEntries !== undefined) {
			while (store.size > maxEntries) {
				store.delete(store.keys().next().value as string)
			}
		}
	}

	const read = (key: string): Entry | undefined => {
		const entry = store.get(key)
		if (!entry) return undefined
		if (isExpired(entry) && !entry.inflight) {
			store.delete(key)
			return undefined
		}
		touch(key, entry)
		return entry
	}

	return {
		async getOrSet<T>(
			key: string,
			fn: () => Promise<T> | T,
			setOptions?: CacheSetOptions<T>
		): Promise<T> {
			const existing = read(key)
			if (existing?.inflight) return existing.inflight as Promise<T>
			const isStale =
				existing?.refreshAt !== undefined && existing.refreshAt <= now()
			if (existing?.hasValue && !isStale) return existing.value as T

			// Refresh in place so get() keeps serving a stale value meanwhile.
			const entry: Entry = existing ?? { hasValue: false }
			const startedAt = now()
			const promise = (async () => fn())()
			entry.inflight = promise
			touch(key, entry)

			try {
				const value = await promise
				fill(entry, value, startedAt, setOptions)
				return value
			} catch (error) {
				if (!hasFreshValue(entry) && store.get(key) === entry) {
					store.delete(key)
				}
				throw error
			} finally {
				entry.inflight = undefined
			}
		},
		get<T>(key: string): T | undefined {
			const entry = read(key)
			return hasFreshValue(entry) ? (entry?.value as T) : undefined
		},
		has(key: string): boolean {
			return hasFreshValue(read(key))
		},
		set<T>(key: string, value: T, setOptions?: CacheSetOptions<T>): void {
			touch(key, fill({ hasValue: false }, value, now(), setOptions))
		},
		delete(key: string): void {
			store.delete(key)
		},
		clear(): void {
			store.clear()
		},
		get size() {
			return store.size
		}
	}
}
