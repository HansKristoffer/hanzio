import { describe, expect, test } from 'bun:test'
import {
	getAtPath,
	mapValues,
	omit,
	pick,
	recordFromKeys,
	setAtPath,
	typedEntries,
	typedFromEntries,
	typedKeys
} from '.'

describe('typed object helpers', () => {
	const user = { id: 1, name: 'Ada' }

	test('typedKeys and typedEntries keep key and value types', () => {
		const keys: ('id' | 'name')[] = typedKeys(user)
		expect(keys).toEqual(['id', 'name'])

		const entries: (['id', number] | ['name', string])[] = typedEntries(user)
		expect(entries).toEqual([
			['id', 1],
			['name', 'Ada']
		])
		// @ts-expect-error entries pair each key with its own value type
		const _wrong: ['id', string][] = typedEntries(user)
	})

	test('typedFromEntries and recordFromKeys build records', () => {
		const record: Record<'a' | 'b', number> = typedFromEntries([
			['a', 1],
			['b', 2]
		])
		expect(record).toEqual({ a: 1, b: 2 })

		const lengths = recordFromKeys(['en', 'da'], (key) => key.length)
		const _typed: Record<'en' | 'da', number> = lengths
		expect(lengths).toEqual({ en: 2, da: 2 })
	})

	test('mapValues maps each value with its key', () => {
		const mapped: Record<'id' | 'name', string> = mapValues(
			user,
			(value, key) => `${key}=${value}`
		)
		expect(mapped).toEqual({ id: 'id=1', name: 'name=Ada' })
	})

	test('pick and omit copy selected keys', () => {
		const picked: { name: string } = pick(user, ['name'])
		expect(picked).toEqual({ name: 'Ada' })
		expect(pick({} as { a?: number }, ['a'])).toEqual({})

		const omitted = omit(user, ['id'])
		const _typed: { name: string } = omitted
		// @ts-expect-error id was omitted
		omitted.id
		expect(omitted).toEqual({ name: 'Ada' })
		expect(user).toEqual({ id: 1, name: 'Ada' })

		// @ts-expect-error unknown keys are rejected
		pick(user, ['missing'])
	})
})

describe('getAtPath', () => {
	const data = { a: { b: [{ c: 1 }] } }

	test('reads dot paths and segment arrays', () => {
		expect(getAtPath(data, 'a.b.0.c')).toBe(1)
		expect(getAtPath(data, ['a', 'b', 0, 'c'])).toBe(1)
		expect(getAtPath(data, '')).toBe(data)
	})

	test('returns undefined for missing paths', () => {
		expect(getAtPath(data, 'a.x.y')).toBeUndefined()
		expect(getAtPath(data, 'a.b.0.c.d')).toBeUndefined()
		expect(getAtPath(null, 'a')).toBeUndefined()
	})
})

describe('setAtPath', () => {
	test('creates arrays for numeric segments and objects otherwise', () => {
		const data: Record<string, unknown> = {}
		setAtPath(data, 'a.items.0.name', 'x')
		setAtPath(data, ['a', 'count'], 2)
		expect(data).toEqual({ a: { items: [{ name: 'x' }], count: 2 } })
		expect(Array.isArray(getAtPath(data, 'a.items'))).toBe(true)
	})

	test('replaces primitives in the way and overwrites values', () => {
		const data: Record<string, unknown> = { a: 'str', b: { c: 1 } }
		setAtPath(data, 'a.b', 1)
		setAtPath(data, 'b.c', 2)
		expect(data).toEqual({ a: { b: 1 }, b: { c: 2 } })
	})

	test('rejects prototype-polluting segments without partial writes', () => {
		const data: Record<string, unknown> = {}
		expect(() => setAtPath(data, 'x.__proto__.polluted', true)).toThrow(
			'Unsafe path segment: __proto__'
		)
		expect(() => setAtPath(data, ['constructor', 'prototype'], 1)).toThrow()
		expect(data).toEqual({})
		expect(({} as Record<string, unknown>).polluted).toBeUndefined()
	})

	test('rejects empty paths', () => {
		expect(() => setAtPath({}, '', 1)).toThrow('Path must not be empty')
	})
})
