import { expect, test } from 'bun:test'
import { clamp, lerp, normalize } from './scale'

test('clamp, lerp and normalize', () => {
	expect(clamp(5, 0, 3)).toBe(3)
	expect(clamp(-1, 0, 3)).toBe(0)
	expect(lerp(10, 20, 0.5)).toBe(15)
	expect(normalize(15, 10, 20)).toBe(0.5)
	expect(normalize(30, 10, 20)).toBe(1)
	expect(normalize(1, 5, 5)).toBe(0)
})
