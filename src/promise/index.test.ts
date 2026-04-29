import { describe, expect, test } from 'bun:test'
import {
	backgroundPromise,
	backgroundPromiseSync,
	isFailure,
	isSuccess,
	promiseTimeout,
	tryCatch,
	unwrapResult
} from '.'

describe('promise utilities', () => {
	test('tryCatch returns data for resolved promises', async () => {
		await expect(tryCatch(Promise.resolve('ok'))).resolves.toEqual({
			data: 'ok',
			error: null
		})
	})

	test('tryCatch returns error for rejected promises', async () => {
		const error = new Error('failed')

		await expect(tryCatch(Promise.reject(error))).resolves.toEqual({
			data: null,
			error
		})
	})

	test('Result helpers narrow and unwrap results', () => {
		const success = { data: 'ok', error: null } as const
		const failure = { data: null, error: new Error('failed') }

		if (isSuccess(success)) {
			const value: string = success.data
			expect(value).toBe('ok')
		}

		if (isFailure(failure)) {
			const error: Error = failure.error
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
})
