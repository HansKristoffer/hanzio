import { describe, expect, test } from 'bun:test'
import {
	escapeRegExp,
	extractNumber,
	foldForSearch,
	generateId,
	initials,
	matchesSearch,
	normalizeWhitespace,
	safeJsonParse,
	sha256Id,
	slugify,
	stableStringify,
	truncate
} from '.'

describe('string utilities', () => {
	test('extractNumber parses numbers from strings', () => {
		expect(extractNumber('Price: 123.45 kr')).toBe(123.45)
		expect(extractNumber('-42 items')).toBe(-42)
		expect(extractNumber('')).toBeUndefined()
		expect(extractNumber('abc')).toBeUndefined()
		expect(extractNumber(null)).toBeUndefined()
	})

	test('extractNumber handles thousands separators and signs', () => {
		expect(extractNumber('1,234.56')).toBe(1234.56)
		expect(extractNumber('1.234,56 kr', { decimalSeparator: ',' })).toBe(
			1234.56
		)
		expect(extractNumber('12,5', { decimalSeparator: ',' })).toBe(12.5)
		expect(extractNumber('1\u202f234,5', { decimalSeparator: ',' })).toBe(
			1234.5
		)
		expect(extractNumber('12,5')).toBe(12)
		expect(extractNumber('1,23456')).toBe(1)
		expect(extractNumber('2024-01-05')).toBe(2024)
		expect(extractNumber('Balance: -1,000')).toBe(-1000)
	})

	test('generateId creates stable ids for primitive values', () => {
		expect(generateId('b=2&a=1')).toBe(generateId('a=1&b=2'))
		expect(generateId(123)).toBe(generateId(123))
		expect(generateId(undefined)).toBe(generateId(undefined))
	})

	test('generateId normalizes object key order', () => {
		expect(generateId({ b: 2, a: 1 })).toBe(generateId({ a: 1, b: 2 }))
		expect(generateId({ a: 1, b: undefined })).toBe(generateId({ a: 1 }))
	})

	test('generateId keeps existing ids and tolerates malformed escapes', () => {
		expect(generateId('a=1&b=2')).toBe('76194ec6')
		expect(generateId({ page: 1 })).toBe('4382efda')
		expect(generateId('100%')).toBe(generateId('100%'))
	})

	test('sha256Id hashes normalized input', async () => {
		expect(await sha256Id('abc')).toBe('ba7816bf8f01cfea')
		expect(await sha256Id({ b: 1, a: 2 }, 64)).toBe(
			await sha256Id({ a: 2, b: 1 }, 64)
		)
		expect(await sha256Id('abc', 64)).toHaveLength(64)
	})

	test('generateId keeps array order significant', () => {
		expect(generateId([1, 2, 3])).not.toBe(generateId([3, 2, 1]))
	})

	test('slugify normalizes text for URLs', () => {
		expect(slugify('Hello World!')).toBe('hello-world')
		expect(slugify('Crème brûlée & tea')).toBe('creme-brulee-and-tea')
		expect(slugify(' /Already---spaced/ ')).toBe('already-spaced')
		expect(slugify('Hello, København!')).toBe('hello-kobenhavn')
		expect(slugify("Don't: a_b;c·d")).toBe('dont-a-b-c-d')
	})

	test('slugify transliterates letters that do not decompose', () => {
		expect(slugify('Æble Øl Straße Łódź þorn')).toBe(
			'aeble-ol-strasse-lodz-thorn'
		)
	})

	test('slugify supports separator, lowercase and maxLength', () => {
		expect(slugify('Hello World', { separator: '_', lowercase: false })).toBe(
			'Hello_World'
		)
		expect(slugify('Hello big world', { maxLength: 9 })).toBe('hello-big')
		expect(slugify('Hello big world', { maxLength: 10 })).toBe('hello-big')
		expect(slugify('Hello big world', { maxLength: 10, separator: '__' })).toBe(
			'hello__big'
		)
		expect(slugify('Hello', { maxLength: 3 })).toBe('hel')
	})
})

describe('stableStringify', () => {
	test('ignores key order and encodes Map, Set and bigint', () => {
		expect(stableStringify({ b: 1, a: { d: 1, c: 2 } })).toBe(
			stableStringify({ a: { c: 2, d: 1 }, b: 1 })
		)
		expect(stableStringify(new Map([['a', 1]]))).not.toBe(
			stableStringify(new Map([['b', 1]]))
		)
		expect(stableStringify(new Set([1]))).not.toBe(stableStringify(new Set()))
		expect(stableStringify(10n)).toBe('"10n"')
		expect(stableStringify(undefined)).toBe('undefined')
	})
})

describe('truncate', () => {
	test('returns text unchanged when it fits', () => {
		expect(truncate('hello', 5)).toBe('hello')
		expect(truncate('', 0)).toBe('')
	})

	test('keeps the result within maxLength, ellipsis included', () => {
		expect(truncate('hello world', 8)).toBe('hello w…')
		expect(truncate('hello world', 6)).toBe('hello…')
		expect(truncate('hello world', 7, { ellipsis: '...' })).toBe('hell...')
		expect(truncate('hello world', 5, { ellipsis: '' })).toBe('hello')
	})

	test('trims whitespace before the ellipsis', () => {
		expect(truncate('hello   world', 8)).toBe('hello…')
	})

	test('never splits emoji or combining characters', () => {
		expect(truncate('👨‍👩‍👧👍🏽abc', 3)).toBe('👨‍👩‍👧👍🏽…')
		expect(truncate('e\u0301e\u0301e\u0301', 2)).toBe('e\u0301…')
		expect(truncate('😀😀😀', 2)).toBe('😀…')
	})

	test('wordBoundary cuts at the last space', () => {
		expect(truncate('hello world again', 14, { wordBoundary: true })).toBe(
			'hello world…'
		)
		// The cut already falls on a space.
		expect(truncate('hello world again', 12, { wordBoundary: true })).toBe(
			'hello world…'
		)
		// One long word falls back to a hard cut.
		expect(truncate('supercalifragilistic', 6, { wordBoundary: true })).toBe(
			'super…'
		)
	})

	test('maxLength smaller than the ellipsis', () => {
		expect(truncate('hello', 2, { ellipsis: '...' })).toBe('..')
		expect(truncate('hello', 0)).toBe('')
	})
})

