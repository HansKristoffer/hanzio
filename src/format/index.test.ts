import { describe, expect, test } from 'bun:test'
import {
	formatBytes,
	formatCappedCount,
	formatClockDuration,
	formatCompactNumber,
	formatCurrency,
	formatDateRange,
	formatDuration,
	formatList,
	formatNumber,
	formatPercent,
	formatRelativeTime,
	formatWait,
	getNumberFormat,
	pluralize,
	splitDuration
} from '.'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const NOW = new Date('2026-09-28T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

describe('cached formatters', () => {
	test('same instance for equal options regardless of key order', () => {
		const a = getNumberFormat('en-US', {
			style: 'currency',
			currency: 'EUR'
		})
		const b = getNumberFormat('en-US', {
			currency: 'EUR',
			style: 'currency'
		})
		expect(a).toBe(b)
		expect(getNumberFormat('da-DK')).not.toBe(getNumberFormat('en-US'))
	})
})

describe('numbers', () => {
	test('formatNumber', () => {
		expect(formatNumber(1234567.891, 'en-US')).toBe('1,234,567.891')
		expect(formatNumber(1234567.891, 'da-DK')).toBe('1.234.567,891')
		expect(formatNumber(1.005, 'en-US', { maximumFractionDigits: 1 })).toBe('1')
	})

	test('formatPercent takes a fraction', () => {
		expect(formatPercent(0.25, 'en-US')).toBe('25%')
		expect(formatPercent(0.1234, 'en-US', { maximumFractionDigits: 1 })).toBe(
			'12.3%'
		)
		expect(formatPercent(0.25, 'da-DK')).toBe('25 %')
	})

	test('formatCurrency', () => {
		expect(formatCurrency(12.5, 'USD', 'en-US')).toBe('$12.50')
		expect(
			formatCurrency(2500, 'DKK', 'da-DK', { maximumFractionDigits: 0 })
		).toBe('2.500 kr.')
	})

	test('formatCompactNumber', () => {
		expect(formatCompactNumber(1234, 'en-US')).toBe('1.2K')
		expect(formatCompactNumber(5_600_000, 'en-US')).toBe('5.6M')
		expect(formatCompactNumber(999, 'en-US')).toBe('999')
	})
})

describe('formatBytes', () => {
	test('lullu defaults: whole KB, one decimal from MB', () => {
		expect(formatBytes(0)).toBe('0 B')
		expect(formatBytes(1023)).toBe('1,023 B')
		expect(formatBytes(1024)).toBe('1 KB')
		expect(formatBytes(12_900)).toBe('13 KB')
		expect(formatBytes(3.45 * 1024 * 1024)).toBe('3.5 MB')
		expect(formatBytes(2 * 1024 ** 3)).toBe('2 GB')
	})

	test('options', () => {
		expect(formatBytes(1500, { binary: false })).toBe('2 KB')
		expect(formatBytes(1500, { binary: false, decimals: 2 })).toBe('1.5 KB')
		expect(formatBytes(3.45 * 1024 * 1024, { locale: 'da-DK' })).toBe('3,5 MB')
		expect(formatBytes(1024 ** 6)).toBe('1,024 PB')
	})
})

describe('durations', () => {
	test('splitDuration', () => {
		expect(splitDuration(DAY + 2 * HOUR + 3 * MINUTE + 4 * SECOND + 5)).toEqual(
			{ days: 1, hours: 2, minutes: 3, seconds: 4, milliseconds: 5 }
		)
		expect(splitDuration(-5)).toEqual({
			days: 0,
			hours: 0,
			minutes: 0,
			seconds: 0,
			milliseconds: 0
		})
		expect(splitDuration(Number.NaN).seconds).toBe(0)
	})

	test('formatClockDuration', () => {
		expect(formatClockDuration(0)).toBe('0:00')
		expect(formatClockDuration(5 * MINUTE + 9 * SECOND)).toBe('5:09')
		expect(formatClockDuration(HOUR + 5 * MINUTE + 9 * SECOND + 999)).toBe(
			'1:05:09'
		)
		expect(formatClockDuration(DAY + HOUR)).toBe('25:00:00')
	})

	test('formatDuration styles', () => {
		const ms = HOUR + 5 * MINUTE + 30 * SECOND
		expect(formatDuration(ms, 'en-US')).toBe('1 hr, 5 min')
		expect(formatDuration(ms, 'en-US', { style: 'narrow' })).toBe('1h 5m')
		expect(formatDuration(ms, 'en-US', { style: 'long' })).toBe(
			'1 hour, 5 minutes'
		)
		expect(formatDuration(ms, 'en-US', { maxUnits: 3 })).toBe(
			'1 hr, 5 min, 30 sec'
		)
		expect(formatDuration(ms, 'da-DK', { style: 'long' })).toBe(
			'1 time og 5 minutter'
		)
	})

	test('formatDuration units stay adjacent', () => {
		expect(formatDuration(DAY + 5 * MINUTE, 'en-US')).toBe('1 day')
		expect(formatDuration(250, 'en-US')).toBe('250 ms')
		expect(formatDuration(1500, 'en-US')).toBe('1 sec, 500 ms')
		expect(formatDuration(0, 'en-US')).toBe('0 sec')
	})
})

describe('formatRelativeTime', () => {
	const rel = (ms: number, options = {}) =>
		formatRelativeTime(ago(ms), 'en-US', { now: NOW, ...options })

	test('picks the best unit', () => {
		expect(rel(10 * SECOND)).toBe('10 seconds ago')
		expect(rel(5 * MINUTE)).toBe('5 minutes ago')
		expect(rel(3 * HOUR)).toBe('3 hours ago')
		expect(rel(2 * DAY)).toBe('2 days ago')
		expect(rel(60 * DAY)).toBe('2 months ago')
		expect(rel(730 * DAY)).toBe('2 years ago')
		expect(rel(-2 * DAY)).toBe('in 2 days')
	})

	test('numeric and suffix options', () => {
		expect(rel(DAY)).toBe('yesterday')
		expect(rel(DAY, { numeric: 'always' })).toBe('1 day ago')
		expect(rel(5 * MINUTE, { style: 'short' })).toBe('5 min. ago')
		expect(rel(5 * MINUTE, { withSuffix: false })).toBe('5 minutes')
		expect(rel(-5 * MINUTE, { withSuffix: false })).toBe('5 minutes')
		expect(
			formatRelativeTime(ago(DAY), 'da-DK', { now: NOW, numeric: 'auto' })
		).toBe('i går')
	})

	test('accepts strings and epoch numbers; garbage is empty', () => {
		expect(
			formatRelativeTime('2026-09-28T11:00:00Z', 'en-US', { now: NOW })
		).toBe('1 hour ago')
		expect(
			formatRelativeTime(NOW.getTime() + HOUR, 'en-US', { now: NOW })
		).toBe('in 1 hour')
		expect(formatRelativeTime('nope', 'en-US', { now: NOW })).toBe('')
	})
})

// Ported from lullu packages/utils/formatWait.test.ts.
describe('formatWait', () => {
	test('a duration in milliseconds is a compact unit label', () => {
		expect(formatWait(14 * MINUTE, 'en-US')).toBe('14 min')
		expect(formatWait(2 * HOUR, 'en-US')).toBe('2 hr')
		expect(formatWait(3 * DAY, 'en-US')).toBe('3 days')
	})

	test('it floors rather than rounds', () => {
		expect(formatWait(14 * MINUTE + 50_000, 'en-US')).toBe('14 min')
		expect(formatWait(59 * MINUTE + 59_000, 'en-US')).toBe('59 min')
		expect(formatWait(47 * HOUR, 'en-US')).toBe('1 day')
	})

	test('anything under a minute is one minute, not seconds', () => {
		expect(formatWait(0, 'en-US')).toBe('1 min')
		expect(formatWait(45_000, 'en-US')).toBe('1 min')
	})

	test('unit boundaries', () => {
		expect(formatWait(HOUR - 1, 'en-US')).toBe('59 min')
		expect(formatWait(HOUR, 'en-US')).toBe('1 hr')
		expect(formatWait(DAY - 1, 'en-US')).toBe('23 hr')
		expect(formatWait(DAY, 'en-US')).toBe('1 day')
	})

	test('a timestamp measures elapsed time', () => {
		const since = ago(90 * MINUTE)
		expect(formatWait(since, 'en-US', { now: NOW })).toBe('1 hr')
		expect(formatWait(since.toISOString(), 'en-US', { now: NOW })).toBe('1 hr')
	})

	test('a future timestamp is zero waiting, not negative', () => {
		expect(formatWait(ago(-HOUR), 'en-US', { now: NOW })).toBe('1 min')
	})

	test('unparseable input is empty', () => {
		expect(formatWait('nope', 'en-US', { now: NOW })).toBe('')
		expect(formatWait(Number.NaN, 'en-US')).toBe('')
	})

	test('other locales get their own words', () => {
		expect(formatWait(14 * MINUTE, 'da-DK')).toBe('14 min.')
		expect(formatWait(2 * HOUR, 'da-DK')).toBe('2 t.')
		expect(formatWait(2 * HOUR, 'de-DE')).toBe('2 Std.')
	})
})

describe('formatDateRange', () => {
	// ICU versions disagree on spaces around the range dash.
	const range = (...args: Parameters<typeof formatDateRange>) =>
		formatDateRange(...args).replace(/\s*\u2013\s*/g, '\u2013')

	test('collapses shared parts with the default fields', () => {
		expect(
			range('2026-08-24', '2026-08-30', 'en-GB', { timeZone: 'UTC' })
		).toBe('24\u201330 Aug 2026')
		expect(
			range('2026-08-24', '2026-09-02', 'en-US', { timeZone: 'UTC' })
		).toBe('Aug 24\u2013Sep 2, 2026')
	})

	test('explicit fields replace the default', () => {
		expect(
			range('2026-01-10', '2026-03-10', 'en-US', {
				month: 'long',
				year: 'numeric',
				timeZone: 'UTC'
			})
		).toBe('January\u2013March 2026')
	})
})

describe('formatList', () => {
	test('conjunction and disjunction', () => {
		expect(formatList(['a', 'b', 'c'], 'en-US')).toBe('a, b, and c')
		expect(formatList(['a', 'b'], 'da-DK')).toBe('a og b')
		expect(formatList(['a', 'b'], 'en-US', { type: 'disjunction' })).toBe(
			'a or b'
		)
		expect(formatList([], 'en-US')).toBe('')
	})
})

describe('formatCappedCount', () => {
	test('caps and clamps', () => {
		expect(formatCappedCount(5)).toBe('5')
		expect(formatCappedCount(99)).toBe('99')
		expect(formatCappedCount(100)).toBe('99+')
		expect(formatCappedCount(12, 9)).toBe('9+')
		expect(formatCappedCount(-3)).toBe('0')
		expect(formatCappedCount(Number.NaN)).toBe('0')
	})
})

describe('pluralize', () => {
	const items = { one: '{count} item', other: '{count} items' }

	test('picks the form and fills in the count', () => {
		expect(pluralize(1, items, 'en-US')).toBe('1 item')
		expect(pluralize(0, items, 'en-US')).toBe('0 items')
		expect(pluralize(1234, items, 'en-US')).toBe('1,234 items')
		expect(pluralize(1234, items, 'da-DK')).toBe('1.234 items')
	})

	test('falls back to other when the form is missing', () => {
		expect(pluralize(1, { other: '{count} fish' }, 'en-US')).toBe('1 fish')
	})
})
