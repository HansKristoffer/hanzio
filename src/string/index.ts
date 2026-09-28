import type { Result } from '../promise'

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonObject
	| JsonArray
export type JsonObject = { [key: string]: JsonValue | undefined }
export type JsonArray = Array<JsonValue | undefined>

/**
 * Parses the first number-like token in a string. Only a `-` directly before
 * the digits is a sign, so `'2024-01-05'` gives `2024`. Whitespace and the
 * separator that isn't `decimalSeparator` are treated as thousands separators:
 * `'1,234.56'` gives `1234.56`, and `'1.234,56'` with `decimalSeparator: ','`
 * gives `1234.56`.
 */
export function extractNumber(
	value: string | null | undefined,
	options: { decimalSeparator?: '.' | ',' } = {}
): number | undefined {
	const { decimalSeparator = '.' } = options
	const decimal = decimalSeparator === '.' ? '\\.' : ','
	const thousands = decimalSeparator === '.' ? ',' : '\\.'
	// First number-like token. A thousands separator (or whitespace) only counts
	// when exactly three digits follow it, so '12,5' reads as 12, not 125.
	const token = value?.match(
		new RegExp(
			`-?(?:\\d+(?:(?:${thousands}|\\s)\\d{3}(?!\\d))*(?:${decimal}\\d+)?|${decimal}\\d+)`
		)
	)?.[0]
	if (!token) return undefined

	const parsedNumber = Number.parseFloat(
		token
			.replace(/\s/g, '')
			.replaceAll(decimalSeparator === '.' ? ',' : '.', '')
			.replace(decimalSeparator, '.')
	)
	return Number.isNaN(parsedNumber) ? undefined : parsedNumber
}

/**
 * A stable, short, non-cryptographic hash key (32-bit, 8 hex chars) for
 * JSON-like input. Object key order and query-string parameter order don't
 * matter. Collisions become likely above ~10k distinct inputs; use `sha256Id`
 * where that matters.
 */
export function generateId(input: JsonValue | undefined): string {
	const data = normalizeIdInput(input)
	let hash = 0

	for (let index = 0; index < data.length; index++) {
		const char = data.charCodeAt(index)
		hash = (hash << 5) - hash + char
		hash |= 0
	}

	return Math.abs(hash).toString(16).padStart(8, '0')
}

/** Like `generateId`, but a SHA-256 hex digest truncated to `length` chars. */
export async function sha256Id(
	input: JsonValue | undefined,
	length = 16
): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(normalizeIdInput(input))
	)
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, '0')
	)
		.join('')
		.slice(0, length)
}

// Letters that NFKD doesn't split into a base letter plus a combining mark.
const UNDECOMPOSED_LETTERS: Record<string, string> = {
	æ: 'ae',
	Æ: 'AE',
	ø: 'o',
	Ø: 'O',
	œ: 'oe',
	Œ: 'OE',
	ß: 'ss',
	ẞ: 'SS',
	đ: 'd',
	Đ: 'D',
	ł: 'l',
	Ł: 'L',
	þ: 'th',
	Þ: 'TH',
	ð: 'd',
	Ð: 'D'
}

/** Removes accents and spells out letters like `æ`, `ø` and `ß` in ASCII. */
function stripAccents(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.replace(
			/[æøœßđłþðÆØŒẞĐŁÞÐ]/g,
			(letter) => UNDECOMPOSED_LETTERS[letter] ?? ''
		)
}

export type SlugifyOptions = {
	/** Placed between words (default `'-'`). */
	separator?: string
	/** Default `true`. */
	lowercase?: boolean
	/** Cuts the slug to at most this many characters, without a trailing separator. */
	maxLength?: number
}

/**
 * Turns text into a URL slug: strips accents, turns `&` into `and`, splits
 * words on whitespace and `-_/,:;·`, and drops every other non-ASCII-alphanumeric
 * character.
 */
export function slugify(value: string, options: SlugifyOptions = {}): string {
	const { separator = '-', lowercase = true, maxLength } = options
	const slug = stripAccents(value)
		.replace(/&/g, ' and ')
		.replace(/[\s\-_/,:;·]+/g, ' ')
		.replace(/[^a-zA-Z0-9 ]/g, '')
		.trim()
		.split(/ +/)
		.join(separator)
	const cased = lowercase ? slug.toLowerCase() : slug

	if (maxLength === undefined || cased.length <= maxLength) return cased
	// Words are alphanumeric, so anything non-alphanumeric at the end is
	// (part of) a separator.
	return cased.slice(0, maxLength).replace(/[^a-zA-Z0-9]+$/, '')
}

/**
 * JSON.stringify with sorted object keys, so `{ a, b }` and `{ b, a }` produce
 * the same string. Also encodes values JSON drops or rejects: `bigint`,
 * `Map` and `Set`. Use it for cache and dedupe keys.
 */
export function stableStringify(value: unknown): string {
	return (
		JSON.stringify(value, (_key, item: unknown) => {
			if (typeof item === 'bigint') return `${item}n`
			if (item instanceof Map) return { $map: [...item.entries()] }
			if (item instanceof Set) return { $set: [...item] }
			if (item && typeof item === 'object' && !Array.isArray(item)) {
				const record = item as Record<string, unknown>
				return Object.fromEntries(
					Object.keys(record)
						.sort()
						.map((key) => [key, record[key]])
				)
			}
			return item
		}) ?? 'undefined'
	)
}