describe('normalizeWhitespace', () => {
	test('collapses runs, including NBSP and narrow NBSP, and trims', () => {
		expect(normalizeWhitespace('  a \n\t b\u00a0\u00a0c\u202fd  ')).toBe(
			'a b c d'
		)
		expect(normalizeWhitespace('   ')).toBe('')
	})
})

describe('escapeRegExp', () => {
	test('matches the input literally', () => {
		const special = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o/p-q'
		expect(new RegExp(`^${escapeRegExp(special)}$`).test(special)).toBe(true)
		expect(new RegExp(`^${escapeRegExp(special)}$`, 'u').test(special)).toBe(
			true
		)
		expect(new RegExp(`[${escapeRegExp('a-z')}]`, 'v').test('b')).toBe(false)
		expect(escapeRegExp('1.5')).toBe('1\\.5')
		expect(escapeRegExp('plain')).toBe('plain')
	})
})

describe('matchesSearch', () => {
	test('folds case, accents and Nordic letters', () => {
		expect(foldForSearch('Ærø Café Straße')).toBe('aero cafe strasse')
		expect(matchesSearch('cafe', 'Café Noir')).toBe(true)
		expect(matchesSearch('AERO', 'ærø')).toBe(true)
		expect(matchesSearch('Søren', 'soren kierkegaard')).toBe(true)
	})

	test('every term must match somewhere across fields', () => {
		expect(matchesSearch('ada london', 'Ada Lovelace', null, 'London')).toBe(
			true
		)
		expect(matchesSearch('ada paris', 'Ada Lovelace', 'London')).toBe(false)
		// Terms do not match across the gap between fields.
		expect(matchesSearch('lovelacelondon', 'Ada Lovelace', 'London')).toBe(
			false
		)
	})

	test('an empty query matches everything', () => {
		expect(matchesSearch('', 'x')).toBe(true)
		expect(matchesSearch('   ')).toBe(true)
		expect(matchesSearch('x')).toBe(false)
	})
})

describe('initials', () => {
	test('a full name gives the outer pair', () => {
		expect(initials('Hans Kristoffer Hansen')).toBe('HH')
		expect(initials('Ada Lovelace')).toBe('AL')
		expect(initials('  Ada   Lovelace  ')).toBe('AL')
	})

	test('one word gives its first two characters', () => {
		expect(initials('Ada')).toBe('AD')
		expect(initials('A')).toBe('A')
	})

	test('an email is read as its local part without the +tag', () => {
		expect(initials('jane.doe@example.com')).toBe('JD')
		expect(initials('jane_doe@example.com')).toBe('JD')
		expect(initials('ada.lovelace+tag@x.com')).toBe('AL')
		expect(initials('jane+work@example.com')).toBe('JA')
		expect(initials('hk@anyhow.dk')).toBe('HK')
	})

	test('values without letters yield nothing', () => {
		expect(initials('+45 20 30 40 50')).toBe('')
		expect(initials('+4520304050')).toBe('')
		expect(initials('20304050')).toBe('')
		expect(initials('')).toBe('')
		expect(initials('   ')).toBe('')
		expect(initials(null)).toBe('')
		expect(initials(undefined)).toBe('')
		expect(initials('- · —')).toBe('')
	})

	test('non-Latin scripts work without transliteration', () => {
		expect(initials('Иван Петров')).toBe('ИП')
		expect(initials('Γιώργος')).toBe('ΓΙ')
		expect(initials('田中太郎')).toBe('田中')
		expect(initials('محمد علي')).toBe('مع')
	})

	test('decoration is skipped, digits inside a name are kept', () => {
		expect(initials('(Ada) Lovelace')).toBe('AL')
		expect(initials('R2D2')).toBe('R2')
	})

	test('astral and combining characters survive intact', () => {
		expect(initials('𝒜da')).toBe('𝒜D')
		expect(initials('e\u0301mile zola')).toBe('E\u0301Z')
		expect(initials('👋 Ada')).toBe('AD')
	})

	test('max controls how many letters are taken', () => {
		expect(initials('Hans Kristoffer Hansen', { max: 3 })).toBe('HKH')
		expect(initials('A B C D', { max: 3 })).toBe('ABD')
		expect(initials('Ada Lovelace', { max: 3 })).toBe('AL')
		expect(initials('Ada Lovelace', { max: 1 })).toBe('A')
		expect(initials('Ada', { max: 1 })).toBe('A')
		expect(initials('Ada', { max: 0 })).toBe('')
	})
})

describe('safeJsonParse', () => {
	test('returns data on success and a SyntaxError on failure', () => {
		expect(safeJsonParse<{ a: number }>('{"a":1}')).toEqual({
			ok: true,
			data: { a: 1 },
			error: null
		})
		expect(safeJsonParse('null')).toEqual({ ok: true, data: null, error: null })
		const failed = safeJsonParse('{oops')
		expect(failed.ok).toBe(false)
		expect(failed.error).toBeInstanceOf(SyntaxError)
		expect(safeJsonParse('').ok).toBe(false)
	})
})
