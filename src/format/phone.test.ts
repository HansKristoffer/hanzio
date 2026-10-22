import { describe, expect, test } from 'bun:test'
import { formatPhone } from './phone.js'

describe('formatPhone', () => {
	test('prints a local number the way a local writes it', () => {
		// Real Danish mobile prefixes. `+4512345678` looks Danish and is NOT a
		// valid DK number - see the invalid-number test below.
		expect(formatPhone('+4520304050', 'DK')).toBe('20 30 40 50')
		expect(formatPhone('+4570123456', 'DK')).toBe('70 12 34 56')
		expect(formatPhone('+4791234567', 'NO')).toBe('91 23 45 67')
	})

	test('prints a foreign number with its country code', () => {
		expect(formatPhone('+4915112345678', 'DK')).toBe('+49 1511 2345678')
		expect(formatPhone('+12125551234', 'DK')).toBe('+1 212 555 1234')
	})

	test('without an org country everything is international', () => {
		expect(formatPhone('+4520304050')).toBe('+45 20 30 40 50')
		expect(formatPhone('+12125551234')).toBe('+1 212 555 1234')
	})

	test('accepts a national-format number and the org country', () => {
		expect(formatPhone('20304050', 'DK')).toBe('20 30 40 50')
		expect(formatPhone('20 30 40 50', 'DK')).toBe('20 30 40 50')
	})

	test('keeps the country code on a number that is not valid', () => {
		// The known trap: libphonenumber parses `+4512345678` as DK and rejects
		// it, but `formatNational()` would still hand back a bare `12345678`.
		// Dropping the `+45` from something a human may need to dial is worse
		// than a long label, so an invalid number stays international.
		expect(formatPhone('+4512345678', 'DK')).toBe('+45 12345678')
	})

	test('a country libphonenumber cannot dial falls back instead of throwing', () => {
		expect(formatPhone('+4520304050', 'AQ')).toBe('+45 20 30 40 50')
	})

	test('never loses an unparseable value', () => {
		expect(formatPhone('  extension 4021  ')).toBe('extension 4021')
		expect(formatPhone('12345678')).toBe('12345678')
	})

	test('empty input is an empty label, not a dash', () => {
		// The caller decides what stands in for "no number" (EM_DASH, a hollow
		// avatar, a hidden row); a formatter that invented one would be a second
		// opinion about emptiness.
		expect(formatPhone('')).toBe('')
		expect(formatPhone('   ')).toBe('')
		expect(formatPhone(null)).toBe('')
		expect(formatPhone(undefined)).toBe('')
	})
})
