import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { jsonToZodSchemaMapper } from './jsonToZodSchemaMapper'
import {
	createMinMaxFilter,
	toGteLteFilter,
	toGtLtFilter
} from './zodMinMaxFilter'
import { zodToExample, zodToTypeString } from './zodToTypeString'

describe('toGteLteFilter', () => {
	test('maps min/max to gte/lte', () => {
		expect(toGteLteFilter({ min: 1, max: 10 })).toEqual({ gte: 1, lte: 10 })
		expect(toGteLteFilter({ min: 5 })).toEqual({ gte: 5 })
		expect(toGteLteFilter({})).toBeUndefined()
		expect(toGteLteFilter(undefined)).toBeUndefined()
	})

	test('toGtLtFilter maps min/max to exclusive gt/lt', () => {
		expect(toGtLtFilter({ min: 1, max: 10 })).toEqual({ gt: 1, lt: 10 })
		expect(toGtLtFilter({ max: 10 })).toEqual({ lt: 10 })
		expect(toGtLtFilter({})).toBeUndefined()
	})

	test('createMinMaxFilter works with dates', () => {
		const filter = createMinMaxFilter(z.coerce.date()).parse({
			min: '2024-01-01'
		})
		const range: { gte?: Date; lte?: Date } | undefined = toGteLteFilter(filter)

		expect(range).toEqual({ gte: new Date('2024-01-01') })
		expect(() => createMinMaxFilter(z.date()).parse({ max: 'x' })).toThrow()
	})
})

describe('jsonToZodSchemaMapper', () => {
	test('maps and parses nested objects', () => {
		const schema = z.object({
			name: z.string(),
			nested: z.object({ count: z.number() })
		})

		const raw = {
			name: 'a',
			nested: { count: 2 }
		}

		const out = jsonToZodSchemaMapper(raw, schema, {})
		expect(out).toEqual({ name: 'a', nested: { count: 2 } })
	})

	test('accepts nested configs for objects and arrays of objects', () => {
		const schema = z.object({
			id: z.string(),
			owner: z.object({ name: z.string() }).optional(),
			items: z.array(z.object({ sku: z.string(), qty: z.number() }))
		})

		const raw = {
			user_id: '1',
			owner: { full_name: 'Ada' },
			items: [
				{ code: 'a', qty: 1 },
				{ code: 'b', qty: 2 }
			]
		}

		const out = jsonToZodSchemaMapper(raw, schema, {
			id: (json) => json.user_id,
			owner: { name: (json) => json.full_name },
			items: { sku: (json) => json.code }
		})

		expect(out).toEqual({
			id: '1',
			owner: { name: 'Ada' },
			items: [
				{ sku: 'a', qty: 1 },
				{ sku: 'b', qty: 2 }
			]
		})
	})

	test('runs transforms once', () => {
		const schema = z.object({
			nested: z.object({ n: z.string().transform((s) => s.length) })
		})
		expect(jsonToZodSchemaMapper({ nested: { n: 'abc' } }, schema, {})).toEqual(
			{ nested: { n: 3 } }
		)
	})
})

describe('zodToTypeString', () => {
	test('serializes simple object schema', () => {
		const schema = z.object({
			id: z.number(),
			title: z.string().optional()
		})
		const text = zodToTypeString(schema)
		expect(text).toContain('id')
		expect(text).toContain('number')
		expect(text).toContain('title')
	})

	test('zodToExample produces a plain object for objects', () => {
		const schema = z.object({ ok: z.boolean() })
		expect(zodToExample(schema)).toEqual({ ok: false })
	})

	test('renders enums and literals as unions', () => {
		expect(zodToTypeString(z.enum(['a', 'b']))).toBe('"a" | "b"')
		expect(zodToExample(z.enum(['a', 'b']))).toBe('a')
		expect(zodToTypeString(z.literal(['x', 1]))).toBe('"x" | 1')
		expect(zodToExample(z.literal('x'))).toBe('x')
	})

	test('renders tuples, intersections and nullables', () => {
		const tuple = z.tuple([z.string(), z.number()], z.boolean())
		expect(zodToTypeString(tuple)).toBe('[string, number, ...boolean[]]')
		expect(zodToExample(tuple)).toEqual(['', 0])

		const both = z.intersection(
			z.object({ a: z.string() }),
			z.object({ b: z.number() })
		)
		expect(zodToTypeString(both)).toBe('{\n  a: string\n} & {\n  b: number\n}')
		expect(zodToExample(both)).toEqual({ a: '', b: 0 })

		expect(zodToTypeString(z.string().nullable())).toBe('string | null')
		expect(zodToExample(z.string().nullable())).toBe('')
		expect(zodToTypeString(z.array(z.string().nullable()))).toBe(
			'(string | null)[]'
		)
	})

	test('renders records, pipes and dates', () => {
		expect(zodToTypeString(z.record(z.enum(['a']), z.bigint()))).toBe(
			'Record<"a", bigint>'
		)
		expect(zodToTypeString(z.string().pipe(z.coerce.number()))).toBe('number')
		expect(zodToTypeString(z.string().transform((s) => s.length))).toBe(
			'string'
		)
		expect(zodToExample(z.date())).toBe('1970-01-01T00:00:00.000Z')
	})

	test('terminates on recursive lazy schemas', () => {
		type Node = { name: string; children: Node[] }
		const Node: z.ZodType<Node> = z.lazy(() =>
			z.object({ name: z.string(), children: z.array(Node) })
		)

		expect(zodToTypeString(Node)).toBe(
			'{\n  name: string\n  children: unknown[]\n}'
		)
		expect(zodToExample(Node)).toEqual({ name: '', children: [null] })
	})
})
