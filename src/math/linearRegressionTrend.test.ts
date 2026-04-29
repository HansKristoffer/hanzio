import { describe, expect, test } from 'bun:test'
import { linearRegressionTrend } from './linearRegressionTrend'

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
})
