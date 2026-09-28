import { createCache } from '../cache/createCache'
import type { ActionCache, DefineAction } from './types'

export function createActionCache(): ActionCache {
	const store = createCache()
	const cache = (<T>(
		key: string,
		fn: () => Promise<T> | T,
		options?: { ttlMs?: number }
	): Promise<T> => store.getOrSet(key, fn, options)) as ActionCache

	cache.get = (key) => store.get(key)
	cache.set = (key, value, options) => store.set(key, value, options)
	cache.invalidate = (key) => store.delete(key)
	cache.clear = () => store.clear()

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
		const def = args[0] as { handler: unknown; input?: unknown }
		return {
			...def,
			// A schema-validated action takes input; a bare handler doesn't.
			noRuntimeInput: def.input === undefined
		}
	}
	return defineAction as DefineAction<TApi>
}

// biome-ignore lint/suspicious/noExplicitAny: top-level form keeps ctx.api as any
export const defineAction: DefineAction<any> = makeDefineAction<any>()
