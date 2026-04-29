/**
 * Least-squares linear regression for y at x = 0, 1, …, n − 1.
 * Returns fitted y for each index, or [] if n < 2 or any input is non-finite.
 */
export function linearRegressionTrend(values: number[]): number[] {
	const n = values.length
	if (n < 2) return []
	for (const v of values) {
		if (!Number.isFinite(v)) return []
	}

	let sumX = 0
	let sumY = 0
	let sumXY = 0
	let sumX2 = 0
	for (let i = 0; i < n; i++) {
		const x = i
		const y = values[i]!
		sumX += x
		sumY += y
		sumXY += x * y
		sumX2 += x * x
	}

	const denom = n * sumX2 - sumX * sumX
	if (denom === 0) return []

	const slope = (n * sumXY - sumX * sumY) / denom
	const intercept = (sumY - slope * sumX) / n

	const out: number[] = []
	for (let i = 0; i < n; i++) {
		out.push(intercept + slope * i)
	}
	return out
}
