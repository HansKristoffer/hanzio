import { describe, expect, test } from 'bun:test'
import PQueue, { TimeoutError } from '.'
import { promiseTimeout } from '../promise'

describe('PQueue', () => {
	test('limits concurrency and resolves task results', async () => {
		const queue = new PQueue({ concurrency: 2 })
		let running = 0
		let maxRunning = 0

		const tasks = Array.from({ length: 5 }, async (_, index) =>
			queue.add(async () => {
				running++
				maxRunning = Math.max(maxRunning, running)
				await promiseTimeout(5)
				running--
				return index
			})
		)

		await expect(Promise.all(tasks)).resolves.toEqual([0, 1, 2, 3, 4])
		expect(maxRunning).toBe(2)
		expect(queue.pending).toBe(0)
		expect(queue.size).toBe(0)
	})

	test('addAll resolves results in input order', async () => {
		const queue = new PQueue({ concurrency: 2 })

		const results = await queue.addAll([
			async () => {
				await promiseTimeout(10)
				return 'first'
			},
			async () => 'second'
		])

		expect(results).toEqual(['first', 'second'])
	})

	test('supports pause, start, and autoStart false', async () => {
		const queue = new PQueue({ autoStart: false })
		let didRun = false
		const task = queue.add(async () => {
			didRun = true
		})

		await promiseTimeout(0)
		expect(didRun).toBe(false)
		expect(queue.isPaused).toBe(true)

		queue.start()
		await task
		expect(didRun).toBe(true)

		queue.pause()
		expect(queue.isPaused).toBe(true)
	})

	test('waits for empty, idle, pending zero, and size less than', async () => {
		const queue = new PQueue({ concurrency: 1 })
		const started: string[] = []

		const first = queue.add(async () => {
			started.push('first')
			await promiseTimeout(10)
		})
		const second = queue.add(async () => {
			started.push('second')
			await promiseTimeout(1)
		})

		await queue.onSizeLessThan(1)
		expect(queue.size).toBe(0)
		await queue.onEmpty()
		await queue.onPendingZero()
		await queue.onIdle()
		await Promise.all([first, second])
		expect(started).toEqual(['first', 'second'])
	})

	test('clears queued tasks', async () => {
		const queue = new PQueue({ concurrency: 1 })
		let ranSecond = false

		const first = queue.add(async () => {
			await promiseTimeout(10)
		})
		queue.add(async () => {
			ranSecond = true
		})

		expect(queue.size).toBe(1)
		queue.clear()
		await first
		await queue.onIdle()
		expect(ranSecond).toBe(false)
		expect(queue.size).toBe(0)
	})

	test('runs higher priority tasks first and can update priority', async () => {
		const queue = new PQueue({ concurrency: 1, autoStart: false })
		const order: string[] = []

		queue.add(async () => order.push('low'), { priority: 0, id: 'low' })
		queue.add(async () => order.push('medium'), { priority: 1, id: 'medium' })
		queue.add(async () => order.push('promoted'), {
			priority: 0,
			id: 'promoted'
		})
		queue.setPriority('promoted', 2)

		queue.start()
		await queue.onIdle()

		expect(order).toEqual(['promoted', 'medium', 'low'])
		expect(queue.sizeBy({ priority: 1 })).toBe(0)
	})

	test('times out running tasks', async () => {
		const queue = new PQueue({ timeout: 1 })

		await expect(
			queue.add(async () => promiseTimeout(20))
		).rejects.toBeInstanceOf(TimeoutError)
	})

	test('removes aborted queued tasks', async () => {
		const queue = new PQueue({ concurrency: 1 })
		const controller = new AbortController()

		const first = queue.add(async () => {
			await promiseTimeout(10)
		})
		const second = queue.add(async () => 'second', {
			signal: controller.signal
		})

		controller.abort(new Error('aborted'))

		await expect(second).rejects.toThrow('aborted')
		await first
		expect(queue.size).toBe(0)
	})

	test('rejects running tasks when signal aborts', async () => {
		const queue = new PQueue()
		const controller = new AbortController()

		const task = queue.add(async () => promiseTimeout(20), {
			signal: controller.signal
		})

		controller.abort(new Error('running aborted'))

		await expect(task).rejects.toThrow('running aborted')
	})

	test('rate limits fixed windows and strict mode', async () => {
		const fixed = new PQueue({ intervalCap: 1, interval: 20 })
		const fixedStartedAt: number[] = []

		await Promise.all([
			fixed.add(async () => fixedStartedAt.push(Date.now())),
			fixed.add(async () => fixedStartedAt.push(Date.now()))
		])

		expect(fixedStartedAt[1]! - fixedStartedAt[0]!).toBeGreaterThanOrEqual(15)

		const strict = new PQueue({ intervalCap: 1, interval: 20, strict: true })
		const strictStartedAt: number[] = []

		await Promise.all([
			strict.add(async () => strictStartedAt.push(Date.now())),
			strict.add(async () => strictStartedAt.push(Date.now()))
		])

		expect(strictStartedAt[1]! - strictStartedAt[0]!).toBeGreaterThanOrEqual(15)
	})

	test('emits lifecycle events and reports running tasks', async () => {
		const queue = new PQueue({ concurrency: 1, intervalCap: 1, interval: 10 })
		const events: string[] = []

		queue.on('add', () => events.push('add'))
		queue.on('active', () => events.push('active'))
		queue.on('completed', () => events.push('completed'))
		queue.on('next', () => events.push('next'))
		queue.on('empty', () => events.push('empty'))
		queue.on('idle', () => events.push('idle'))
		queue.on('rateLimit', () => events.push('rateLimit'))
		queue.on('rateLimitCleared', () => events.push('rateLimitCleared'))

		const task = queue.add(
			async () => {
				expect(queue.runningTasks).toHaveLength(1)
				expect(queue.isSaturated).toBe(false)
				await promiseTimeout(1)
				return 'done'
			},
			{ id: 'task' }
		)

		await expect(task).resolves.toBe('done')
		await queue.onIdle()

		expect(events).toContain('add')
		expect(events).toContain('active')
		expect(events).toContain('completed')
		expect(events).toContain('next')
		expect(events).toContain('empty')
		expect(events).toContain('idle')
	})

	test('onError rejects when a task fails', async () => {
		const queue = new PQueue()
		const error = new Error('failed')
		const onError = queue.onError()

		queue
			.add(async () => {
				throw error
			})
			.catch(() => {})

		await expect(onError).rejects.toBe(error)
	})
})
