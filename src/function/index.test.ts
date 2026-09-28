import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { createHeartbeat, debounce, keyedDebounce, once, throttle } from '.'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())
const advance = (ms: number) => jest.advanceTimersByTime(ms)

describe('debounce', () => {
	test('trailing call with the latest args', () => {
		const calls: number[] = []
		const fn = debounce((n: number) => calls.push(n), 100)
		fn(1)
		advance(50)
		fn(2)
		expect(fn.pending()).toBe(true)
		advance(99)
		expect(calls).toEqual([])
		advance(1)
		expect(calls).toEqual([2])
		expect(fn.pending()).toBe(false)
	})

	test('leading calls first, trailing only if called again', () => {
		const calls: number[] = []
		const fn = debounce((n: number) => calls.push(n), 100, { leading: true })
		fn(1)
		expect(calls).toEqual([1])
		advance(100)
		expect(calls).toEqual([1])
		fn(2)
		fn(3)
		advance(100)
		expect(calls).toEqual([1, 2, 3])
	})

	test('maxWaitMs forces calls during a continuous burst', () => {
		const calls: number[] = []
		const fn = debounce((n: number) => calls.push(n), 100, { maxWaitMs: 250 })
		for (let i = 1; i <= 6; i++) {
			fn(i)
			advance(50)
		}
		expect(calls).toEqual([5])
	})

	test('cancel and flush', () => {
		const calls: number[] = []
		const fn = debounce((n: number) => calls.push(n), 100)
		fn(1)
		fn.cancel()
		advance(100)
		fn(2)
		fn.flush()
		fn.flush()
		advance(100)
		expect(calls).toEqual([2])
	})
})

test('keyedDebounce debounces each key independently', () => {
	const calls: string[] = []
	const debounced = keyedDebounce(
		(key: string, n: number) => calls.push(`${key}${n}`),
		100
	)
	debounced.call('a', 1)
	debounced.call('b', 1)
	advance(50)
	debounced.call('a', 2)
	advance(50)
	expect(calls).toEqual(['b1'])
	advance(50)
	expect(calls).toEqual(['b1', 'a2'])

	debounced.call('a', 3)
	debounced.call('b', 3)
	debounced.call('c', 3)
	debounced.cancel('a')
	debounced.flush('b')
	expect(calls).toEqual(['b1', 'a2', 'b3'])
	debounced.flush()
	expect(calls).toEqual(['b1', 'a2', 'b3', 'c3'])
	debounced.call('d', 4)
	debounced.cancel()
	advance(100)
	expect(calls).toEqual(['b1', 'a2', 'b3', 'c3'])
})

describe('throttle', () => {
	test('leading call, then the latest call once per interval', () => {
		const calls: number[] = []
		const fn = throttle((n: number) => calls.push(n), 100)
		fn(1)
		fn(2)
		fn(3)
		expect(calls).toEqual([1])
		advance(100)
		expect(calls).toEqual([1, 3])
		fn(4)
		advance(100)
		expect(calls).toEqual([1, 3, 4])
		advance(100)
		fn(5)
		expect(calls).toEqual([1, 3, 4, 5])
	})

	test('trailing: false drops calls inside the interval; cancel resets', () => {
		const calls: number[] = []
		const fn = throttle((n: number) => calls.push(n), 100, { trailing: false })
		fn(1)
		fn(2)
		advance(100)
		fn(3)
		fn.cancel()
		fn(4)
		expect(calls).toEqual([1, 3, 4])
	})
})

test('once calls fn a single time and caches the result', () => {
	let calls = 0
	const init = once((n: number) => {
		calls++
		return n * 2
	})
	expect(init(2)).toBe(4)
	expect(init(5)).toBe(4)
	expect(calls).toBe(1)
})

describe('createHeartbeat', () => {
	let time = 0
	const setup = (intervalMs = 30, idleMs = 40) => {
		time = 0
		const sent: boolean[] = []
		const heartbeat = createHeartbeat({
			intervalMs,
			idleMs,
			send: () => sent.push(true),
			onStop: () => sent.push(false),
			now: () => time
		})
		const tick = (ms: number) => {
			time += ms
			advance(ms)
		}
		return { heartbeat, sent, tick }
	}

	test('sends once on first activity, then at most once per interval', () => {
		const { heartbeat, sent, tick } = setup(20, 500)
		heartbeat.activity()
		heartbeat.activity()
		expect(sent).toEqual([true])
		tick(30)
		heartbeat.activity()
		expect(sent).toEqual([true, true])
		heartbeat.stop()
	})

	test('stops after idleMs without activity', () => {
		const { heartbeat, sent, tick } = setup(500, 20)
		heartbeat.activity()
		tick(15)
		heartbeat.activity()
		tick(15)
		expect(sent).toEqual([true])
		tick(5)
		expect(sent).toEqual([true, false])
		heartbeat.activity()
		expect(sent).toEqual([true, false, true])
		heartbeat.stop()
	})

	test('stop is idempotent, never fires before activity, and cancels the idle timer', () => {
		const { heartbeat, sent, tick } = setup(500, 20)
		heartbeat.stop()
		expect(sent).toEqual([])
		heartbeat.activity()
		heartbeat.stop()
		heartbeat.stop()
		tick(40)
		expect(sent).toEqual([true, false])
	})

	test('uses injected timers', () => {
		const scheduled: (() => void)[] = []
		const sent: string[] = []
		const heartbeat = createHeartbeat({
			intervalMs: 10,
			idleMs: 10,
			send: () => sent.push('send'),
			onStop: () => sent.push('stop'),
			now: () => 0,
			setTimeout: (callback) => scheduled.push(callback),
			clearTimeout: () => {}
		})
		heartbeat.activity()
		scheduled.at(-1)?.()
		expect(sent).toEqual(['send', 'stop'])
	})
})
