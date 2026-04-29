import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
	type GenericId,
	createZId,
	normalizeSingleOrArray,
	zSingleOrArray
} from '.'

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
