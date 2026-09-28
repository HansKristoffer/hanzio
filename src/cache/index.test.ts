import { describe, expect, spyOn, test } from 'bun:test'
import { type CacheStore, type CacheStoreEntry, cacheFunction } from '.'

describe('cacheFunction', () => {
	describe('basic caching', () => {
		test('preserves wrapped function parameters and return type', () => {
			const cached = cacheFunction({
				name: 'type-test',
				fn: (id: string, count: number) => ({ id, count })
			})

			const result: { id: string; count: number } = cached('a', 1)

			// @ts-expect-error wrapped function keeps the original parameter types.
			cached(1, 'a')

			expect(result).toEqual({ id: 'a', count: 1 })
			cached.clearCache()
		})

		test('caches function result', async () => {
			let callCount = 0
			const fn = async (id: string) => {
				callCount++
				return `result-${id}`
			}

			const cached = cacheFunction({
				name: 'test',
				fn,
				cacheTimeMs: 1000
			})

			const result1 = await cached('123')
			const result2 = await cached('123')

			expect(result1).toBe('result-123')
			expect(result2).toBe('result-123')
			expect(callCount).toBe(1)

			cached.clearCache()
		})

		test('different arguments get different cache entries', async () => {
			let callCount = 0
			const fn = async (id: string) => {
				callCount++
				return `result-${id}`
			}

			const cached = cacheFunction({
				name: 'test-args',
				fn,
				cacheTimeMs: 1000
			})

			const result1 = await cached('a')
			const result2 = await cached('b')
			const result3 = await cached('a')

			expect(result1).toBe('result-a')
			expect(result2).toBe('result-b')
			expect(result3).toBe('result-a')
			expect(callCount).toBe(2)

			cached.clearCache()
		})

		test('works with synchronous functions', () => {
			let callCount = 0
			const fn = (x: number) => {
				callCount++
				return x * 2
			}

			const cached = cacheFunction({
				name: 'sync-test',
				fn,
				cacheTimeMs: 1000
			})

			const result1 = cached(5)
			const result2 = cached(5)

			expect(result1).toBe(10)
			expect(result2).toBe(10)
			expect(callCount).toBe(1)

			cached.clearCache()
		})
	})

	describe('request deduplication', () => {
		test('concurrent calls share the same promise', async () => {
			let callCount = 0
			const fn = async (id: string) => {
				callCount++
				await new Promise((r) => setTimeout(r, 50))
				return `result-${id}`
			}

			const cached = cacheFunction({
				name: 'dedup-test',
				fn,
				cacheTimeMs: 1000
			})

			const promises = Array.from({ length: 100 }, () => cached('same-id'))
			const results = await Promise.all(promises)

			expect(results.every((r) => r === 'result-same-id')).toBe(true)
			expect(callCount).toBe(1)

			cached.clearCache()
		})
	})

	describe('cache expiration', () => {
		test('cache expires after cacheTimeMs', async () => {
			let callCount = 0
			const fn = async () => {
				callCount++
				return `call-${callCount}`
			}

			const cached = cacheFunction({
				name: 'expire-test',
				fn,
				cacheTimeMs: 50
			})

			const result1 = await cached()
			expect(result1).toBe('call-1')
			expect(callCount).toBe(1)

			await new Promise((r) => setTimeout(r, 60))

			const result2 = await cached()
			expect(result2).toBe('call-2')
			expect(callCount).toBe(2)

			cached.clearCache()
		})
	})

	describe('refreshInBackground', () => {
		test('does not refresh while the entry is fresh', async () => {
			let callCount = 0
			const fn = async () => {
				callCount++
				return `call-${callCount}`
			}

			const cached = cacheFunction({
				name: 'swr-fresh-test',
				fn,
				cacheTimeMs: 1000,
				refreshInBackground: true
			})

			const result1 = await cached()
			expect(result1).toBe('call-1')

			const result2 = await cached()
			expect(result2).toBe('call-1')

			await new Promise((r) => setTimeout(r, 10))

			expect(callCount).toBe(1)

			cached.clearCache()
		})

		test('returns stale data and refreshes in background once stale', async () => {
			let callCount = 0
			const fn = async () => {
				callCount++
				return `call-${callCount}`
			}

			const cached = cacheFunction({
				name: 'swr-test',
				fn,
				cacheTimeMs: 50,
				refreshInBackground: true
			})

			const result1 = await cached()
			expect(result1).toBe('call-1')
			expect(callCount).toBe(1)

			await new Promise((r) => setTimeout(r, 60))

			const result2 = await cached()
			expect(result2).toBe('call-1')

			await new Promise((r) => setTimeout(r, 10))
			expect(callCount).toBe(2)

			const result3 = await cached()
			expect(result3).toBe('call-2')

			cached.clearCache()
		})

		test('serves stale value to concurrent callers during background refresh', async () => {
			let callCount = 0
			const fn = async () => {
				callCount++
				await new Promise((r) => setTimeout(r, 30))
				return `call-${callCount}`
			}

			const cached = cacheFunction({
				name: 'swr-dedup-test',
				fn,
				cacheTimeMs: 50,
				refreshInBackground: true
			})

			await cached()
			expect(callCount).toBe(1)

			await new Promise((r) => setTimeout(r, 60))

			const promises = Array.from({ length: 10 }, () => cached())
			const results = await Promise.all(promises)

			expect(results.every((r) => r === 'call-1')).toBe(true)
			expect(callCount).toBe(2)

			await new Promise((r) => setTimeout(r, 40))
			const fresh = await cached()
			expect(fresh).toBe('call-2')

			cached.clearCache()
		})

		test('background refresh failure keeps serving stale value', async () => {
			const now = spyOn(Date, 'now').mockReturnValue(1000)
			let callCount = 0
			const errors: unknown[] = []
			let refreshFailed = Promise.withResolvers<void>()
			const cached = cacheFunction({
				name: 'swr-error-test',
				fn: async () => {
					callCount++
					if (callCount > 1) throw new Error('refresh failed')
					return 'ok'
				},
				cacheTimeMs: 50,
				refreshInBackground: true,
				onBackgroundRefreshError: (error) => {
					errors.push(error)
					refreshFailed.resolve()
				}
			})

			try {
				expect(await cached()).toBe('ok')
				now.mockReturnValue(1060)
				expect(await cached()).toBe('ok')
				await refreshFailed.promise
				expect(errors.length).toBe(1)

				now.mockReturnValue(1070)
				refreshFailed = Promise.withResolvers<void>()
				expect(await cached()).toBe('ok')
				await refreshFailed.promise
				expect(errors.length).toBe(2)
				expect(callCount).toBe(3)
			} finally {
				cached.clearCache()
				now.mockRestore()
			}
		})

		test('waiters on a failing background refresh get the stale value, not undefined', async () => {
			let callCount = 0
			const fn = async () => {
				callCount++
				if (callCount > 1) {
					await new Promise((r) => setTimeout(r, 100))
					throw new Error('refresh failed')
				}
				return 'ok'
			}

			const cached = cacheFunction({
				name: 'swr-waiter-test',
				fn,
				cacheTimeMs: 30,
				refreshInBackground: true
			})

			await cached()

			// Entry goes stale after 30ms and is swept after 60ms (2x TTL).
			await new Promise((r) => setTimeout(r, 40))
			const stale = await cached()
			expect(stale).toBe('ok')

			// By now the entry has been swept, so this caller picks up the
			// in-flight (failing) refresh promise.
			await new Promise((r) => setTimeout(r, 55))
			const waited = await cached()
			expect(waited).toBe('ok')

			cached.clearCache()
		})
	})

	describe('error handling', () => {
		test('errors are propagated, not cached', async () => {
			let callCount = 0
			const fn = async () => {
				callCount++
				if (callCount === 1) {
					throw new Error('First call fails')
				}
				return 'success'
			}

			const cached = cacheFunction({
				name: 'error-test',
				fn,
				cacheTimeMs: 1000
			})

			await expect(cached()).rejects.toThrow('First call fails')
			expect(callCount).toBe(1)

			const result = await cached()
			expect(result).toBe('success')
			expect(callCount).toBe(2)

			cached.clearCache()
		})
	})

	describe('clearCache', () => {
		test('cache keeps working and expiring after clearCache', async () => {
			let callCount = 0
			const fn = async () => {
				callCount++
				return `call-${callCount}`
			}

			const cached = cacheFunction({
				name: 'clear-reuse-test',
				fn,
				cacheTimeMs: 50
			})

			await cached()
			cached.clearCache()

			const result1 = await cached()
			expect(result1).toBe('call-2')

			const result2 = await cached()
			expect(result2).toBe('call-2')
			expect(callCount).toBe(2)

			await new Promise((r) => setTimeout(r, 60))

			const result3 = await cached()
			expect(result3).toBe('call-3')

			cached.clearCache()
		})

		test('clears all cached entries', async () => {
			let callCount = 0
			const fn = async (_id: string) => {
				callCount++
				return `result-${callCount}`
			}

			const cached = cacheFunction({
				name: 'clear-test',
				fn,
				cacheTimeMs: 10000
			})

			await cached('a')
			await cached('b')
			expect(callCount).toBe(2)

			cached.clearCache()

			await cached('a')
			await cached('b')
			expect(callCount).toBe(4)
		})
	})

	describe('multiple arguments', () => {
		test('handles functions with multiple arguments', async () => {
			let callCount = 0
			const fn = async (a: number, b: string, c: boolean) => {
				callCount++
				return `${a}-${b}-${c}`
			}

			const cached = cacheFunction({
				name: 'multi-args',
				fn,
				cacheTimeMs: 1000
			})

			const result1 = await cached(1, 'hello', true)
			const result2 = await cached(1, 'hello', true)
			const result3 = await cached(1, 'hello', false)

			expect(result1).toBe('1-hello-true')
			expect(result2).toBe('1-hello-true')
			expect(result3).toBe('1-hello-false')
			expect(callCount).toBe(2)

			cached.clearCache()
		})

		test('handles object arguments', async () => {
			let callCount = 0
			const fn = async (obj: { id: string; name: string }) => {
				callCount++
				return `${obj.id}:${obj.name}`
			}

			const cached = cacheFunction({
				name: 'obj-args',
				fn,
				cacheTimeMs: 1000
			})

			const result1 = await cached({ id: '1', name: 'test' })
			const result2 = await cached({ id: '1', name: 'test' })
			const result3 = await cached({ id: '2', name: 'other' })

			expect(result1).toBe('1:test')
			expect(result2).toBe('1:test')
			expect(result3).toBe('2:other')
			expect(callCount).toBe(2)

			cached.clearCache()
		})
	})

	describe('cacheKeyArgs', () => {
		test('uses only specified argument indices for cache key', async () => {
			let callCount = 0
			type Filters = { id: string }
			type Context = { userId: string; timestamp: number }

			const fn = async (filters: Filters, ctx: Context) => {
				callCount++
				return `${filters.id}-${ctx.userId}`
			}

			const cached = cacheFunction({
				name: 'cacheKeyArgs-test',
				fn,
				cacheTimeMs: 1000,
				cacheKeyArgs: [0]
			})

			const result1 = await cached(
				{ id: 'a' },
				{ userId: 'user1', timestamp: 1 }
			)
			const result2 = await cached(
				{ id: 'a' },
				{ userId: 'user2', timestamp: 2 }
			)

			expect(result1).toBe('a-user1')
			expect(result2).toBe('a-user1')
			expect(callCount).toBe(1)

			const result3 = await cached(
				{ id: 'b' },
				{ userId: 'user3', timestamp: 3 }
			)
			expect(result3).toBe('b-user3')
			expect(callCount).toBe(2)

			cached.clearCache()
		})

		test('can use multiple argument indices', async () => {
			let callCount = 0

			const fn = async (a: string, b: number, c: boolean) => {
				callCount++
				return `${a}-${b}-${c}`
			}

			const cached = cacheFunction({
				name: 'cacheKeyArgs-multi',
				fn,
				cacheTimeMs: 1000,
				cacheKeyArgs: [0, 2]
			})

			const result1 = await cached('x', 1, true)
			const result2 = await cached('x', 999, true)

			expect(result1).toBe('x-1-true')
			expect(result2).toBe('x-1-true')
			expect(callCount).toBe(1)

			const result3 = await cached('x', 1, false)
			expect(result3).toBe('x-1-false')
			expect(callCount).toBe(2)

			cached.clearCache()
		})
	})

	describe('cacheKeyFn', () => {
		test('uses function to determine cache key', async () => {
			let callCount = 0
			type Filters = { id: string }
			type Context = { userId: string; timestamp: number }

			const fn = async (filters: Filters, ctx: Context) => {
				callCount++
				return `${filters.id}-${ctx.userId}`
			}

			const cached = cacheFunction({
				name: 'cacheKeyFn-test',
				fn,
				cacheTimeMs: 1000,
				cacheKeyFn: (filters) => [filters]
			})

			const result1 = await cached(
				{ id: 'a' },
				{ userId: 'user1', timestamp: 1 }
			)
			const result2 = await cached(
				{ id: 'a' },
				{ userId: 'user2', timestamp: 2 }
			)

			expect(result1).toBe('a-user1')
			expect(result2).toBe('a-user1')
			expect(callCount).toBe(1)

			const result3 = await cached(
				{ id: 'b' },
				{ userId: 'user3', timestamp: 3 }
			)
			expect(result3).toBe('b-user3')
			expect(callCount).toBe(2)

			cached.clearCache()
		})

		test('can extract specific fields for cache key', async () => {
			let callCount = 0
			type Filters = { id: string; name: string; debug?: boolean }

			const fn = async (filters: Filters) => {
				callCount++
				return `${filters.id}:${filters.name}`
			}

			const cached = cacheFunction({
				name: 'cacheKeyFn-fields',
				fn,
				cacheTimeMs: 1000,
				cacheKeyFn: (filters) => [{ id: filters.id, name: filters.name }]
			})

			const result1 = await cached({ id: '1', name: 'test', debug: true })
			const result2 = await cached({ id: '1', name: 'test', debug: false })

			expect(result1).toBe('1:test')
			expect(result2).toBe('1:test')
			expect(callCount).toBe(1)

			cached.clearCache()
		})

		test('cacheKeyFn takes precedence over cacheKeyArgs', async () => {
			let callCount = 0

			const fn = async (a: string, b: string) => {
				callCount++
				return `${a}-${b}`
			}

			const cached = cacheFunction({
				name: 'cacheKeyFn-precedence',
				fn,
				cacheTimeMs: 1000,
				cacheKeyArgs: [0],
				cacheKeyFn: (_a, b) => [b]
			})

			const result1 = await cached('x', 'same')
			const result2 = await cached('y', 'same')

			expect(result1).toBe('x-same')
			expect(result2).toBe('x-same')
			expect(callCount).toBe(1)

			cached.clearCache()
		})
	})

	describe('external store', () => {
		const createFakeStore = () => {
			const entries = new Map<string, CacheStoreEntry>()
			const setCalls: { key: string; entry: CacheStoreEntry; ttlMs: number }[] =
				[]

			const store: CacheStore = {
				get: async (key) => entries.get(key),
				set: async (key, entry, ttlMs) => {
					entries.set(key, entry)
					setCalls.push({ key, entry, ttlMs })
				},
				delete: async (key) => {
					entries.delete(key)
				},
				clear: async () => {
					entries.clear()
				}
			}

			return { store, entries, setCalls }
		}

		test('requires an async function', () => {
			const { store } = createFakeStore()

			cacheFunction({
				name: 'store-type-test',
				fn: async (id: string) => id,
				store
			})

			cacheFunction({
				name: 'store-type-test-sync',
				fn: (id: string) => id,
				// @ts-expect-error external stores are only supported for async functions
				store
			})
		})

		test('caches results through the store', async () => {
			const { store, setCalls } = createFakeStore()
			let callCount = 0
			const fn = async (id: string) => {
				callCount++
				return `result-${id}`
			}

			const cached = cacheFunction({
				name: 'store-test',
				fn,
				cacheTimeMs: 1000,
				store
			})

			const result1 = await cached('a')
			const result2 = await cached('a')
			const result3 = await cached('b')

			expect(result1).toBe('result-a')
			expect(result2).toBe('result-a')
			expect(result3).toBe('result-b')
			expect(callCount).toBe(2)
			expect(setCalls.length).toBe(2)
			expect(setCalls[0]?.ttlMs).toBe(1000)

			cached.clearCache()
		})

		test('passes an extended ttl to the store when refreshInBackground is enabled', async () => {
			const { store, setCalls } = createFakeStore()

			const cached = cacheFunction({
				name: 'store-ttl-test',
				fn: async () => 'value',
				cacheTimeMs: 1000,
				refreshInBackground: true,
				store
			})

			await cached()
			expect(setCalls[0]?.ttlMs).toBe(2000)

			cached.clearCache()
		})

		test('serves stale store entries and refreshes in background', async () => {
			const { store, entries } = createFakeStore()
			let callCount = 0
			const fn = async () => {
				callCount++
				return `call-${callCount}`
			}

			const cached = cacheFunction({
				name: 'store-swr-test',
				fn,
				cacheTimeMs: 1000,
				refreshInBackground: true,
				store
			})

			entries.set('store-swr-test:[]', {
				value: 'stale-value',
				timestamp: Date.now() - 5000
			})

			const result1 = await cached()
			expect(result1).toBe('stale-value')

			await new Promise((r) => setTimeout(r, 10))
			expect(callCount).toBe(1)

			const result2 = await cached()
			expect(result2).toBe('call-1')

			cached.clearCache()
		})

		test.each([
			false,
			true
		])('serves stale entries during a pending store refresh (failure: %s)', async (fails) => {
			const { store, entries } = createFakeStore()
			const refresh = Promise.withResolvers<string>()
			let callCount = 0
			const cached = cacheFunction({
				name: 'store-pending-swr',
				fn: () => {
					callCount++
					return refresh.promise
				},
				cacheTimeMs: 60_000,
				refreshInBackground: true,
				store
			})
			entries.set('store-pending-swr:[]', {
				value: 'stale',
				timestamp: Date.now() - 70_000
			})

			try {
				expect(await cached()).toBe('stale')
				const results = await Promise.race([
					Promise.all(Array.from({ length: 10 }, () => cached())),
					new Promise<string>((resolve) =>
						setImmediate(() => resolve('blocked on refresh'))
					)
				])
				expect(results).toEqual(Array(10).fill('stale'))
				expect(callCount).toBe(1)

				// Once the store expires the entry, callers share the refresh.
				entries.clear()
				const waiter = cached()
				if (fails) refresh.reject(new Error('refresh failed'))
				else refresh.resolve('fresh')
				expect(await waiter).toBe(fails ? 'stale' : 'fresh')
				expect(callCount).toBe(1)
				if (!fails) expect(await cached()).toBe('fresh')
			} finally {
				refresh.resolve('fresh')
				// Drain any pending refresh before clearing its store.
				await new Promise<void>((resolve) => setImmediate(resolve))
				cached.clearCache()
			}
		})

		test('deduplicates concurrent calls', async () => {
			const { store } = createFakeStore()
			let callCount = 0
			const fn = async (id: string) => {
				callCount++
				await new Promise((r) => setTimeout(r, 30))
				return `result-${id}`
			}

			const cached = cacheFunction({
				name: 'store-dedup-test',
				fn,
				cacheTimeMs: 1000,
				store
			})

			const promises = Array.from({ length: 20 }, () => cached('same'))
			const results = await Promise.all(promises)

			expect(results.every((r) => r === 'result-same')).toBe(true)
			expect(callCount).toBe(1)

			cached.clearCache()
		})

		test('falls back to calling fn when the store fails', async () => {
			const storeErrors: unknown[] = []
			const failingStore: CacheStore = {
				get: async () => {
					throw new Error('get failed')
				},
				set: async () => {
					throw new Error('set failed')
				},
				delete: async () => {
					throw new Error('delete failed')
				}
			}

			let callCount = 0
			const cached = cacheFunction({
				name: 'store-error-test',
				fn: async (id: string) => {
					callCount++
					return `result-${id}`
				},
				cacheTimeMs: 1000,
				store: failingStore,
				onStoreError: (error) => storeErrors.push(error)
			})

			const result = await cached('a')
			expect(result).toBe('result-a')
			expect(callCount).toBe(1)
			// One error from get, one from set.
			expect(storeErrors.length).toBe(2)

			cached.clearCache()
		})

		test('fn errors are propagated, not cached', async () => {
			const { store, entries } = createFakeStore()
			let callCount = 0
			const fn = async () => {
				callCount++
				if (callCount === 1) {
					throw new Error('First call fails')
				}
				return 'success'
			}

			const cached = cacheFunction({
				name: 'store-fn-error-test',
				fn,
				cacheTimeMs: 1000,
				store
			})

			await expect(cached()).rejects.toThrow('First call fails')
			expect(entries.size).toBe(0)

			const result = await cached()
			expect(result).toBe('success')
			expect(callCount).toBe(2)

			cached.clearCache()
		})

		test('clearCache clears the store when it supports clear', async () => {
			const { store, entries } = createFakeStore()

			const cached = cacheFunction({
				name: 'store-clear-test',
				fn: async () => 'value',
				cacheTimeMs: 1000,
				store
			})

			await cached()
			expect(entries.size).toBe(1)

			cached.clearCache()
			await new Promise((r) => setTimeout(r, 0))
			expect(entries.size).toBe(0)
		})
	})

	describe('cache keys', () => {
		test('object argument key order does not matter', () => {
			let callCount = 0
			const cached = cacheFunction({
				name: 'key-order',
				fn: (filters: Record<string, number>) => ++callCount + (filters.a ?? 0)
			})

			expect(cached({ a: 1, b: 2 })).toBe(2)
			expect(cached({ b: 2, a: 1 })).toBe(2)
			expect(callCount).toBe(1)
		})
	})

	describe('maxEntries', () => {
		test('evicts the least recently used entry', () => {
			const calls: string[] = []
			const cached = cacheFunction({
				name: 'lru',
				fn: (id: string) => {
					calls.push(id)
					return id
				},
				maxEntries: 2
			})

			cached('a')
			cached('b')
			cached('a') // hit: `b` is now least recently used
			cached('c') // evicts `b`
			cached('a')
			cached('b')

			expect(calls).toEqual(['a', 'b', 'c', 'b'])
			cached.clearCache()
		})
	})

	describe('invalidate', () => {
		test('drops the entry for the given arguments only', () => {
			let callCount = 0
			const cached = cacheFunction({
				name: 'invalidate',
				fn: (id: string) => `${id}-${++callCount}`
			})

			cached('a')
			cached('b')
			cached.invalidate('a')

			expect(cached('a')).toBe('a-3')
			expect(cached('b')).toBe('b-2')
			cached.clearCache()
		})

		test('an in-flight call does not repopulate an invalidated entry', async () => {
			let callCount = 0
			const cached = cacheFunction({
				name: 'invalidate-inflight',
				fn: async () => {
					await new Promise((r) => setTimeout(r, 10))
					return ++callCount
				}
			})

			const first = cached()
			cached.invalidate()
			expect(await first).toBe(1)
			expect(await cached()).toBe(2)
			cached.clearCache()
		})

		test('deletes the key from an external store', async () => {
			const deleted: string[] = []
			const entries = new Map<string, CacheStoreEntry>()
			const cached = cacheFunction({
				name: 'invalidate-store',
				fn: async (id: string) => id,
				store: {
					get: async (key) => entries.get(key),
					set: async (key, entry) => {
						entries.set(key, entry)
					},
					delete: async (key) => {
						deleted.push(key)
						entries.delete(key)
					}
				}
			})

			await cached('a')
			cached.invalidate('a')
			await Promise.resolve()

			expect(deleted).toEqual(['invalidate-store:["a"]'])
			expect(entries.size).toBe(0)
		})
	})

	describe('peek', () => {
		test('returns cached values without calling fn', async () => {
			let callCount = 0
			const cached = cacheFunction({
				name: 'peek',
				fn: async (id: string) => {
					callCount++
					return id
				},
				cacheTimeMs: 50
			})

			expect(cached.peek('a')).toBeUndefined()
			await cached('a')
			const value: string | undefined = cached.peek('a')
			expect(value).toBe('a')

			await new Promise((r) => setTimeout(r, 60))
			expect(cached.peek('a')).toBeUndefined()
			expect(callCount).toBe(1)
			cached.clearCache()
		})

		test('returns stale values with refreshInBackground without refreshing', async () => {
			let callCount = 0
			const cached = cacheFunction({
				name: 'peek-stale',
				fn: () => ++callCount,
				cacheTimeMs: 20,
				refreshInBackground: true
			})

			cached()
			await new Promise((r) => setTimeout(r, 30))
			expect(cached.peek()).toBe(1)
			expect(callCount).toBe(1)
			cached.clearCache()
		})

		test('reads through an external store', async () => {
			const entries = new Map<string, CacheStoreEntry>()
			const cached = cacheFunction({
				name: 'peek-store',
				fn: async (id: string) => `value-${id}`,
				store: {
					get: async (key) => entries.get(key),
					set: async (key, entry) => {
						entries.set(key, entry)
					},
					delete: async (key) => {
						entries.delete(key)
					}
				}
			})

			const miss: Promise<string | undefined> = cached.peek('a')
			expect(await miss).toBeUndefined()
			await cached('a')
			expect(await cached.peek('a')).toBe('value-a')
		})
	})
})
