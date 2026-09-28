import { describe, expect, test } from 'bun:test'
import { InvariantError } from '../error'
import {
	hasKey,
	isBoolean,
	isDefined,
	isFunction,
	isNonEmpty,
	isNumber,
	isOneOf,
	isPlainObject,
	isRecord,
	isString,
	isTruthy,
	nonEmpty
} from '.'

describe('object guards', () => {
	test('isRecord accepts non-null non-array objects', () => {
		expect(isRecord({})).toBe(true)
		expect(isRecord(new Date())).toBe(true)
		expect(isRecord(Object.create(null))).toBe(true)
		expect(isRecord([])).toBe(false)
		expect(isRecord(null)).toBe(false)
		expect(isRecord('x')).toBe(false)
	})

	test('isPlainObject rejects class instances', () => {
		expect(isPlainObject({ a: 1 })).toBe(true)
		expect(isPlainObject(Object.create(null))).toBe(true)
		expect(isPlainObject(new Date())).toBe(false)
		expect(isPlainObject(new Map())).toBe(false)
		expect(isPlainObject(new (class {})())).toBe(false)
		expect(isPlainObject([])).toBe(false)
	})

	test('hasKey checks own properties and narrows the key', () => {
		const labels = { draft: 'Draft', sent: 'Sent' }
		const key: string = 'draft'
		expect(hasKey(labels, 'toString')).toBe(false)
		expect(hasKey(labels, 'sent')).toBe(true)
		if (hasKey(labels, key)) {
			const _label: string = labels[key]
			expect(_label).toBe('Draft')
		}
		// @ts-expect-error string cannot index labels without narrowing
		const _unsafe: string = labels[key]
	})
})

describe('primitive guards', () => {
	test('isDefined and isTruthy filter with narrowed types', () => {
		const values = [1, null, 0, undefined, 2]
		const defined: number[] = values.filter(isDefined)
		expect(defined).toEqual([1, 0, 2])

		const mixed = ['a', '', null, 'b'] as const
		const truthy: ('a' | 'b')[] = mixed.filter(isTruthy)
		expect(truthy).toEqual(['a', 'b'])
		// @ts-expect-error null is removed from the element type
		const _withNull: null[] = mixed.filter(isTruthy)
		expect(isTruthy(0n)).toBe(false)
	})

	test('typeof guards', () => {
		expect(isString('')).toBe(true)
		expect(isString(1)).toBe(false)
		expect(isNumber(0)).toBe(true)
		expect(isNumber(Number.POSITIVE_INFINITY)).toBe(true)
		expect(isNumber(Number.NaN)).toBe(false)
		expect(isNumber('1')).toBe(false)
		expect(isBoolean(false)).toBe(true)
		expect(isBoolean(0)).toBe(false)
		expect(isFunction(() => {})).toBe(true)
		expect(isFunction(class {})).toBe(true)
		expect(isFunction({})).toBe(false)

		const value: string | ((n: number) => string) = (n: number) => `${n}`
		if (isFunction(value)) {
			const _fn: (n: number) => string = value
			expect(_fn(1)).toBe('1')
		}
	})
})

describe('isOneOf', () => {
	const STATUSES = ['draft', 'sent'] as const

	test('checks membership and narrows', () => {
		const input: unknown = 'sent'
		expect(isOneOf(STATUSES, 'nope')).toBe(false)
		if (isOneOf(STATUSES, input)) {
			const _status: 'draft' | 'sent' = input
			// @ts-expect-error narrowed to the list's literals only
			const _draft: 'draft' = input
			expect(_status).toBe('sent')
		}
		expect(isOneOf([undefined], undefined)).toBe(true)
	})

	test('curried form returns a guard', () => {
		const isStatus = isOneOf(STATUSES)
		const filtered: ('draft' | 'sent')[] = ['draft', 'x', 'sent'].filter(
			isStatus
		)
		expect(filtered).toEqual(['draft', 'sent'])
		expect(isStatus(undefined)).toBe(false)
	})
})

describe('non-empty arrays', () => {
	test('isNonEmpty narrows to a tuple with a first element', () => {
		const items: readonly number[] = [1]
		expect(isNonEmpty([])).toBe(false)
		if (isNonEmpty(items)) {
			const _first: number = items[0]
			expect(_first).toBe(1)
		}
	})

	test('nonEmpty returns a typed copy or throws', () => {
		const source = ['a', 'b'] as const
		const result: ['a' | 'b', ...('a' | 'b')[]] = nonEmpty(source)
		expect(result).toEqual(['a', 'b'])
		expect(result).not.toBe(source)
		expect(() => nonEmpty([])).toThrow(
			new InvariantError('Expected a non-empty array')
		)
		expect(() => nonEmpty([], 'No models')).toThrow('No models')
	})
})
