/**
 * Content rules for translation VALUES, which key and placeholder parity cannot
 * see: source code stored as copy ("row.name", "carTitle(car)") by an automated
 * extraction pass, copy in the wrong language committed to the base catalog,
 * banned product vocabulary, and English shipped untranslated.
 */

export type ContentRulesConfig = {
	/**
	 * Key prefixes the vocabulary and untranslated rules skip, such as internal
	 * admin tooling or a marketing site with its own copy owner.
	 */
	exemptKeyPrefixes?: readonly string[]
	/** Values that legitimately look like code, such as `'Solgt.com'`. */
	allowCodeShapes?: readonly string[]
	/**
	 * Flags base-catalog values written in another language: two distinct
	 * marker words, or one plus a letter from `letters`.
	 */
	wrongLanguage?: {
		/** Function words of the other language that are not English words. */
		markers: readonly string[]
		/** Letters only that language uses, e.g. `'æøåÆØÅ'`. */
		letters?: string
		allowKeys?: readonly string[]
	}
	bannedWords?: {
		/** Banned in every catalog, the base included. */
		everywhere?: readonly string[]
		/** Banned in translations only (loanwords readers do not use). */
		translations?: readonly string[]
		allowKeys?: readonly string[]
	}
	/** Translations allowed to equal the base value. */
	identical?: {
		/** Leading words (brands, acronyms) that make a value correct as-is. */
		brands?: readonly string[]
		/** Keys correct as-is, in the listed locales or `'all'`. */
		allowKeys?: Readonly<Record<string, readonly string[] | 'all'>>
	}
}

const PLACEHOLDER_MASK = '￼'
const EXPRESSION_FRAGMENT = /(?:\?\?|=>|\bas\s+(?:string|number|boolean)\b)/

/** Placeholders are content, so `{count} mo.` must not read as a dotted path. */
const maskPlaceholders = (value: string) =>
	value.replace(/\{[^}]*\}/g, PLACEHOLDER_MASK)

const escapeRegExp = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const wordPattern = (words: readonly string[], flags: string) =>
	new RegExp(`\\b(?:${words.map(escapeRegExp).join('|')})\\w*`, flags)

const CODE_SHAPES: { name: string; pattern: RegExp }[] = [
	// carTitle(car), stageName(enrollment.stageId)
	{ name: 'call expression', pattern: /^[A-Za-z_$][\w$]*\([^)]*\)$/ },
	// FIELD_LABELS[field.name]
	{ name: 'index expression', pattern: /^[A-Za-z_$][\w$]*\[[^\]]*\]$/ },
	// row.name - a lowercase first segment separates this from "Solgt.com"
	{
		name: 'member expression',
		pattern: /^[a-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/
	},
	{ name: 'constant reference', pattern: /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/ },
	// updateNodeDescription; plain words ("Cancel") do not match
	{ name: 'identifier', pattern: /^[a-z][a-z0-9]*(?:[A-Z][a-zA-Z0-9]*)+$/ },
	// `run.status ?? undefined`, `row.role as string`, arrow bodies
	{ name: 'expression fragment', pattern: EXPRESSION_FRAGMENT }
]

/** Acronyms correct in every language, on top of the configured brands. */
const DEFAULT_BRANDS = ['API', 'URL', 'SMS', 'CSV', 'PDF', 'ID', 'OK']

const ENGLISH_FUNCTION_WORDS =
	/\b(?:the|an|is|are|was|were|you|your|and|to|for|with|from|this|that|will|can|not|of|in|on|it|we|our|has|have|been)\b/gi

