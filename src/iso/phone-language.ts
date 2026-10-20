import type { LanguageCode } from './languages'

/**
 * Country calling code (digits, no `+`) → the language a support conversation
 * with that number most likely wants. Only codes with one clear default are
 * listed; multilingual countries get their most common language.
 */
const CALLING_CODE_LANGUAGE = {
	'1': 'en', // NANP
	'31': 'nl',
	'32': 'nl', // Belgium: Dutch and French
	'33': 'fr',
	'34': 'es',
	'39': 'it',
	'41': 'de', // Switzerland: German, French and Italian
	'43': 'de',
	'44': 'en',
	'45': 'da',
	'46': 'sv',
	'47': 'nb',
	'49': 'de',
	'351': 'pt',
	'353': 'en'
} as const satisfies Record<string, LanguageCode>

type CallingCode = keyof typeof CALLING_CODE_LANGUAGE

// Longest first, so `351` wins over a shorter prefix.
const CALLING_CODES = (
	Object.keys(CALLING_CODE_LANGUAGE) as CallingCode[]
).sort((a, b) => b.length - a.length)

/**
 * A default language from an E.164 number's calling code (`+45…` → `'da'`),
 * or `null` when the number is missing, too short, or its code is unmapped.
 */
export function languageFromE164PhoneNumber(
	phoneNumber: string | null | undefined
) {
	const digits = phoneNumber?.trim().replace(/^\+/, '').replace(/\D/g, '')
	if (!digits) return null
	const code = CALLING_CODES.find(
		(code) => digits.startsWith(code) && digits.length > code.length
	)
	return code ? CALLING_CODE_LANGUAGE[code] : null
}
