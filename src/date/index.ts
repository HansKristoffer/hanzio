export type PeriodType = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY'

const MONTHS_PER_PERIOD = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 } as const

function ymd(date: Date, utc = false): [number, number, number] {
	return utc
		? [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()]
		: [date.getFullYear(), date.getMonth(), date.getDate()]
}

/** Midnight at the start of the given (overflow-normalized) calendar day. */
function startOfDay(y: number, m: number, d: number, utc = false): Date {
	return utc ? new Date(Date.UTC(y, m, d)) : new Date(y, m, d)
}

/**
 * Add `n` periods to `date`, keeping its time of day (wall-clock time in local
 * mode, so DST shifts don't move it). Month-based adds clamp the day of month:
 * Jan 31 + 1 month → Feb 28 (or 29).
 */
export function addPeriod(
	date: Date,
	type: PeriodType,
	n: number,
	options: { utc?: boolean } = {}
): Date {
	const { utc = false } = options
	let [y, m, d] = ymd(date, utc)
	if (type === 'DAILY' || type === 'WEEKLY') {
		d += n * (type === 'WEEKLY' ? 7 : 1)
	} else {
		m += n * MONTHS_PER_PERIOD[type]
		d = Math.min(d, new Date(Date.UTC(y, m + 1, 0)).getUTCDate())
	}
	const out = new Date(date)
	if (utc) out.setUTCFullYear(y, m, d)
	else out.setFullYear(y, m, d)
	return out
}

/**
 * Calendar period containing `referenceDate`, shifted by `offset` periods
 * (`-1` = previous, `1` = next).
 *
 * `start` is midnight on the first day and `end` is midnight at the **start**
 * of the last day, so the range is inclusive for date-only comparisons. For
 * timestamps use `timestamp < addPeriod(end, 'DAILY', 1)` as the exclusive bound.
 *
 * Uses the local timezone unless `utc: true`. Weeks start on Monday (ISO)
 * unless `weekStartsOn: 0` (Sunday).
 */
export function getPeriod(
	type: PeriodType,
	referenceDate: Date = new Date(),
	offset = 0,
	options: { utc?: boolean; weekStartsOn?: 0 | 1 } = {}
): { start: Date; end: Date } {
	const { utc = false, weekStartsOn = 1 } = options
	const [y, m, d] = ymd(referenceDate, utc)
	const weekday = utc ? referenceDate.getUTCDay() : referenceDate.getDay()
	const anchor = {
		DAILY: () => startOfDay(y, m, d, utc),
		WEEKLY: () => startOfDay(y, m, d - ((weekday - weekStartsOn + 7) % 7), utc),
		MONTHLY: () => startOfDay(y, m, 1, utc),
		QUARTERLY: () => startOfDay(y, m - (m % 3), 1, utc),
		YEARLY: () => startOfDay(y, 0, 1, utc)
	}[type]()
	const [ey, em, ed] = ymd(addPeriod(anchor, type, offset + 1, { utc }), utc)
	return {
		start: addPeriod(anchor, type, offset, { utc }),
		end: startOfDay(ey, em, ed - 1, utc)
	}
}

/**
 * Calculate the previous period date range for a given period type.
 * Same as `getPeriod(periodType, referenceDate, -1)`.
 */
export function getPreviousReportPeriod(
	periodType: PeriodType,
	referenceDate: Date = new Date()
): { start: Date; end: Date } {
	return getPeriod(periodType, referenceDate, -1)
}

export type FormatPeriodLabelOptions = {
	includeDay?: boolean
	/** Default `'en-GB'`. */
	locale?: string
	/** Joins the two formatted dates. Default `' — '`. Ignored when `collapse` is set. */
	separator?: string
	/**
	 * Use `Intl.DateTimeFormat#formatRange`, which drops repeated parts and uses
	 * the locale's range dash: "January – March 2025" instead of
	 * "January 2025 — March 2025".
	 */
	collapse?: boolean
	/** IANA time zone, e.g. `'UTC'` for periods from `getPeriod(..., { utc: true })`. */
	timeZone?: string
}

/**
 * Format a date range as a human-readable period label.
 * The third argument is either `includeDay` or an options object.
 */
export function formatPeriodLabel(
	start: Date | string,
	end: Date | string,
	options: boolean | FormatPeriodLabelOptions = false
): string {
	const {
		includeDay = false,
		locale = 'en-GB',
		separator = ' — ',
		collapse = false,
		timeZone
	} = typeof options === 'boolean' ? { includeDay: options } : options
	const s = start instanceof Date ? start : new Date(start)
	const e = end instanceof Date ? end : new Date(end)
	const format = new Intl.DateTimeFormat(locale, {
		year: 'numeric',
		month: 'long',
		...(includeDay && { day: 'numeric' }),
		timeZone
	})
	return collapse
		? format.formatRange(s, e)
		: `${format.format(s)}${separator}${format.format(e)}`
}
