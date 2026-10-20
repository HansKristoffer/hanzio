import { describe, expect, expectTypeOf, test } from 'bun:test'
import {
	type CountryCode,
	countryCodes,
	countryFlag,
	currencyCodes,
	currencyNames,
	isCountryCode,
	isCurrencyCode,
	isLanguageCode,
	languageCodes,
	languageFromE164PhoneNumber,
	languageNames,
	matchLanguageCode
} from '.'

describe('countries', () => {
	test('lists every ISO 3166-1 alpha-2 code once, sorted', () => {
		expect(countryCodes).toHaveLength(249)
		expect(countryCodes).toEqual([...countryCodes].sort())
		expect(isCountryCode('DK')).toBe(true)
		expect(isCountryCode('dk')).toBe(false)
		expect(isCountryCode('toString')).toBe(false)
		expectTypeOf<'DK'>().toExtend<CountryCode>()
	})

	test('countryFlag builds the regional-indicator pair', () => {
		expect(countryFlag('DK')).toBe('🇩🇰')
		expect(countryFlag('US')).toBe('🇺🇸')
	})
})

describe('currencies and languages', () => {
	test('every currency is known to Intl', () => {
		const supported = new Set(Intl.supportedValuesOf('currency'))
		expect(currencyCodes.filter((code) => !supported.has(code))).toEqual([])
		expect(currencyNames.DKK).toBe('Danish Krone')
		expect(isCurrencyCode('EUR')).toBe(true)
		expect(isCurrencyCode('HRK')).toBe(false)
	})

	test('languages are the 183 ISO 639-1 codes', () => {
		expect(languageCodes).toHaveLength(183)
		expect(languageNames.nb).toBe('Norwegian Bokmål')
		expect(isLanguageCode('da')).toBe(true)
	})

	test('matchLanguageCode reads the language out of a tag', () => {
		expect(matchLanguageCode('en')).toBe('en')
		expect(matchLanguageCode('en-GB')).toBe('en')
		expect(matchLanguageCode(' da_DK ')).toBe('da')
		expect(matchLanguageCode('DE-at')).toBe('de')
		expect(matchLanguageCode('nn-NO')).toBe('nn')
		expect(matchLanguageCode('')).toBeNull()
		expect(matchLanguageCode('{{lang}}')).toBeNull()
		expect(matchLanguageCode(null)).toBeNull()
	})
})

describe('languageFromE164PhoneNumber', () => {
	test('maps Nordic and major EU calling codes', () => {
		expect(languageFromE164PhoneNumber('+4512345678')).toBe('da')
		expect(languageFromE164PhoneNumber('+46701234567')).toBe('sv')
		expect(languageFromE164PhoneNumber('+4790123456')).toBe('nb')
		expect(languageFromE164PhoneNumber('+4915123456789')).toBe('de')
		expect(languageFromE164PhoneNumber('+33123456789')).toBe('fr')
		expect(languageFromE164PhoneNumber('+34600123456')).toBe('es')
		expect(languageFromE164PhoneNumber('+31201234567')).toBe('nl')
		expect(languageFromE164PhoneNumber('+390612345678')).toBe('it')
		expect(languageFromE164PhoneNumber('+447911123456')).toBe('en')
		expect(languageFromE164PhoneNumber('+12133734253')).toBe('en')
	})

	test('prefers the longest matching calling code', () => {
		expect(languageFromE164PhoneNumber('+351912345678')).toBe('pt')
		expect(languageFromE164PhoneNumber('+353871234567')).toBe('en')
	})

	test('returns null for missing, short, or unmapped numbers', () => {
		expect(languageFromE164PhoneNumber(null)).toBeNull()
		expect(languageFromE164PhoneNumber('')).toBeNull()
		expect(languageFromE164PhoneNumber('+45')).toBeNull()
		expect(languageFromE164PhoneNumber('+358401234567')).toBeNull()
		expect(languageFromE164PhoneNumber('4512345678')).toBe('da')
	})
})
