import { describe, expect, expectTypeOf, test } from 'bun:test'
import { z } from 'zod'
import {
	asId,
	createIdHelpers,
	createZId,
	type GenericId,
	type Id,
	normalizeSingleOrArray,
	parseId,
	parseJson,
	safeParseId,
	zJsonObject,
	zJsonValue,
	zSingleOrArray
} from '.'
import type { JsonValue } from '../string'

describe('zod utilities', () => {
	test('createZId creates a branded non-empty string schema', () => {
		const UserId = createZId('User')

		expect(UserId.parse('user-1')).toEqual('user-1' as GenericId<'User'>)
		expect(() => UserId.parse('')).toThrow('User ID is required')

		const userId: GenericId<'User'> = UserId.parse('user-1')
		expect(userId).toEqual('user-1' as GenericId<'User'>)
	})

	test('zSingleOrArray accepts one value or an array', () => {
		const schema = zSingleOrArray(z.string())
		type Parsed = z.infer<typeof schema>
		const value: Parsed = ['one']

		expect(schema.parse('one')).toBe('one')
		expect(schema.parse(value)).toEqual(['one'])
		expect(schema.parse(['one', 'two'])).toEqual(['one', 'two'])
		expect(() => schema.parse(1)).toThrow()
	})

	test('branded ids are not assignable from plain strings', () => {
		const UserId = createZId('User')
		const userId: GenericId<'User'> = UserId.parse('user-1')

		// @ts-expect-error plain strings must be parsed or explicitly branded first.
		const _invalidUserId: GenericId<'User'> = 'user-1'

		expect(userId as string).toBe('user-1')
	})

	test('normalizeSingleOrArray always returns an array', () => {
		expect(normalizeSingleOrArray('one')).toEqual(['one'])
		expect(normalizeSingleOrArray(['one', 'two'])).toEqual(['one', 'two'])
		expect(normalizeSingleOrArray(null)).toEqual([])
		expect(normalizeSingleOrArray(undefined)).toEqual([])
	})
})

describe('createZId prefix', () => {
	test('validates the prefix', () => {
		const UserId = createZId('User', { prefix: 'usr_' })

		expect(UserId.parse('usr_1')).toEqual('usr_1' as GenericId<'User'>)
		expect(() => UserId.parse('org_1')).toThrow('User ID must start with')
		expect(() => UserId.parse('')).toThrow('User ID is required')
	})
})

describe('id helpers', () => {
	const ids = createIdHelpers<'User' | 'Organization'>()

	test('zId returns a branded schema', () => {
		const userId = ids.zId('User').parse('u1')
		expectTypeOf(userId).toEqualTypeOf<Id<'User'>>()
		expect(userId as string).toBe('u1')
		// @ts-expect-error unknown type name
		ids.zId('Invoice')
	})

	test('parseId validates and brands', () => {
		const userId: Id<'User'> = ids.parseId('User', 'u1')
		expect(userId as string).toBe('u1')
		expect(() => ids.parseId('User', '')).toThrow('User ID is required')
		expect(() => parseId('User', 1)).toThrow()
		expect(parseId('Anything', 'x') as string).toBe('x')
	})

	test('safeParseId returns a Result', () => {
		const good = ids.safeParseId('Organization', 'o1')
		expect(good).toEqual({ ok: true, data: asId('o1'), error: null })
		if (good.ok) expectTypeOf(good.data).toEqualTypeOf<Id<'Organization'>>()

		const bad = safeParseId('User', undefined)
		expect(bad.ok).toBe(false)
		expect(bad.error).toBeInstanceOf(z.ZodError)
	})

	test('ids of different types are not interchangeable', () => {
		const userId = ids.asId<'User'>('u1')
		// @ts-expect-error a User id is not an Organization id
		const _orgId: Id<'Organization'> = userId
		// @ts-expect-error plain strings must be branded first
		const _plain: Id<'User'> = 'u1'
		// @ts-expect-error unknown type name
		ids.asId<'Invoice'>('i1')
		const asString: string = userId
		expect(asString).toBe('u1')
	})
})

describe('zJsonValue', () => {
	test('accepts nested JSON and rejects non-JSON values', () => {
		const value = { a: [1, 'two', null, { b: true }] }
		expect(zJsonValue.parse(value)).toEqual(value)
		expect(() => zJsonValue.parse(undefined)).toThrow()
		expect(() => zJsonValue.parse(Number.NaN)).toThrow()
		expect(() => zJsonValue.parse({ a: new Date() })).toThrow()
		expect(() => zJsonValue.parse([() => 1])).toThrow()

		const typed: JsonValue = zJsonValue.parse(1)
		expect(typed).toBe(1)
	})

	test('zJsonObject accepts objects only', () => {
		expect(zJsonObject.parse({ a: { b: [1] } })).toEqual({ a: { b: [1] } })
		expect(() => zJsonObject.parse([1])).toThrow()
		expect(() => zJsonObject.parse('x')).toThrow()
	})
})

describe('parseJson', () => {
	const schema = z.object({ n: z.coerce.number() })

	test('parses and validates', () => {
		const result = parseJson('{"n":"2"}', schema)
		expect(result).toEqual({ ok: true, data: { n: 2 }, error: null })
		if (result.ok) expectTypeOf(result.data).toEqualTypeOf<{ n: number }>()
	})

	test('returns SyntaxError for invalid JSON', () => {
		const result = parseJson('{nope', schema)
		expect(result.ok).toBe(false)
		expect(result.error).toBeInstanceOf(SyntaxError)
	})

	test('returns ZodError for invalid data', () => {
		const result = parseJson('{"n":"x"}', schema)
		expect(result.ok).toBe(false)
		expect(result.error).toBeInstanceOf(z.ZodError)
	})
})
