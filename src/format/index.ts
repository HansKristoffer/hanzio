// Locale-aware formatting on top of `Intl`. Every function takes the locale
// (a BCP-47 tag) explicitly, and everything that reads the clock takes `now`.

import { stableStringify } from '../string'

type DateInput = Date | string | number

const MAX_CACHED_FORMATTERS = 100

// ponytail: one LRU per formatter kind, 100 entries each; raise if an app
// really cycles through more (locale, options) pairs than that.
function memoize<O extends object, F>(
	create: (locale: string, options?: O) => F
): (locale: string, options?: O) => F {
	const cache = new Map<string, F>()
	return (locale, options) => {
		const key = `${locale}|${options ? stableStringify(options) : ''}`
		let formatter = cache.get(key)
		if (formatter) {
			cache.delete(key)
		} else {
			formatter = create(locale, options)
			if (cache.size >= MAX_CACHED_FORMATTERS) {
				const oldest = cache.keys().next().value
				if (oldest !== undefined) cache.delete(oldest)
			}
		}
		cache.set(key, formatter)
		return formatter
	}
}

/** Cached `Intl.NumberFormat`, one instance per (locale, options). */
export const getNumberFormat = memoize(
	(locale, options?: Intl.NumberFormatOptions) =>
		new Intl.NumberFormat(locale, options)
)

/** Cached `Intl.DateTimeFormat`, one instance per (locale, options). */
export const getDateTimeFormat = memoize(
	(locale, options?: Intl.DateTimeFormatOptions) =>
		new Intl.DateTimeFormat(locale, options)
)

/** Cached `Intl.RelativeTimeFormat`, one instance per (locale, options). */
export const getRelativeTimeFormat = memoize(
	(locale, options?: Intl.RelativeTimeFormatOptions) =>
		new Intl.RelativeTimeFormat(locale, options)
)

/** Cached `Intl.ListFormat`, one instance per (locale, options). */
export const getListFormat = memoize(
	(locale, options?: Intl.ListFormatOptions) =>
		new Intl.ListFormat(locale, options)
)

/** Cached `Intl.PluralRules`, one instance per (locale, options). */
export const getPluralRules = memoize(
	(locale, options?: Intl.PluralRulesOptions) =>
		new Intl.PluralRules(locale, options)
)

