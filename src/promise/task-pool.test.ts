import { describe, expect, test } from 'bun:test'
import { createTaskPool } from '.'

describe('createTaskPool', () => {
	test('starts newly queued work in spare slots and reuses each slot immediately', async () => {
		const pool = createTaskPool({ concurrency: 2 })
		const slow = Promise.withResolvers<void>()
		const started = Promise.withResolvers<void>()
		const third = Promise.withResolvers<void>()
		let active = 0
		let peak = 0
		const first = pool.run(async () => {
			peak = Math.max(peak, ++active)
			started.resolve()
			await slow.promise
			active--
			return 'first'
		})
		await started.promise
		const second = pool.run(async () => {
			peak = Math.max(peak, ++active)
			active--
			return 'second'
		})
		const last = pool.run(async () => {
			peak = Math.max(peak, ++active)
			third.resolve()
			active--
			return 'third'
		})
		try {
			await third.promise
			expect(active).toBe(1)
			expect(peak).toBe(2)
		} finally {
			slow.resolve()
		}
		await pool.drain()
		expect(await Promise.all([first, second, last])).toEqual([
			'first',
			'second',
			'third'
		])
	})

	test('failure discards queued work but waits for active siblings before drain rejects', async () => {
		const pool = createTaskPool({ concurrency: 2 })
		const slow = Promise.withResolvers<void>()
		const started = Promise.withResolvers<void>()
		let queuedRan = false
		void pool.run(async () => {
			started.resolve()
			await slow.promise
		})
		await started.promise
		const failed = pool.run(async () => {
			throw new Error('publication failed')
		})
		void pool.run(async () => {
			queuedRan = true
		})
		let settled = false
		const draining = pool.drain().finally(() => {
			settled = true
		})
		void draining.catch(() => {})
		await expect(failed).rejects.toThrow('publication failed')
		expect(settled).toBe(false)
		expect(queuedRan).toBe(false)
		slow.resolve()
		await expect(draining).rejects.toThrow('publication failed')
	})

	test('abort skips queued work and drains the active operation', async () => {
		const controller = new AbortController()
		const pool = createTaskPool({ concurrency: 1, signal: controller.signal })
		const slow = Promise.withResolvers<void>()
		const started = Promise.withResolvers<void>()
		let queuedRan = false
		void pool.run(async () => {
			started.resolve()
			await slow.promise
		})
		await started.promise
		void pool.run(async () => {
			queuedRan = true
		})
		controller.abort(new Error('lost ownership'))
		slow.resolve()
		await expect(pool.drain()).rejects.toThrow('lost ownership')
		expect(queuedRan).toBe(false)
	})
})
