import { describe, expect, test } from 'bun:test'
import { compressString, decompressString } from '.'

describe('gzip', () => {
	test('roundtrips UTF-8 text', () => {
		const original = 'Hello åæø 🔒'
		const compressed = compressString(original)
		expect(compressed.length).toBeGreaterThan(0)
		expect(decompressString(compressed)).toBe(original)
	})
})