/**
 * Cuts text to at most `maxLength` user-visible characters, ellipsis included.
 * Never splits an emoji or accented letter, and drops whitespace before the
 * ellipsis. With `wordBoundary`, cuts at the last space unless that would leave
 * nothing.
 */
export function truncate(
	text: string,
	maxLength: number,
	options: { ellipsis?: string; wordBoundary?: boolean } = {}
): string {
	const { ellipsis = '…', wordBoundary = false } = options
	const characters = graphemes(text)
	if (characters.length <= maxLength) return text

	const ellipsisCharacters = graphemes(ellipsis)
	const room = maxLength - ellipsisCharacters.length
	if (room <= 0) return ellipsisCharacters.slice(0, maxLength).join('')

	let cut = characters.slice(0, room).join('')
	if (wordBoundary && !/^\s/.test(characters[room] ?? '')) {
		const lastSpace = cut.search(/\s\S*$/)
		if (lastSpace > 0) cut = cut.slice(0, lastSpace)
	}
	return cut.trimEnd() + ellipsis
}

/** Collapses every whitespace run (NBSP and newlines included) to one space and trims. */
export function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, ' ').trim()
}

/**
 * Escapes text for literal use in a `RegExp`. `-` becomes `\x2d` so the result
 * is also valid with the `u` and `v` flags.
 */
export function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/-/g, '\\x2d')
}

/** Lowercases and strips accents, so `'Ærø Café'` becomes `'aero cafe'`. */
export function foldForSearch(text: string): string {
	return stripAccents(text).toLowerCase()
}

/**
 * True when every whitespace-separated query term appears in at least one
 * field, ignoring case and accents. An empty query matches everything.
 */
export function matchesSearch(
	query: string,
	...fields: (string | null | undefined)[]
): boolean {
	const haystack = foldForSearch(fields.filter(Boolean).join('\n'))
	return foldForSearch(query)
		.split(/\s+/)
		.every((term) => haystack.includes(term))
}

const HAS_LETTER = /\p{L}/u

/**
 * Up to `max` (default 2) uppercase letters for an avatar, or `''` when the
 * value has no letters (phone numbers, `'—'`). One word gives its first
 * letters (`'Ada'` → `'AD'`), several give first and last (`'Hans Kristoffer
 * Hansen'` → `'HH'`). An email is read as its local part without the `+tag`:
 * `'ada.lovelace+news@x.com'` → `'AL'`.
 */
export function initials(
	name: string | null | undefined,
	options: { max?: number } = {}
): string {
	const { max = 2 } = options
	const trimmed = name?.trim() ?? ''
	const source = /^[^\s@]+@[^\s@]+$/.test(trimmed)
		? (trimmed.split('@')[0] ?? '').replace(/\+.*$/, '').replace(/[._-]+/g, ' ')
		: trimmed
	const words = source.split(/\s+/).filter((word) => HAS_LETTER.test(word))
	const first = words[0]
	if (!first) return ''
	if (words.length === 1) return fromFirstLetter(first, max).toUpperCase()

	// Keep the last word (the surname) when there are more words than letters.
	const head = words.slice(0, Math.max(1, max - 1))
	const picked =
		words.length > max ? [...head, words.at(-1) ?? first].slice(0, max) : words
	return picked
		.map((word) => fromFirstLetter(word, 1))
		.join('')
		.toUpperCase()
}

/** `JSON.parse` that returns a `Result` instead of throwing. */
export function safeJsonParse<T = unknown>(
	text: string
): Result<T, SyntaxError> {
	try {
		return { ok: true, data: JSON.parse(text) as T, error: null }
	} catch (error) {
		return { ok: false, data: null, error: error as SyntaxError }
	}
}

// `count` characters from the word's first letter, so brackets around a name
// are skipped but digits after it are kept (`'R2D2'` → `'R2'`).
function fromFirstLetter(word: string, count: number): string {
	const characters = graphemes(word)
	const start = characters.findIndex((character) => HAS_LETTER.test(character))
	if (start === -1) return ''
	return characters.slice(start, start + count).join('')
}

let segmenter: Intl.Segmenter | undefined

// Grapheme clusters when `Intl.Segmenter` exists, otherwise code points.
function graphemes(text: string): string[] {
	if (typeof Intl === 'undefined' || !('Segmenter' in Intl)) return [...text]
	segmenter ??= new Intl.Segmenter()
	return Array.from(segmenter.segment(text), ({ segment }) => segment)
}

function normalizeIdInput(input: JsonValue | undefined): string {
	if (input === undefined) return 'undefined'
	if (input === null) return 'null'
	if (typeof input === 'string') {
		return safeDecodeURIComponent(input).split('&').sort().join('&')
	}
	if (typeof input === 'number' || typeof input === 'boolean') {
		return input.toString()
	}
	return JSON.stringify(sortJsonValue(input))
}

function sortJsonValue(value: JsonValue | undefined): JsonValue | null {
	if (value === undefined) return null

	if (Array.isArray(value)) {
		return value.map((item) => sortJsonValue(item))
	}

	if (typeof value === 'object' && value !== null) {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, itemValue]) => itemValue !== undefined)
				.sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
				.map(([key, itemValue]) => [key, sortJsonValue(itemValue)])
		)
	}

	return value
}

function safeDecodeURIComponent(value: string): string {
	try {
		return decodeURIComponent(value)
	} catch {
		return value
	}
}
