import { describe, expect, test } from 'bun:test'
import {
	createResolveColorsByKeys,
	getHeatmapCellStyle,
	hashStringToColorIndex,
	METRICS_SERIES_PALETTE_SIZE,
	resolveSeriesColorMap,
	withAlpha
} from '.'

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
	test('paletteSize parameter bounds indices', () => {
		for (const s of ['a', 'b', 'series-a', 'longer-label-123']) {
			expect(hashStringToColorIndex(s, 3)).toBeLessThan(3)
		}
		const keys = ['a', 'b', 'c', 'd']
		const m = resolveSeriesColorMap(keys, 4)
		expect(new Set(m.values()).size).toBe(4)
		expect(Math.max(...m.values())).toBeLessThan(4)
		const { getColor } = createResolveColorsByKeys(
			keys,
			(i) => `c${i}`,
			(i) => `h${i}`,
			4
		)
		expect(getColor('a')).toBe(`c${m.get('a')}`)
		expect(hashStringToColorIndex('foo')).toBe(
			hashStringToColorIndex('foo', METRICS_SERIES_PALETTE_SIZE)
		)
	})

	describe('withAlpha', () => {
		test('hex variants → rgba()', () => {
			expect(withAlpha('#f00', 0.5)).toBe('rgba(255, 0, 0, 0.5)')
			expect(withAlpha('#f008', 0.5)).toBe('rgba(255, 0, 0, 0.5)')
			expect(withAlpha('#00ff00', 0.25)).toBe('rgba(0, 255, 0, 0.25)')
			expect(withAlpha(' #0000FF80 ', 1)).toBe('rgba(0, 0, 255, 1)')
		})

		test('rgb()/rgba() comma and space syntax', () => {
			expect(withAlpha('rgb(1, 2, 3)', 0.5)).toBe('rgba(1, 2, 3, 0.5)')
			expect(withAlpha('rgba(1,2,3,0.2)', 0.5)).toBe('rgba(1, 2, 3, 0.5)')
			expect(withAlpha('rgb(1 2 3)', 0.5)).toBe('rgba(1, 2, 3, 0.5)')
			expect(withAlpha('rgb(1 2 3 / 0.9)', 0.5)).toBe('rgba(1, 2, 3, 0.5)')
		})

		test('hsl()/hsla()', () => {
			expect(withAlpha('hsl(210, 50%, 40%)', 0.3)).toBe(
				'hsla(210, 50%, 40%, 0.3)'
			)
			expect(withAlpha('hsla(210 50% 40% / 1)', 0.3)).toBe(
				'hsla(210, 50%, 40%, 0.3)'
			)
		})

		test('other colors → color-mix()', () => {
			expect(withAlpha('var(--p-primary-500)', 0.5)).toBe(
				'color-mix(in srgb, var(--p-primary-500) 50%, transparent)'
			)
			expect(withAlpha('rebeccapurple', 0.25)).toBe(
				'color-mix(in srgb, rebeccapurple 25%, transparent)'
			)
			expect(withAlpha('rgb(var(--c))', 0.5)).toBe(
				'color-mix(in srgb, rgb(var(--c)) 50%, transparent)'
			)
		})
	})

	test('getHeatmapCellStyle interpolates alpha over the range', () => {
		const base = { min: 0, max: 10, baseColor: '#000' }
		expect(getHeatmapCellStyle({ ...base, value: 0 })).toEqual({
			backgroundColor: 'rgba(0, 0, 0, 0.08)'
		})
		expect(getHeatmapCellStyle({ ...base, value: 20 })).toEqual({
			backgroundColor: 'rgba(0, 0, 0, 0.78)'
		})
		expect(getHeatmapCellStyle({ ...base, value: null })).toEqual({})
		expect(getHeatmapCellStyle({ ...base, max: 0, value: 1 })).toEqual({
			backgroundColor: 'rgba(0, 0, 0, 0.32)'
		})
	})
})
