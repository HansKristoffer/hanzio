import { describe, expect, test } from 'bun:test'
import { createCache } from './createCache'

describe('createCache', () => {
	test('getOrSet dedupes concurrent calls and caches the value', async () => {
		const cache = createCache()
		let calls = 0
		const fn = async () => {
			calls++
			return 'v'
		}
		const [a, b] = await Promise.all([
			cache.getOrSet('k', fn),
			cache.getOrSet('k', fn)
		])
		expect([a, b]).toEqual(['v', 'v'])
		expect(await cache.getOrSet('k', fn)).toBe('v')
		expect(calls).toBe(1)
	})

	test('rejections are not cached', async () => {
		const cache = createCache()
		await expect(
			cache.getOrSet('k', () => Promise.reject(new Error('x')))
		).rejects.toThrow('x')
		expect(cache.has('k')).toBe(false)
	})

	test('entries expire after ttl', async () => {
		const cache = createCache({ defaultTtlMs: 5 })
		cache.set('k', 1)
		expect(cache.get<number>('k')).toBe(1)
		await Bun.sleep(10)
		expect(cache.get('k')).toBeUndefined()
	})

	test('maxEntries evicts the least recently used key', () => {
		const cache = createCache({ maxEntries: 2 })
		cache.set('a', 1)
		cache.set('b', 2)
		cache.get('a')
		cache.set('c', 3)
		expect(cache.has('a')).toBe(true)
		expect(cache.has('b')).toBe(false)
		expect(cache.size).toBe(2)
	})

	test('staleMarginMs refreshes getOrSet early while get keeps the value', async () => {
		let time = 0
		const cache = createCache({ now: () => time })
		let calls = 0
		const fn = async () => `token-${++calls}`
		const options = { ttlMs: 100, staleMarginMs: 20 }

		expect(await cache.getOrSet('k', fn, options)).toBe('token-1')
		time = 79
		expect(await cache.getOrSet('k', fn, options)).toBe('token-1')
		time = 80
		expect(cache.get<string>('k')).toBe('token-1')
		expect(await cache.getOrSet('k', fn, options)).toBe('token-2')
		time = 179
		expect(cache.get<string>('k')).toBe('token-2')
		time = 180
		expect(cache.get('k')).toBeUndefined()
	})

	test('a failed early refresh keeps the value until it expires', async () => {
		let time = 0
		const cache = createCache({ now: () => time, staleMarginMs: 20 })
		cache.set('k', 'old', { ttlMs: 100 })
		time = 90
		await expect(
			cache.getOrSet('k', () => Promise.reject(new Error('down')))
		).rejects.toThrow('down')
		expect(cache.get<string>('k')).toBe('old')
		time = 100
		expect(cache.has('k')).toBe(false)
	})

	test('ttlMs can be derived from the value', async () => {
		let time = 0
		const cache = createCache({ now: () => time })
		const token = await cache.getOrSet(
			'k',
			async () => ({ access_token: 't', expires_in: 60 }),
			{ ttlMs: (value) => value.expires_in * 1000 }
		)
		expect(token.access_token).toBe('t')
		time = 59_999
		expect(cache.has('k')).toBe(true)
		time = 60_000
		expect(cache.has('k')).toBe(false)

		cache.set('n', 5, { ttlMs: (n) => n })
		time += 5
		expect(cache.has('n')).toBe(false)
	})
})
