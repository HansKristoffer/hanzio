import { describe, expect, test } from 'bun:test'
import { cacheFunction } from '.'

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
		test('returns cached data and triggers background refresh', async () => {
			let callCount = 0
			const fn = async () => {
				callCount++
				return `call-${callCount}`
			}

			const cached = cacheFunction({
				name: 'swr-test',
				fn,
				cacheTimeMs: 1000,
				refreshInBackground: true
			})

			const result1 = await cached()
			expect(result1).toBe('call-1')
			expect(callCount).toBe(1)

			const result2 = await cached()
			expect(result2).toBe('call-1')

			await new Promise((r) => setTimeout(r, 10))

			expect(callCount).toBe(2)

			cached.clearCache()
		})

		test('deduplicates concurrent requests during background refresh', async () => {
			let callCount = 0
			const fn = async () => {
				callCount++
				await new Promise((r) => setTimeout(r, 50))
				return `call-${callCount}`
			}

			const cached = cacheFunction({
				name: 'swr-dedup-test',
				fn,
				cacheTimeMs: 1000,
				refreshInBackground: true
			})

			await cached()
			expect(callCount).toBe(1)

			const promises = Array.from({ length: 10 }, () => cached())
			const results = await Promise.all(promises)

			const uniqueResults = [...new Set(results)]
			expect(uniqueResults.length).toBeLessThanOrEqual(2)

			expect(callCount).toBe(2)

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
})
