/**
 * Calculate the previous period date range for a given period type.
 */
export function getPreviousReportPeriod(
	periodType: 'MONTHLY' | 'QUARTERLY' | 'YEARLY',
	referenceDate: Date = new Date()
): { start: Date; end: Date } {
	const month = referenceDate.getMonth()
	const year = referenceDate.getFullYear()

	switch (periodType) {
		case 'MONTHLY': {
			const prevMonth = month === 0 ? 11 : month - 1
			const prevYear = month === 0 ? year - 1 : year
			return {
				start: new Date(prevYear, prevMonth, 1),
				end: new Date(year, month, 0)
			}
		}
		case 'QUARTERLY': {
			const qStart = Math.floor(month / 3) * 3
			const prevQStart = qStart === 0 ? 9 : qStart - 3
			const prevQYear = qStart === 0 ? year - 1 : year
			return {
				start: new Date(prevQYear, prevQStart, 1),
				end: new Date(prevQYear, prevQStart + 3, 0)
			}
		}
		case 'YEARLY': {
			return {
				start: new Date(year - 1, 0, 1),
				end: new Date(year - 1, 11, 31)
			}
		}
	}
}

/**
 * Format a date range as a human-readable period label.
 */
export function formatPeriodLabel(
	start: Date | string,
	end: Date | string,
	includeDay = false
): string {
	const s = start instanceof Date ? start : new Date(start)
	const e = end instanceof Date ? end : new Date(end)
	const opts: Intl.DateTimeFormatOptions = {
		year: 'numeric',
		month: 'long',
		...(includeDay && { day: 'numeric' })
	}
	return `${s.toLocaleDateString('en-GB', opts)} — ${e.toLocaleDateString('en-GB', opts)}`
}
