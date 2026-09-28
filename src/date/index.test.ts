import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
	addPeriod,
	formatPeriodLabel,
	getPeriod,
	getPreviousReportPeriod
} from '.'

describe('getPreviousReportPeriod', () => {
	test('MONTHLY returns previous calendar month', () => {
		const ref = new Date(2025, 2, 15)
		const { start, end } = getPreviousReportPeriod('MONTHLY', ref)
		expect(start.getFullYear()).toBe(2025)
		expect(start.getMonth()).toBe(1)
		expect(start.getDate()).toBe(1)
		expect(end.getMonth()).toBe(1)
		expect(end.getDate()).toBe(28)
	})

	test('YEARLY returns previous full year', () => {
		const ref = new Date(2025, 6, 1)
		const { start, end } = getPreviousReportPeriod('YEARLY', ref)
		expect(start).toEqual(new Date(2024, 0, 1))
		expect(end).toEqual(new Date(2024, 11, 31))
	})
})

describe('formatPeriodLabel', () => {
	test('formats month/year range', () => {
		const label = formatPeriodLabel(new Date(2025, 0, 1), new Date(2025, 0, 31))
		expect(label).toContain('2025')
		expect(label).toContain('—')
	})
})

describe('getPeriod', () => {
	const originalTz = process.env.TZ
	beforeAll(() => {
		process.env.TZ = 'Europe/Copenhagen'
	})
	afterAll(() => {
		if (originalTz === undefined) delete process.env.TZ
		else process.env.TZ = originalTz
	})

	test('offset 0 is the current period', () => {
		const ref = new Date(2025, 4, 14, 15, 30)
		expect(getPeriod('DAILY', ref)).toEqual({
			start: new Date(2025, 4, 14),
			end: new Date(2025, 4, 14)
		})
		expect(getPeriod('MONTHLY', ref)).toEqual({
			start: new Date(2025, 4, 1),
			end: new Date(2025, 4, 31)
		})
		expect(getPeriod('YEARLY', ref, 1)).toEqual({
			start: new Date(2026, 0, 1),
			end: new Date(2026, 11, 31)
		})
	})

	test('weeks start on Monday by default, Sunday with weekStartsOn: 0', () => {
		const wednesday = new Date(2025, 0, 1)
		expect(getPeriod('WEEKLY', wednesday)).toEqual({
			start: new Date(2024, 11, 30),
			end: new Date(2025, 0, 5)
		})
		expect(getPeriod('WEEKLY', wednesday, 0, { weekStartsOn: 0 })).toEqual({
			start: new Date(2024, 11, 29),
			end: new Date(2025, 0, 4)
		})
		const sunday = new Date(2025, 0, 5)
		expect(getPeriod('WEEKLY', sunday).start).toEqual(new Date(2024, 11, 30))
		expect(getPeriod('WEEKLY', sunday, -1).start).toEqual(
			new Date(2024, 11, 23)
		)
	})

	test('quarter boundaries', () => {
		expect(getPeriod('QUARTERLY', new Date(2025, 2, 31))).toEqual({
			start: new Date(2025, 0, 1),
			end: new Date(2025, 2, 31)
		})
		expect(getPeriod('QUARTERLY', new Date(2025, 3, 1))).toEqual({
			start: new Date(2025, 3, 1),
			end: new Date(2025, 5, 30)
		})
		expect(getPreviousReportPeriod('QUARTERLY', new Date(2025, 1, 10))).toEqual(
			{ start: new Date(2024, 9, 1), end: new Date(2024, 11, 31) }
		)
		expect(getPeriod('QUARTERLY', new Date(2025, 10, 5), 2).start).toEqual(
			new Date(2026, 3, 1)
		)
	})

	test('stays on local midnight across DST changes', () => {
		// Europe/Copenhagen switches to summer time on 2025-03-30
		const week = getPeriod('WEEKLY', new Date(2025, 2, 27))
		expect(week.start).toEqual(new Date(2025, 2, 24))
		expect(week.end).toEqual(new Date(2025, 2, 30))
		const next = getPeriod('WEEKLY', new Date(2025, 2, 27), 1)
		expect(next.start.getHours()).toBe(0)
		expect(next.start.getDate()).toBe(31)
		const day = getPeriod('DAILY', new Date(2025, 2, 30, 12), 1)
		expect(day.start).toEqual(new Date(2025, 2, 31))
	})

	test('utc option uses UTC calendar fields', () => {
		// 23:30 UTC on Feb 28 is already March 1 in Copenhagen
		const ref = new Date('2025-02-28T23:30:00Z')
		expect(getPeriod('MONTHLY', ref).start).toEqual(new Date(2025, 2, 1))
		expect(getPeriod('MONTHLY', ref, 0, { utc: true })).toEqual({
			start: new Date('2025-02-01T00:00:00Z'),
			end: new Date('2025-02-28T00:00:00Z')
		})
		expect(getPeriod('WEEKLY', ref, 0, { utc: true }).start).toEqual(
			new Date('2025-02-24T00:00:00Z')
		)
	})
})

describe('addPeriod', () => {
	test('clamps day of month for month-based periods', () => {
		expect(addPeriod(new Date(2025, 0, 31), 'MONTHLY', 1)).toEqual(
			new Date(2025, 1, 28)
		)
		expect(addPeriod(new Date(2024, 0, 31), 'MONTHLY', 1)).toEqual(
			new Date(2024, 1, 29)
		)
		expect(addPeriod(new Date(2025, 2, 31), 'MONTHLY', -1)).toEqual(
			new Date(2025, 1, 28)
		)
		expect(addPeriod(new Date(2025, 10, 30), 'QUARTERLY', 1)).toEqual(
			new Date(2026, 1, 28)
		)
		expect(addPeriod(new Date(2024, 1, 29), 'YEARLY', 1)).toEqual(
			new Date(2025, 1, 28)
		)
	})

	test('days and weeks keep the time of day', () => {
		expect(addPeriod(new Date(2025, 0, 30, 9, 15), 'DAILY', 3)).toEqual(
			new Date(2025, 1, 2, 9, 15)
		)
		expect(addPeriod(new Date(2025, 0, 1), 'WEEKLY', -1)).toEqual(
			new Date(2024, 11, 25)
		)
	})

	test('utc option', () => {
		expect(
			addPeriod(new Date('2025-01-31T22:00:00Z'), 'MONTHLY', 1, { utc: true })
		).toEqual(new Date('2025-02-28T22:00:00Z'))
	})
})

describe('formatPeriodLabel options', () => {
	test('positional includeDay keeps the classic output', () => {
		expect(formatPeriodLabel(new Date(2025, 0, 1), new Date(2025, 2, 31))).toBe(
			'January 2025 — March 2025'
		)
		expect(
			formatPeriodLabel(new Date(2025, 0, 1), new Date(2025, 2, 31), true)
		).toBe('1 January 2025 — 31 March 2025')
	})

	test('locale, separator, collapse and timeZone', () => {
		const s = new Date(2025, 0, 1)
		const e = new Date(2025, 2, 31)
		expect(
			formatPeriodLabel(s, e, { locale: 'en-US', separator: ' to ' })
		).toBe('January 2025 to March 2025')
		expect(formatPeriodLabel(s, e, { collapse: true })).toBe(
			'January – March 2025'
		)
		expect(
			formatPeriodLabel(
				new Date('2025-02-01T00:00:00Z'),
				new Date('2025-02-28T00:00:00Z'),
				{ includeDay: true, timeZone: 'UTC' }
			)
		).toBe('1 February 2025 — 28 February 2025')
	})
})
