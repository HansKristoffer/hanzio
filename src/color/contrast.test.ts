import { describe, expect, test } from 'bun:test'
import {
	contrastRatio,
	contrastText,
	mixColors,
	parseColor,
	pickFromPalette,
	relativeLuminance,
	shade,
	toHex,
	toRgbString
} from '.'

describe('color contrast', () => {
	test('parseColor handles hex, rgb() and hsl()', () => {
		const red = { r: 255, g: 0, b: 0, a: 1 }
		expect(parseColor('#f00')).toEqual(red)
		expect(parseColor(' #FF0000 ')).toEqual(red)
		expect(parseColor('#ff000080')?.a).toBeCloseTo(0.502, 3)
		expect(parseColor('#f008')?.a).toBeCloseTo(0.533, 3)
		expect(parseColor('rgb(255, 0, 0)')).toEqual(red)
		expect(parseColor('rgba(255,0,0,0.5)')).toEqual({ ...red, a: 0.5 })
		expect(parseColor('rgb(100% 0% 0% / 50%)')).toEqual({ ...red, a: 0.5 })
		expect(parseColor('hsl(0, 100%, 50%)')).toEqual(red)
		expect(parseColor('hsla(210deg 50% 40% / 0.3)')).toEqual({
			r: 51,
			g: 102,
			b: 153,
			a: 0.3
		})
		expect(parseColor('rgb(300, -5, 0)')).toEqual(red)
	})

	test('parseColor rejects everything else', () => {
		for (const bad of [
			'red',
			'var(--x)',
			'#12',
			'#ggg',
			'rgb(1, 2)',
			'rgb(a, b, c)',
			'rgb(var(--c))',
			'oklch(0.5 0.1 200)',
			''
		]) {
			expect(parseColor(bad)).toBeUndefined()
		}
	})

	test('toHex and toRgbString', () => {
		expect(toHex('rgb(51, 102, 153)')).toBe('#336699')
		expect(toHex({ r: 255, g: 0, b: 0, a: 0.5 }, { alpha: true })).toBe(
			'#ff000080'
		)
		expect(toHex({ r: 300, g: 1.4, b: -2, a: 1 })).toBe('#ff0100')
		expect(toRgbString('#336699')).toBe('rgb(51, 102, 153)')
		expect(toRgbString('#33669980')).toMatch(/^rgba\(51, 102, 153, 0\.50/)
		expect(() => toHex('red')).toThrow('Unsupported color: red')
	})

	test('luminance, contrast ratio and contrast text', () => {
		expect(relativeLuminance('#000')).toBe(0)
		expect(relativeLuminance('#fff')).toBe(1)
		expect(contrastRatio('#000', '#fff')).toBe(21)
		expect(contrastRatio('#fff', '#000')).toBe(21)
		expect(contrastRatio('#777', '#fff')).toBeCloseTo(4.48, 2)
		expect(contrastText('#1e3a8a')).toBe('#ffffff')
		expect(contrastText('#fde68a')).toBe('#000000')
		expect(contrastText('#fde68a', { dark: '#111827' })).toBe('#111827')
		expect(contrastText('#111', { light: '#eee', dark: '#222' })).toBe('#eee')
	})

	test('mixColors and shade', () => {
		expect(mixColors('#000', '#fff', 0.5)).toBe('#808080')
		expect(mixColors('#f00', '#00f', 0)).toBe('#ff0000')
		expect(mixColors('#f00', 'rgba(0, 0, 255, 0)', 1)).toBe('#0000ff00')
		expect(shade('#336699', 0)).toBe('#336699')
		expect(shade('#336699', -1)).toBe('#000000')
		expect(shade('#336699', 1)).toBe('#ffffff')
		expect(shade('#336699', -0.5)).toBe('#1a334d')
		expect(shade('#33669980', 0.5)).toBe('#99b3cc80')
	})

	test('pickFromPalette is stable and throws on an empty palette', () => {
		const palette = ['a', 'b', 'c'] as const
		expect(pickFromPalette('seed', palette)).toBe(
			pickFromPalette('seed', palette)
		)
		expect(palette).toContain(pickFromPalette('other', palette))
		expect(() => pickFromPalette('x', [])).toThrow()
	})
})
