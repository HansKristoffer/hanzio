import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { jsonToZodSchemaMapper } from './jsonToZodSchemaMapper'
import { toGteLteFilter } from './zodMinMaxFilter'
import { zodToExample, zodToTypeString } from './zodToTypeString'

describe('toGteLteFilter', () => {
	test('maps min/max to gte/lte', () => {
		expect(toGteLteFilter({ min: 1, max: 10 })).toEqual({ gte: 1, lte: 10 })
		expect(toGteLteFilter({ min: 5 })).toEqual({ gte: 5 })
		expect(toGteLteFilter({})).toBeUndefined()
		expect(toGteLteFilter(undefined)).toBeUndefined()
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
})
