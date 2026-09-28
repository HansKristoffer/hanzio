import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
	type AsyncStorageLike,
	createAsyncStorageItem,
	createMemoryStorage,
	createStorageItem,
	type SyncStorageLike
} from '.'

const Prefs = z.object({ open: z.boolean(), width: z.number() })
const fallback = { open: false, width: 320 }

const throwingStorage = (): SyncStorageLike => ({
	getItem: () => {
		throw new Error('SecurityError')
	},
	setItem: () => {
		throw new Error('QuotaExceededError')
	},
	removeItem: () => {
		throw new Error('SecurityError')
	}
})

describe('createStorageItem', () => {
	test('round-trips JSON and removes', () => {
		const storage = createMemoryStorage()
		const item = createStorageItem({ key: 'prefs', fallback, storage })
		expect(item.get()).toEqual(fallback)
		item.set({ open: true, width: 400 })
		expect(storage.getItem('prefs')).toBe('{"open":true,"width":400}')
		expect(item.get()).toEqual({ open: true, width: 400 })
		item.remove()
		expect(storage.getItem('prefs')).toBeNull()
		expect(item.get()).toEqual(fallback)
	})

	test('corrupt JSON and parse rejection fall back', () => {
		const storage = createMemoryStorage()
		const item = createStorageItem({
			key: 'prefs',
			fallback,
			storage,
			parse: Prefs.parse
		})
		storage.setItem('prefs', '{not json')
		expect(item.get()).toEqual(fallback)
		storage.setItem('prefs', '{"open":"yes"}')
		expect(item.get()).toEqual(fallback)
		storage.setItem('prefs', '{"open":true,"width":1}')
		expect(item.get()).toEqual({ open: true, width: 1 })
	})

	test('custom serialize/deserialize', () => {
		const storage = createMemoryStorage()
		const item = createStorageItem({
			key: 'send-on-enter',
			fallback: false,
			storage,
			serialize: String,
			deserialize: (raw) => raw === 'true'
		})
		item.set(true)
		expect(storage.getItem('send-on-enter')).toBe('true')
		expect(item.get()).toBe(true)
	})

	test('throwing storage falls back to an in-memory mirror', () => {
		const item = createStorageItem({
			key: 'visitor',
			fallback: '',
			storage: throwingStorage()
		})
		expect(item.get()).toBe('')
		item.set('abc')
		expect(item.get()).toBe('abc')
		item.remove()
		expect(item.get()).toBe('')
	})

	test('a failed write wins over the stale stored value', () => {
		const storage = createMemoryStorage()
		storage.setItem('n', '1')
		let full = true
		const item = createStorageItem({
			key: 'n',
			fallback: 0,
			storage: {
				...storage,
				setItem: (key, value) => {
					if (full) throw new Error('QuotaExceededError')
					storage.setItem(key, value)
				}
			}
		})
		item.set(2)
		expect(item.get()).toBe(2)
		full = false
		item.set(3)
		expect(storage.getItem('n')).toBe('3')
		expect(item.get()).toBe(3)
	})

	test('defaults to shared memory storage when localStorage is absent', () => {
		expect((globalThis as { localStorage?: unknown }).localStorage).toBe(
			undefined
		)
		createStorageItem({ key: 'shared', fallback: 0 }).set(5)
		expect(createStorageItem({ key: 'shared', fallback: 0 }).get()).toBe(5)
	})

	test('uses localStorage and survives a throwing getter', () => {
		const storage = createMemoryStorage()
		Object.defineProperty(globalThis, 'localStorage', {
			configurable: true,
			get: () => storage
		})
		try {
			createStorageItem({ key: 'k', fallback: 0 }).set(1)
			expect(storage.getItem('k')).toBe('1')

			Object.defineProperty(globalThis, 'localStorage', {
				configurable: true,
				get: () => {
					throw new Error('SecurityError')
				}
			})
			const item = createStorageItem({ key: 'k', fallback: 0 })
			expect(item.get()).toBe(0)
		} finally {
			delete (globalThis as { localStorage?: unknown }).localStorage
		}
	})

	test('subscribe fires on storage events for its key and area', () => {
		const storage = createMemoryStorage()
		const item = createStorageItem({ key: 'k', fallback: 0, storage })
		const seen: number[] = []
		const unsubscribe = item.subscribe((value) => seen.push(value))
		const fire = (key: string | null, storageArea: unknown) =>
			(globalThis as unknown as EventTarget).dispatchEvent(
				Object.assign(new Event('storage'), { key, storageArea })
			)

		storage.setItem('k', '7')
		fire('k', storage)
		fire('other', storage)
		fire('k', createMemoryStorage())
		fire(null, storage)
		unsubscribe()
		fire('k', storage)
		expect(seen).toEqual([7, 7])
	})
})

describe('createAsyncStorageItem', () => {
	const asyncMemory = (): AsyncStorageLike => {
		const storage = createMemoryStorage()
		return {
			getItem: async (key) => storage.getItem(key),
			setItem: async (key, value) => storage.setItem(key, value),
			removeItem: async (key) => storage.removeItem(key)
		}
	}

	test('round-trips, validates and falls back', async () => {
		const storage = asyncMemory()
		const item = createAsyncStorageItem({
			key: 'read-ids',
			fallback: [] as string[],
			storage,
			parse: z.array(z.string()).parse
		})
		expect(await item.get()).toEqual([])
		await item.set(['a', 'b'])
		expect(await item.get()).toEqual(['a', 'b'])
		await storage.setItem('read-ids', '[1]')
		expect(await item.get()).toEqual([])
		await item.remove()
		expect(await storage.getItem('read-ids')).toBeNull()
	})

	test('never rejects and mirrors failed writes', async () => {
		const failing: AsyncStorageLike = {
			getItem: () => Promise.reject(new Error('down')),
			setItem: () => Promise.reject(new Error('down')),
			removeItem: () => Promise.reject(new Error('down'))
		}
		const item = createAsyncStorageItem({
			key: 'k',
			fallback: 'none',
			storage: failing
		})
		expect(await item.get()).toBe('none')
		await item.set('x')
		expect(await item.get()).toBe('x')
		await item.remove()
		expect(await item.get()).toBe('none')
	})
})