function toTime(value: DateInput): number {
	return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

// ─── Numbers ────────────────────────────────────────────────────────────────

export function formatNumber(
	value: number,
	locale: string,
	options?: Intl.NumberFormatOptions
): string {
	return getNumberFormat(locale, options).format(value)
}

/** A fraction (`0.25`) as a percentage (`"25%"`). */
export function formatPercent(
	value: number,
	locale: string,
	options?: Intl.NumberFormatOptions
): string {
	return formatNumber(value, locale, { ...options, style: 'percent' })
}

/**
 * An amount in whole currency units (`12.5`, not cents). Pass
 * `{ maximumFractionDigits: 0 }` for whole-unit prices.
 */
export function formatCurrency(
	amount: number,
	currency: string,
	locale: string,
	options?: Intl.NumberFormatOptions
): string {
	return formatNumber(amount, locale, {
		...options,
		style: 'currency',
		currency
	})
}

/** Short compact notation: `1234` -> `"1.2K"` (en-US), `"1,2 t"` (da-DK). */
export function formatCompactNumber(value: number, locale: string): string {
	return formatNumber(value, locale, { notation: 'compact' })
}

export type FormatBytesOptions = {
	/** Default `'en-US'`. */
	locale?: string
	/** Fraction digits (trailing zeros dropped). Default 0 for KB, 1 above. */
	decimals?: number
	/** 1 KB = 1024 B when true (default), 1000 B when false. */
	binary?: boolean
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

/**
 * Human-readable file size: `"512 B"`, `"12 KB"`, `"3.4 MB"`. Unit labels are
 * not localized; the number is.
 */
export function formatBytes(
	bytes: number,
	options: FormatBytesOptions = {}
): string {
	const { locale = 'en-US', decimals, binary = true } = options
	const base = binary ? 1024 : 1000
	let exponent = 0
	while (
		Math.abs(bytes) >= base ** (exponent + 1) &&
		exponent < BYTE_UNITS.length - 1
	) {
		exponent++
	}
	const maximumFractionDigits =
		exponent === 0 ? 0 : (decimals ?? (exponent === 1 ? 0 : 1))
	const value = formatNumber(bytes / base ** exponent, locale, {
		maximumFractionDigits
	})
	return `${value} ${BYTE_UNITS[exponent]}`
}

// ─── Durations ──────────────────────────────────────────────────────────────

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export type DurationParts = {
	days: number
	hours: number
	minutes: number
	seconds: number
	milliseconds: number
}

/** Break milliseconds into whole units. Negative or non-finite input is 0. */
export function splitDuration(ms: number): DurationParts {
	const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0
	return {
		days: Math.floor(total / DAY_MS),
		hours: Math.floor((total % DAY_MS) / HOUR_MS),
		minutes: Math.floor((total % HOUR_MS) / MINUTE_MS),
		seconds: Math.floor((total % MINUTE_MS) / SECOND_MS),
		milliseconds: total % SECOND_MS
	}
}

/** Stopwatch style: `"1:05:09"` from an hour up, `"5:09"` below. */
export function formatClockDuration(ms: number): string {
	const { days, hours, minutes, seconds } = splitDuration(ms)
	const totalHours = days * 24 + hours
	const pad = (n: number) => String(n).padStart(2, '0')
	return totalHours > 0
		? `${totalHours}:${pad(minutes)}:${pad(seconds)}`
		: `${minutes}:${pad(seconds)}`
}

export type FormatDurationOptions = {
	/** `'long'` "1 hour, 5 minutes", `'short'` "1 hr, 5 min" (default), `'narrow'` "1h 5m". */
	style?: 'long' | 'short' | 'narrow'
	/** Adjacent units shown, starting at the largest non-zero one. Default 2. */
	maxUnits?: number
}

const DURATION_UNITS = [
	['days', 'day'],
	['hours', 'hour'],
	['minutes', 'minute'],
	['seconds', 'second'],
	['milliseconds', 'millisecond']
] as const

/**
 * Localized duration, truncated (never rounded up). Units are adjacent: with
 * the default `maxUnits: 2`, 1 day 0 h 5 min reads "1 day", not "1 day, 5 min".
 */
export function formatDuration(
	ms: number,
	locale: string,
	options: FormatDurationOptions = {}
): string {
	const { style = 'short', maxUnits = 2 } = options
	const parts = splitDuration(ms)
	const unit = (value: number, name: string) =>
		formatNumber(value, locale, {
			style: 'unit',
			unit: name,
			unitDisplay: style
		})
	const first = DURATION_UNITS.findIndex(([key]) => parts[key] > 0)
	if (first === -1) return unit(0, 'second')
	const shown = DURATION_UNITS.slice(first, first + Math.max(1, maxUnits))
		.filter(([key]) => parts[key] > 0)
		.map(([key, name]) => unit(parts[key], name))
	return formatList(shown, locale, { type: 'unit', style })
}

// ─── Relative time ──────────────────────────────────────────────────────────

function relativeUnit(ms: number): {
	value: number
	unit: Intl.RelativeTimeFormatUnitSingular
} {
	const seconds = ms / 1000
	if (Math.abs(seconds) < 60)
		return { value: Math.round(seconds), unit: 'second' }
	const minutes = seconds / 60
	if (Math.abs(minutes) < 60)
		return { value: Math.round(minutes), unit: 'minute' }
	const hours = minutes / 60
	if (Math.abs(hours) < 24) return { value: Math.round(hours), unit: 'hour' }
	const days = hours / 24
	if (Math.abs(days) < 30) return { value: Math.round(days), unit: 'day' }
	const months = days / 30
	if (Math.abs(months) < 12) return { value: Math.round(months), unit: 'month' }
	return { value: Math.round(days / 365), unit: 'year' }
}

export type FormatRelativeTimeOptions = {
	/** Reference time. Default `Date.now()`. */
	now?: DateInput
	/** `'auto'` (default) says "yesterday"; `'always'` says "1 day ago". */
	numeric?: Intl.RelativeTimeFormatNumeric
	style?: Intl.RelativeTimeFormatStyle
	/**
	 * `false` drops "ago"/"in" and prints the bare amount ("5 minutes"), for
	 * use next to a label that already says when. Default `true`.
	 */
	withSuffix?: boolean
}

/**
 * Time from `now` in the best-fitting unit: "5 minutes ago", "in 2 days",
 * "yesterday". Unparseable input returns `''`.
 */
export function formatRelativeTime(
	date: DateInput,
	locale: string,
	options: FormatRelativeTimeOptions = {}
): string {
	const {
		now = Date.now(),
		numeric = 'auto',
		style,
		withSuffix = true
	} = options
	const diff = toTime(date) - toTime(now)
	if (!Number.isFinite(diff)) return ''
	const { value, unit } = relativeUnit(diff)
	if (withSuffix) {
		return getRelativeTimeFormat(locale, { numeric, style }).format(value, unit)
	}
	return formatNumber(Math.abs(value), locale, {
		style: 'unit',
		unit,
		unitDisplay: style ?? 'long'
	})
}

/**
 * How long something has waited, compact for a pill or list row: "14 min",
 * "2 hr", "3 days". Floors (never claims more waiting than happened), never
 * shows less than "1 min", and treats a future timestamp as no waiting.
 *
 * A `number` is a duration in milliseconds; a `Date`/string is a start
 * timestamp measured against `now`. Unparseable input returns `''`.
 */
export function formatWait(
	value: DateInput,
	locale: string,
	options: { now?: DateInput } = {}
): string {
	const elapsed =
		typeof value === 'number'
			? value
			: toTime(options.now ?? Date.now()) - toTime(value)
	const waited = Math.max(0, elapsed)
	if (!Number.isFinite(waited)) return ''
	const [amount, unit]: [number, string] =
		waited < HOUR_MS
			? [Math.max(1, Math.floor(waited / MINUTE_MS)), 'minute']
			: waited < DAY_MS
				? [Math.floor(waited / HOUR_MS), 'hour']
				: [Math.floor(waited / DAY_MS), 'day']
	return formatNumber(amount, locale, {
		style: 'unit',
		unit,
		unitDisplay: 'short'
	})
}

// ─── Dates and lists ────────────────────────────────────────────────────────

const DATE_COMPONENTS = [
	'weekday',
	'era',
	'year',
	'month',
	'day',
	'dayPeriod',
	'hour',
	'minute',
	'second',
	'fractionalSecondDigits',
	'dateStyle',
	'timeStyle'
] as const

/**
 * One span with the shared parts collapsed: "24–30 Aug 2026". Without any
 * date/time fields in `options` it uses day + short month + year; `timeZone`
 * and friends combine with that default.
 */
export function formatDateRange(
	start: DateInput,
	end: DateInput,
	locale: string,
	options: Intl.DateTimeFormatOptions = {}
): string {
	const hasFields = DATE_COMPONENTS.some((key) => options[key] !== undefined)
	const format = getDateTimeFormat(
		locale,
		hasFields
			? options
			: { day: 'numeric', month: 'short', year: 'numeric', ...options }
	)
	const from = new Date(toTime(start))
	const to = new Date(toTime(end))
	// Older engines (some Hermes builds) lack formatRange.
	return typeof format.formatRange === 'function'
		? format.formatRange(from, to)
		: `${format.format(from)} – ${format.format(to)}`
}

/** "a, b, and c". Falls back to a comma join where `Intl.ListFormat` is missing. */
export function formatList(
	items: readonly string[],
	locale: string,
	options?: Intl.ListFormatOptions
): string {
	if (typeof Intl.ListFormat !== 'function') {
		return items.join(options?.style === 'narrow' ? ' ' : ', ')
	}
	return getListFormat(locale, options).format(items)
}

// ─── Counts ─────────────────────────────────────────────────────────────────

/** Badge count: `150` -> `"99+"`. Negative or NaN is `"0"`. */
export function formatCappedCount(count: number, max = 99): string {
	if (!(count > 0)) return '0'
	return count > max ? `${max}+` : String(count)
}

/**
 * Pick the plural form for `count` and fill in `{count}` (locale-formatted).
 * `pluralize(3, { one: '{count} item', other: '{count} items' }, 'en-US')`.
 */
export function pluralize(
	count: number,
	forms: Partial<Record<Intl.LDMLPluralRule, string>> & { other: string },
	locale: string
): string {
	const form = forms[getPluralRules(locale).select(count)] ?? forms.other
	return form.replaceAll('{count}', formatNumber(count, locale))
}
