import { describe, expect, test } from 'bun:test'
import {
	linearRegression,
	linearRegressionTrend
} from './linearRegressionTrend'

describe('linearRegressionTrend', () => {
	test('returns [] when fewer than 2 points', () => {
		expect(linearRegressionTrend([])).toEqual([])
		expect(linearRegressionTrend([5])).toEqual([])
	})

	test('returns [] when any value is non-finite', () => {
		expect(linearRegressionTrend([1, Number.NaN])).toEqual([])
		expect(linearRegressionTrend([1, Number.POSITIVE_INFINITY])).toEqual([])
	})

	test('perfect line y = 2x + 1 at x = 0,1,2', () => {
		const y = linearRegressionTrend([1, 3, 5])
		expect(y).toHaveLength(3)
		expect(y[0]).toBeCloseTo(1, 10)
		expect(y[1]).toBeCloseTo(3, 10)
		expect(y[2]).toBeCloseTo(5, 10)
	})

	test('horizontal data yields constant trend', () => {
		const y = linearRegressionTrend([7, 7, 7, 7])
		expect(y.every((v) => v === 7)).toBe(true)
	})
	test('linearRegression exposes slope, intercept and r2', () => {
		const exact = linearRegression([1, 3, 5])!
		expect(exact.slope).toBeCloseTo(2, 10)
		expect(exact.intercept).toBeCloseTo(1, 10)
		expect(exact.r2).toBeCloseTo(1, 10)

		const noisy = linearRegression([1, 3, 2, 4])!
		expect(noisy.slope).toBeGreaterThan(0)
		expect(noisy.r2).toBeGreaterThan(0)
		expect(noisy.r2).toBeLessThan(1)

		expect(linearRegression([7, 7])).toMatchObject({ slope: 0, r2: 1 })
		expect(linearRegression([1])).toBeNull()
	})
})
