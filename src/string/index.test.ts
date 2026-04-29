import { describe, expect, test } from 'bun:test'
import { extractNumber, generateId, slugify } from '.'

describe('string utilities', () => {
	test('extractNumber parses numbers from strings', () => {
		expect(extractNumber('Price: 123.45 kr')).toBe(123.45)
		expect(extractNumber('-42 items')).toBe(-42)
		expect(extractNumber('')).toBeUndefined()
		expect(extractNumber('abc')).toBeUndefined()
		expect(extractNumber(null)).toBeUndefined()
	})

	test('generateId creates stable ids for primitive values', () => {
		expect(generateId('b=2&a=1')).toBe(generateId('a=1&b=2'))
		expect(generateId(123)).toBe(generateId(123))
		expect(generateId(undefined)).toBe(generateId(undefined))
	})

	test('generateId normalizes object key order', () => {
		expect(generateId({ b: 2, a: 1 })).toBe(generateId({ a: 1, b: 2 }))
		expect(generateId({ a: 1, b: undefined })).toBe(generateId({ a: 1 }))
	})

	test('generateId keeps array order significant', () => {
		expect(generateId([1, 2, 3])).not.toBe(generateId([3, 2, 1]))
	})

	test('slugify normalizes text for URLs', () => {
		expect(slugify('Hello World!')).toBe('hello-world')
		expect(slugify('Crème brûlée & tea')).toBe('creme-brulee-and-tea')
		expect(slugify(' /Already---spaced/ ')).toBe('already-spaced')
	})
})
