import { describe, expect, test } from 'bun:test'
import {
	PromiseTimeoutError,
	backgroundPromise,
	exponentialBackoff,
	pMap,
	retry,
	withTimeout,
	backgroundPromiseSync,
	isFailure,
	isSuccess,
	promiseTimeout,
	tryCatch,
	unwrapResult,
	anySignal,
	createLatestGuard,
	err,
	ok,
	raceAbort,
	startTimer,
	timed,
	timeoutSignal
} from '.'

describe('promise utilities', () => {
	test('tryCatch returns data for resolved promises', async () => {
		await expect(tryCatch(Promise.resolve('ok'))).resolves.toEqual({
			ok: true,
			data: 'ok',
			error: null
		})
	})

	test('tryCatch returns error for rejected promises', async () => {
		const error = new Error('failed')

		await expect(tryCatch(Promise.reject(error))).resolves.toEqual({
			ok: false,
			data: null,
			error
		})
	})

	test('Result helpers narrow and unwrap results', () => {
		const success = { ok: true, data: 'ok', error: null } as const
		const failure = {
			ok: false,
			data: null,
			error: new Error('failed')
		} as const

		if (isSuccess(success)) {
			const value: string = success.data
			expect(value).toBe('ok')
		}

		if (isFailure(failure)) {
			const error = failure.error
			expect(error.message).toBe('failed')
		}

		expect(unwrapResult(success)).toBe('ok')
		expect(() => unwrapResult(failure)).toThrow('failed')
	})

	test('promiseTimeout resolves after a delay', async () => {
		const startedAt = Date.now()

		await promiseTimeout(1)

		expect(Date.now() - startedAt).toBeGreaterThanOrEqual(0)
	})

	test('backgroundPromise calls success and error hooks', async () => {
		let successCount = 0
		let caughtError: unknown
		const error = new Error('background failed')

		backgroundPromise(() => Promise.resolve(), {
			onSuccess: () => {
				successCount++
			}
		})
		backgroundPromise(() => Promise.reject(error), {
			onError: (receivedError) => {
				caughtError = receivedError
			}
		})

		await promiseTimeout(0)

		expect(successCount).toBe(1)
		expect(caughtError).toBe(error)
	})

	test('backgroundPromiseSync schedules work', async () => {
		let didRun = false

		backgroundPromiseSync(() => {
			didRun = true
			return Promise.resolve()
		})

		expect(didRun).toBe(false)
		await promiseTimeout(0)
		expect(didRun).toBe(true)
	})

	test('tryCatch captures sync throws from a function', async () => {
		const result = await tryCatch(() => {
			throw new Error('sync')
		})
		expect(result.ok).toBe(false)
		expect(result.error?.message).toBe('sync')
	})

	test('isFailure is true even when the thrown value is null', async () => {
		const result = await tryCatch(Promise.reject(null))
		expect(isFailure(result)).toBe(true)
		expect(isSuccess(result)).toBe(false)
	})

	test('promiseTimeout rejects when the signal aborts', async () => {
		const controller = new AbortController()
		const pending = promiseTimeout(10_000, { signal: controller.signal })
		controller.abort(new Error('stop'))
		await expect(pending).rejects.toThrow('stop')
	})

	test('withTimeout rejects slow work and aborts its signal', async () => {
		let innerSignal: AbortSignal | undefined
		const pending = withTimeout((signal) => {
			innerSignal = signal
			return new Promise(() => {})
		}, 5)
		await expect(pending).rejects.toBeInstanceOf(PromiseTimeoutError)
		expect(innerSignal?.aborted).toBe(true)
		await expect(withTimeout(Promise.resolve(1), 50)).resolves.toBe(1)
	})

	test('retry retries until success and respects shouldRetry', async () => {
		let calls = 0
		const value = await retry(
			() => {
				calls++
				if (calls < 3) throw new Error('flaky')
				return 'done'
			},
			{ retries: 5, delayMs: 0 }
		)
		expect(value).toBe('done')
		expect(calls).toBe(3)

		let stopped = 0
		await expect(
			retry(
				() => {
					stopped++
					throw new Error('fatal')
				},
				{ retries: 5, delayMs: 0, shouldRetry: () => false }
			)
		).rejects.toThrow('fatal')
		expect(stopped).toBe(1)
	})

	test('exponentialBackoff doubles and caps without jitter', () => {
		const opts = { baseMs: 100, maxMs: 350, jitter: false }
		expect(exponentialBackoff(1, opts)).toBe(100)
		expect(exponentialBackoff(2, opts)).toBe(200)
		expect(exponentialBackoff(3, opts)).toBe(350)
	})

	test('pMap keeps order and bounds concurrency', async () => {
		let running = 0
		let peak = 0
		const results = await pMap(
			[30, 10, 20, 5],
			async (ms, index) => {
				running++
				peak = Math.max(peak, running)
				await promiseTimeout(ms)
				running--
				return index
			},
			{ concurrency: 2 }
		)
		expect(results).toEqual([0, 1, 2, 3])
		expect(peak).toBe(2)
	})

	test('ok and err build results', () => {
		expect(ok(1)).toEqual({ ok: true, data: 1, error: null })
		expect(err('no')).toEqual({ ok: false, data: null, error: 'no' })
	})

	test('exponentialBackoff supports partial jitter and injected random', () => {
		const partial = { baseMs: 1000, maxMs: 15_000, jitter: 'partial' as const }
		expect(exponentialBackoff(1, { ...partial, random: () => 0 })).toBe(1000)
		expect(exponentialBackoff(1, { ...partial, random: () => 1 })).toBe(1250)
		expect(exponentialBackoff(9, { ...partial, random: () => 1 })).toBe(18_750)
		expect(
			exponentialBackoff(2, { ...partial, jitterRatio: 0.5, random: () => 1 })
		).toBe(3000)
		expect(
			exponentialBackoff(3, { baseMs: 100, jitter: 'full', random: () => 0.5 })
		).toBe(200)
		expect(exponentialBackoff(3, { baseMs: 100, random: () => 0.5 })).toBe(200)
	})

	test('startTimer and timed measure elapsed time', async () => {
		const elapsed = startTimer()
		const { result, durationMs } = await timed(async () => {
			await promiseTimeout(5)
			return 'done'
		})
		expect(result).toBe('done')
		expect(durationMs).toBeGreaterThanOrEqual(4)
		expect(elapsed()).toBeGreaterThanOrEqual(durationMs)
		await expect(
			timed(() => {
				throw new Error('boom')
			})
		).rejects.toThrow('boom')
	})

	for (const native of [true, false]) {
		test(`anySignal propagates the first reason (${native ? 'native' : 'fallback'})`, () => {
			const original = AbortSignal.any
			if (!native) (AbortSignal as { any?: unknown }).any = undefined
			try {
				const a = new AbortController()
				const b = new AbortController()
				const merged = anySignal(a.signal, undefined, b.signal)
				expect(merged.aborted).toBe(false)
				b.abort('b')
				a.abort('a')
				expect(merged.aborted).toBe(true)
				expect(merged.reason).toBe('b')

				const pre = anySignal(
					new AbortController().signal,
					AbortSignal.abort('x')
				)
				expect(pre.reason).toBe('x')
				expect(anySignal().aborted).toBe(false)
				expect(anySignal(undefined, a.signal)).toBe(a.signal)
			} finally {
				AbortSignal.any = original
			}
		})
	}

	test('timeoutSignal aborts on timeout or on the caller signal', async () => {
		const timeout = timeoutSignal(5)
		await promiseTimeout(10)
		expect(timeout.aborted).toBe(true)
		expect((timeout.reason as Error).name).toBe('TimeoutError')

		const controller = new AbortController()
		const combined = timeoutSignal(10_000, controller.signal)
		controller.abort('stop')
		expect(combined.reason).toBe('stop')
	})

	test('raceAbort rejects with the abort reason and cleans up', async () => {
		const controller = new AbortController()
		const pending = raceAbort(new Promise<never>(() => {}), controller.signal)
		controller.abort('cancelled')
		await expect(pending).rejects.toBe('cancelled')

		await expect(raceAbort(Promise.resolve(1), undefined)).resolves.toBe(1)
		await expect(
			raceAbort(Promise.resolve(1), AbortSignal.abort('early'))
		).rejects.toBe('early')

		const signal = new AbortController().signal
		const removed: string[] = []
		const remove = signal.removeEventListener.bind(signal)
		signal.removeEventListener = (type: string, listener: () => void) => {
			removed.push(type)
			remove(type, listener)
		}
		await expect(raceAbort(Promise.resolve(2), signal)).resolves.toBe(2)
		expect(removed).toEqual(['abort'])
	})

	test('createLatestGuard marks superseded work stale', async () => {
		const guard = createLatestGuard()
		const first = guard.next()
		expect(guard.isCurrent(first)).toBe(true)
		const second = guard.next()
		expect(guard.isCurrent(first)).toBe(false)
		guard.invalidate()
		expect(guard.isCurrent(second)).toBe(false)

		const slow = guard.run(async () => {
			await promiseTimeout(5)
			return 'slow'
		})
		const failing = guard.run(async () => {
			await promiseTimeout(5)
			throw new Error('stale failure')
		})
		const fast = guard.run(() => 'fast')
		await expect(slow).resolves.toEqual({ stale: true })
		await expect(failing).resolves.toEqual({ stale: true })
		await expect(fast).resolves.toEqual({ stale: false, value: 'fast' })
		await expect(
			guard.run(() => Promise.reject(new Error('current')))
		).rejects.toThrow('current')
	})
})
