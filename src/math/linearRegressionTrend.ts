export type LinearRegression = {
	slope: number
	intercept: number
	/** Coefficient of determination (0..1). 1 when all values are equal (exact fit). */
	r2: number
	/** Fitted y for each index. */
	fitted: number[]
}

/**
 * Least-squares linear regression for y at x = 0, 1, …, n − 1.
 * Returns `null` if n < 2 or any input is non-finite.
 */
export function linearRegression(values: number[]): LinearRegression | null {
	const n = values.length
	if (n < 2) return null
	for (const v of values) {
		if (!Number.isFinite(v)) return null
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
	if (denom === 0) return null

	const slope = (n * sumXY - sumX * sumY) / denom
	const intercept = (sumY - slope * sumX) / n
	const mean = sumY / n

	const fitted: number[] = []
	let ssRes = 0
	let ssTot = 0
	for (let i = 0; i < n; i++) {
		const y = values[i]!
		const f = intercept + slope * i
		fitted.push(f)
		ssRes += (y - f) ** 2
		ssTot += (y - mean) ** 2
	}

	return { slope, intercept, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot, fitted }
}

/**
 * Fitted y for each index of `values` (see `linearRegression`), or [] if n < 2
 * or any input is non-finite.
 */
export function linearRegressionTrend(values: number[]): number[] {
	return linearRegression(values)?.fitted ?? []
}
