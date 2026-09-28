import { describe, expect, expectTypeOf, test } from 'bun:test'
import { z } from 'zod'
import { getEnumValues, getObjectShape, unwrapSchema, zodDefaults } from '.'

describe('unwrapSchema', () => {
	test('strips wrappers down to the base schema', () => {
		const base = z.string()
		const lazy = z.lazy(() => base.optional())
		expect(unwrapSchema(base.optional().nullable().default('x'))).toBe(base)
		expect(unwrapSchema(base.catch('x').readonly())).toBe(base)
		expect(unwrapSchema(lazy)).toBe(base)
		expect(unwrapSchema(base)).toBe(base)
	})

	test('reads pipes from their input side', () => {
		const base = z.string()
		expect(unwrapSchema(base.transform(Number))).toBe(base)
		const number = z.number()
		expect(unwrapSchema(z.preprocess(Number, number))).toBe(number)
	})
})

describe('getEnumValues', () => {
	test('returns enum values through wrappers', () => {
		expect(getEnumValues(z.enum(['a', 'b']))).toEqual(['a', 'b'])
		expect(getEnumValues(z.enum(['a', 'b']).optional().default('b'))).toEqual([
			'a',
			'b'
		])
		expect(getEnumValues(z.string())).toBeUndefined()
	})
})

describe('getObjectShape', () => {
	test('returns the shape of a wrapped object', () => {
		const name = z.string()
		const shape = getObjectShape(z.object({ name }).nullable())
		expect(Object.keys(shape ?? {})).toEqual(['name'])
		expect(shape?.name).toBe(name)
		expect(getObjectShape(z.array(z.string()))).toBeUndefined()
	})
})

describe('zodDefaults', () => {
	test('builds initial form state', () => {
		const schema = z.object({
			name: z.string().min(1),
			age: z.number(),
			big: z.bigint(),
			active: z.boolean(),
			role: z.enum(['admin', 'member']),
			kind: z.literal('user'),
			tags: z.array(z.string()),
			nickname: z.string().optional(),
			parent: z.string().nullable(),
			country: z.string().default('DK'),
			createdAt: z.date(),
			choice: z.union([z.number(), z.string()]),
			count: z.string().transform(Number),
			address: z.object({ city: z.string(), zip: z.string().default('8000') })
		})

		const defaults = zodDefaults(schema)
		expectTypeOf(defaults).toEqualTypeOf<z.output<typeof schema>>()
		expect(defaults).toEqual({
			name: '',
			age: 0,
			big: 0n,
			active: false,
			role: 'admin',
			kind: 'user',
			tags: [],
			nickname: undefined,
			parent: null,
			country: 'DK',
			createdAt: undefined as unknown as Date,
			choice: 0,
			count: '' as unknown as number,
			address: { city: '', zip: '8000' }
		})
	})

	test('uses the first native enum value', () => {
		enum Color {
			Red = 'red',
			Blue = 'blue'
		}
		expect(zodDefaults(z.enum(Color))).toBe(Color.Red)
	})

	test('calls default factories each time', () => {
		const schema = z.array(z.string()).default(() => ['x'])
		const first = zodDefaults(schema)
		expect(first).toEqual(['x'])
		expect(zodDefaults(schema)).not.toBe(first)
	})

	test('terminates on recursive schemas', () => {
		type Node = { name: string; child: Node }
		const node: z.ZodType<Node> = z.lazy(() =>
			z.object({ name: z.string(), child: node })
		)
		expect(zodDefaults(node)).toEqual({
			name: '',
			child: undefined as unknown as Node
		})
	})
})
