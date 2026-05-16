import type { ActionCache, DefineAction } from './types'

type CacheEntry = {
	value?: unknown
	hasValue: boolean
	expiresAt?: number
	inflight?: Promise<unknown>
}

export function createActionCache(): ActionCache {
	const store = new Map<string, CacheEntry>()

	const isExpired = (entry: CacheEntry) =>
		entry.expiresAt !== undefined && entry.expiresAt <= Date.now()

	const cache = (async <T>(
		key: string,
		fn: () => Promise<T> | T,
		options?: { ttlMs?: number }
	): Promise<T> => {
		const existing = store.get(key)
		if (existing && !isExpired(existing)) {
			if (existing.inflight) return existing.inflight as Promise<T>
			if (existing.hasValue) return existing.value as T
		}

		const promise = (async () => fn())()
		const entry: CacheEntry = {
			hasValue: false,
			inflight: promise,
			expiresAt:
				options?.ttlMs !== undefined ? Date.now() + options.ttlMs : undefined
		}
		store.set(key, entry)

		try {
			const value = await promise
			entry.value = value
			entry.hasValue = true
			entry.inflight = undefined
			return value
		} catch (error) {
			store.delete(key)
			throw error
		}
	}) as ActionCache

	cache.get = <T>(key: string): T | undefined => {
		const entry = store.get(key)
		if (!entry || !entry.hasValue) return undefined
		if (isExpired(entry)) {
			store.delete(key)
			return undefined
		}
		return entry.value as T
	}

	cache.set = <T>(
		key: string,
		value: T,
		options?: { ttlMs?: number }
	): void => {
		store.set(key, {
			value,
			hasValue: true,
			expiresAt:
				options?.ttlMs !== undefined ? Date.now() + options.ttlMs : undefined
		})
	}

	cache.invalidate = (key: string): void => {
		store.delete(key)
	}

	cache.clear = (): void => {
		store.clear()
	}

	return cache
}

export function makeDefineAction<TApi>(): DefineAction<TApi> {
	function defineAction(...args: unknown[]): unknown {
		if (args.length === 0) {
			return (def: { handler: unknown }) => ({
				...def,
				noRuntimeInput: false as const
			})
		}
		const def = args[0] as { handler: unknown }
		return {
			...def,
			noRuntimeInput: true as const
		}
	}
	return defineAction as DefineAction<TApi>
}

// biome-ignore lint/suspicious/noExplicitAny: top-level form keeps ctx.api as any
export const defineAction: DefineAction<any> = makeDefineAction<any>()
