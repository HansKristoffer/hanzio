// Phone numbers for people to read. Needs `libphonenumber-js` (its default
// "min" metadata is about 84 KB, which is why this is not in `hanzio/format`).

import {
	isSupportedCountry,
	parsePhoneNumberFromString
} from 'libphonenumber-js'

/**
 * A stored phone number as a person reads it. `country` is the READER's ISO
 * 3166-1 alpha-2 country (the organization's, say), not the number's: a local
 * number prints the local way, any other with its country code.
 *
 * ```ts
 * formatPhone('+4520304050', 'DK') // '20 30 40 50'
 * formatPhone('+4520304050') // '+45 20 30 40 50'
 * formatPhone('+4915112345678', 'DK') // '+49 1511 2345678'
 * ```
 *
 * Nothing is lost: an unparseable value comes back trimmed but verbatim, and
 * the national form is used only for a VALID number (`+4512345678` parses as
 * DK but is not a real number, so it keeps its `+45`). A country
 * libphonenumber cannot dial falls back to international. Empty input is
 * `''`; the caller decides what stands in for "no number". Use the raw E.164
 * value in `tel:` links.
 */
export function formatPhone(
	value: string | null | undefined,
	country?: string | null
): string {
	const raw = value?.trim() ?? ''
	if (!raw) return ''
	const region = country && isSupportedCountry(country) ? country : undefined
	const parsed = parsePhoneNumberFromString(
		raw,
		region ? { defaultCountry: region } : undefined
	)
	if (!parsed) return raw
	if (region && parsed.country === region && parsed.isValid()) {
		return parsed.formatNational()
	}
	return parsed.formatInternational()
}