/** Any letter outside ASCII: the value is not plain English. */
const NON_ASCII_LETTER = /(?![A-Za-z])\p{L}/u
/** Paths, selectors, domains, emails and colour codes are not prose. */
const NON_PROSE = /[/@#=_{}[\]<>]|\.[a-z]{2,}/

export type ContentRules = ReturnType<typeof createContentRules>

/** Compiles the configured rules once; each detector returns why, or null. */
export function createContentRules(config: ContentRulesConfig = {}) {
	const exempt = config.exemptKeyPrefixes ?? []
	const isExempt = (key: string) =>
		exempt.some((prefix) => key.startsWith(prefix))
	const codeAllow = new Set(config.allowCodeShapes ?? [])

	const wrongLanguage = config.wrongLanguage
	const markerPattern = wrongLanguage?.markers.length
		? new RegExp(
				`\\b(?:${wrongLanguage.markers.map(escapeRegExp).join('|')})\\b`,
				'giu'
			)
		: undefined
	const markerLetters = wrongLanguage?.letters
		? new RegExp(`[${escapeRegExp(wrongLanguage.letters)}]`, 'u')
		: undefined
	const wrongLanguageAllow = new Set(wrongLanguage?.allowKeys ?? [])

	const everywhere = config.bannedWords?.everywhere ?? []
	const translations = config.bannedWords?.translations ?? []
	const bannedInBase = everywhere.length
		? wordPattern(everywhere, 'iu')
		: undefined
	const bannedInTranslations =
		everywhere.length || translations.length
			? wordPattern([...translations, ...everywhere], 'iu')
			: undefined
	const bannedAllow = new Set(config.bannedWords?.allowKeys ?? [])

	const brands = [...DEFAULT_BRANDS, ...(config.identical?.brands ?? [])]
	const brandOrSymbols = new RegExp(
		`^[\\W\\d]*$|^(?:${brands.map(escapeRegExp).join('|')})\\b`,
		'i'
	)
	const identicalAllow = config.identical?.allowKeys ?? {}
	const isAllowedIdentical = (key: string, locale: string) => {
		const locales = Object.hasOwn(identicalAllow, key)
			? identicalAllow[key]
			: undefined
		return locales === 'all' || (locales?.includes(locale) ?? false)
	}

	return {
		/** The shape name when a value looks like source code. */
		codeShape(value: string): string | null {
			const trimmed = value.trim()
			if (!trimmed || codeAllow.has(trimmed)) return null
			const masked = maskPlaceholders(trimmed)
			// A placeholder means the value is a real template, not code.
			if (masked.includes(PLACEHOLDER_MASK)) return null
			// Whitespace means prose, unless it is an expression fragment.
			if (/\s/.test(masked) && !EXPRESSION_FRAGMENT.test(masked)) return null
			return (
				CODE_SHAPES.find(({ pattern }) => pattern.test(masked))?.name ?? null
			)
		},

		/** The marker words found when a base value is in the wrong language. */
		wrongLanguage(key: string, value: string): string | null {
			if (!markerPattern || wrongLanguageAllow.has(key)) return null
			const distinct = new Set(
				(value.match(markerPattern) ?? []).map((m) => m.toLowerCase())
			)
			if (distinct.size === 0) return null
			if (distinct.size >= 2 || markerLetters?.test(value)) {
				return [...distinct].sort().join(', ')
			}
			return null
		},

		/** The offending word when a value uses banned vocabulary. */
		bannedWord(key: string, value: string, isBase: boolean): string | null {
			if (bannedAllow.has(key) || isExempt(key)) return null
			const pattern = isBase ? bannedInBase : bannedInTranslations
			// A placeholder named {pipeline} is a variable, not the word.
			return pattern?.exec(maskPlaceholders(value))?.[0] ?? null
		},

		/**
		 * A translation identical to its English source that reads as English
		 * prose: three or more words, two distinct English function words.
		 */
		untranslatedEnglish(
			key: string,
			locale: string,
			source: string,
			translated: string
		): boolean {
			if (source !== translated) return false
			if (isAllowedIdentical(key, locale) || isExempt(key)) return false
			const value = translated.trim()
			if (value.split(/\s+/).length < 3) return false
			if (brandOrSymbols.test(value) || NON_ASCII_LETTER.test(value)) {
				return false
			}
			const matches = value.match(ENGLISH_FUNCTION_WORDS) ?? []
			return new Set(matches.map((m) => m.toLowerCase())).size >= 2
		},

		/**
		 * A label of two or more words identical to its source ("Document
		 * name"). Single words stay out of scope: "Status" and "Email" are
		 * correct in many languages.
		 */
		identicalLabel(
			key: string,
			locale: string,
			source: string,
			translated: string
		): boolean {
			if (source !== translated) return false
			if (isAllowedIdentical(key, locale) || isExempt(key)) return false
			const value = translated.trim()
			if (NON_PROSE.test(value) || brandOrSymbols.test(value)) return false
			if (NON_ASCII_LETTER.test(value)) return false
			return (value.match(/\p{L}{2,}/gu) ?? []).length >= 2
		}
	}
}
