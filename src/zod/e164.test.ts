import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { zOptionalE164 } from './index.js'

describe('zOptionalE164', () => {
	test('accepts E.164, maps empty and null to null, rejects malformed', () => {
		expect(zOptionalE164.parse('+4512345678')).toBe('+4512345678')
		expect(zOptionalE164.parse('')).toBeNull()
		expect(zOptionalE164.parse(null)).toBeNull()
		expect(zOptionalE164.safeParse('12345').success).toBe(false)
		expect(zOptionalE164.safeParse('+0123456789').success).toBe(false)
	})

	test('serializes without an empty enum value (Gemini rejects enum: [""])', () => {
		const json = JSON.stringify(
			z.toJSONSchema(z.object({ phone: zOptionalE164 }), {
				io: 'input',
				unrepresentable: 'any'
			})
		)
		expect(json).not.toContain('"const":""')
		expect(json).not.toContain('"enum":[""]')
	})

	test('infers string | null as output', () => {
		const phone: string | null = zOptionalE164.parse('')
		expect(phone).toBeNull()
	})
})
