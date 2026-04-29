import { describe, expect, test } from 'bun:test'
import { formatPeriodLabel, getPreviousReportPeriod } from '.'

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
