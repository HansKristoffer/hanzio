import { describe, expect, test } from 'bun:test'
import {
	hashStringToColorIndex,
	METRICS_SERIES_PALETTE_SIZE,
	resolveSeriesColorMap
} from './metricsSeriesColors'

describe('metricsSeriesColors', () => {
	describe('hashStringToColorIndex', () => {
		test('returns stable index for the same string', () => {
			expect(hashStringToColorIndex('foo')).toBe(hashStringToColorIndex('foo'))
		})

		test('returns value in palette range', () => {
			for (const s of ['', 'a', 'series-a', 'longer-label-123']) {
				const idx = hashStringToColorIndex(s)
				expect(idx).toBeGreaterThanOrEqual(0)
				expect(idx).toBeLessThan(METRICS_SERIES_PALETTE_SIZE)
			}
		})
	})

	describe('resolveSeriesColorMap', () => {
		test('empty keys yields empty map', () => {
			expect(resolveSeriesColorMap([]).size).toBe(0)
		})

		test('same key order produces same map', () => {
			const keys = ['a', 'b', 'c']
			const m1 = resolveSeriesColorMap(keys)
			const m2 = resolveSeriesColorMap(keys)
			expect([...m1.entries()].sort()).toEqual([...m2.entries()].sort())
		})

		test('duplicate keys collapse to one entry per distinct key', () => {
			const m = resolveSeriesColorMap(['x', 'x', 'y'])
			expect(m.size).toBe(2)
			expect(m.get('x')).toBeDefined()
			expect(m.get('y')).toBeDefined()
		})

		test('assigns distinct indices when enough palette slots for distinct keys', () => {
			const keys = Array.from(
				{ length: METRICS_SERIES_PALETTE_SIZE },
				(_, i) => `k-${i}`
			)
			const m = resolveSeriesColorMap(keys)
			const indices = [...m.values()]
			const unique = new Set(indices)
			expect(unique.size).toBe(keys.length)
		})
	})
})
