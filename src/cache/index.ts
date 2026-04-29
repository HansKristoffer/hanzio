type CacheEntry<T> = {
	value: T
	timestamp: number
}

type AnyFunction = (...args: never[]) => unknown
type CachedFunction<T extends AnyFunction> = {
	(...args: Parameters<T>): ReturnType<T>
	clearCache: () => void
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
		onBackgroundRefreshError
	} = options

	const cache = new Map<string, CacheEntry<ReturnType<T>>>()
	const pendingPromises = new Map<string, Promise<unknown>>()

	const cleanupInterval = setInterval(
		() => {
			const now = Date.now()
			for (const [key, entry] of cache.entries()) {
				if (now - entry.timestamp >= cacheTimeMs) {
					cache.delete(key)
				}
			}
		},
		Math.min(cacheTimeMs / 2, 5 * 60 * 1000)
	)

	const wrappedFn = (...args: Parameters<T>): ReturnType<T> => {
		const keyArgs = cacheKeyFn
			? cacheKeyFn(...args)
			: cacheKeyArgs
				? cacheKeyArgs.map((i) => args[i])
				: args
		const key = `${name}:${JSON.stringify(keyArgs)}`
		const now = Date.now()

		const pending = pendingPromises.get(key)
		if (pending) {
			return pending as ReturnType<T>
		}

		const cached = cache.get(key)

		if (cached) {
			const isCacheFresh = now - cached.timestamp < cacheTimeMs

			if (!isCacheFresh && !refreshInBackground) {
				cache.delete(key)
			} else {
				if (isCacheFresh && !refreshInBackground) {
					return cached.value
				}

				if (refreshInBackground) {
					const existingPending = pendingPromises.get(key)
					if (existingPending) {
						return existingPending as ReturnType<T>
					}

					const backgroundUpdate = fn(...args)

					if (isPromiseLike(backgroundUpdate)) {
						const backgroundPromise = (
							backgroundUpdate as Promise<ReturnType<T>>
						)
							.then((resolvedValue) => {
								cache.set(key, { value: resolvedValue, timestamp: now })
								pendingPromises.delete(key)
								return resolvedValue
							})
							.catch((error: unknown) => {
								pendingPromises.delete(key)
								onBackgroundRefreshError?.(error, { name })
							})

						pendingPromises.set(key, backgroundPromise)
					} else {
						cache.set(key, {
							value: backgroundUpdate as ReturnType<T>,
							timestamp: now
						})
					}

					return cached.value
				}

				if (isCacheFresh) {
					return cached.value
				}
			}
		}

		const result = fn(...args)

		if (isPromiseLike(result)) {
			const promise = (result as Promise<ReturnType<T>>)
				.then((resolvedValue) => {
					cache.set(key, { value: resolvedValue, timestamp: now })
					pendingPromises.delete(key)
					return resolvedValue
				})
				.catch((error) => {
					pendingPromises.delete(key)
					throw error
				})

			pendingPromises.set(key, promise)
			return promise as ReturnType<T>
		}

		cache.set(key, { value: result as ReturnType<T>, timestamp: now })
		return result as ReturnType<T>
	}

	wrappedFn.clearCache = () => {
		cache.clear()
		pendingPromises.clear()
		clearInterval(cleanupInterval)
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
