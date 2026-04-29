/**
 * Shared metrics chart series color assignment for web (CSS tokens) and Expo (hex palette).
 * Same hash + collision strategy so labels map to the same slot index everywhere.
 */

/** Matches PrimeVue semantic palette slot count (cyan…blue) and Expo SERIES_COLORS length */
export const METRICS_SERIES_PALETTE_SIZE = 10

/**
 * FNV-1a 32-bit hash — stable palette index for a string key.
 */
export function hashStringToColorIndex(str: string): number {
	let hash = 2166136261
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i)
		hash = Math.imul(hash, 16777619)
	}
	return Math.abs(hash) % METRICS_SERIES_PALETTE_SIZE
}

function circularHueDistance(
	a: number,
	b: number,
	paletteSize: number
): number {
	const diff = Math.abs(a - b)
	return Math.min(diff, paletteSize - diff)
}

function pickHueMaxMinDistance(
	candidates: number[],
	used: Set<number>,
	paletteSize: number
): number {
	let best = candidates[0] ?? 0
	let bestScore = -1
	for (const cand of candidates) {
		let minD = paletteSize
		for (const u of used) {
			minD = Math.min(minD, circularHueDistance(cand, u, paletteSize))
		}
		if (minD > bestScore || (minD === bestScore && cand < best)) {
			bestScore = minD
			best = cand
		}
	}
	return best
}

/**
 * Prefer human-visible label so charts and tables agree on the same color key.
 */
export function seriesColorKey(label: string | undefined, key: string): string {
	const fromLabel = label?.trim()
	if (fromLabel) return fromLabel
	return key.trim() || key
}

/**
 * Map each distinct key to a palette index (hash preference, then max-min circular spacing).
 */
export function resolveSeriesColorMap(keys: string[]): Map<string, number> {
	const result = new Map<string, number>()
	const uniqueKeys = [...new Set(keys)]
	if (uniqueKeys.length === 0) return result

	const paletteSize = METRICS_SERIES_PALETTE_SIZE

	if (uniqueKeys.length === 1) {
		const only = uniqueKeys[0]!
		result.set(only, hashStringToColorIndex(only))
		return result
	}

	const usedIndices = new Set<number>()
	const entries = uniqueKeys.map((key) => ({
		key,
		preferred: hashStringToColorIndex(key)
	}))

	for (const entry of entries) {
		if (!usedIndices.has(entry.preferred)) {
			result.set(entry.key, entry.preferred)
			usedIndices.add(entry.preferred)
		}
	}

	const unassigned = entries.filter((e) => !result.has(e.key))
	for (const entry of unassigned) {
		const unused: number[] = []
		for (let i = 0; i < paletteSize; i++) {
			if (!usedIndices.has(i)) unused.push(i)
		}
		const candidates =
			unused.length > 0
				? unused
				: Array.from({ length: paletteSize }, (_, i) => i)
		const idx = pickHueMaxMinDistance(candidates, usedIndices, paletteSize)
		result.set(entry.key, idx)
		usedIndices.add(idx)
	}

	return result
}

export type ResolveColorsByKeysResult = {
	getColor: (key: string) => string
	getHoverColor: (key: string) => string
}

/**
 * Resolve stable colors per key using palette index → RGB/CSS from the caller.
 */
export function createResolveColorsByKeys(
	keys: string[],
	getSeriesColor: (index: number) => string,
	getSeriesHoverColor: (index: number) => string
): ResolveColorsByKeysResult {
	const colorMap = resolveSeriesColorMap(keys)
	return {
		getColor: (key: string) =>
			getSeriesColor(colorMap.get(key) ?? hashStringToColorIndex(key)),
		getHoverColor: (key: string) =>
			getSeriesHoverColor(colorMap.get(key) ?? hashStringToColorIndex(key))
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value))
}

/**
 * Add alpha to hex, rgb(), or rgba() strings.
 */
export function withAlpha(color: string, alpha: number): string {
	const trimmed = color.trim()

	if (trimmed.startsWith('#')) {
		const hex = trimmed.slice(1)
		const normalized =
			hex.length === 3
				? hex
						.split('')
						.map((c) => c + c)
						.join('')
				: hex
		if (normalized.length === 6) {
			const r = Number.parseInt(normalized.slice(0, 2), 16)
			const g = Number.parseInt(normalized.slice(2, 4), 16)
			const b = Number.parseInt(normalized.slice(4, 6), 16)
			return `rgba(${r}, ${g}, ${b}, ${alpha})`
		}
	}

	if (trimmed.startsWith('rgb(')) {
		return trimmed.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`)
	}

	if (trimmed.startsWith('rgba(')) {
		return trimmed.replace(/,\s*[\d.]+\)$/, `, ${alpha})`)
	}

	return trimmed
}

/**
 * Heatmap cell background from normalized value intensity.
 */
export function getHeatmapCellStyle(params: {
	value: number | null | undefined
	min: number
	max: number
	baseColor: string
	neutralColor?: string
	minAlpha?: number
	maxAlpha?: number
}): Record<string, string> {
	const {
		value,
		min,
		max,
		baseColor,
		neutralColor,
		minAlpha = 0.08,
		maxAlpha = 0.78
	} = params

	if (value === null || value === undefined || Number.isNaN(value)) {
		return {}
	}

	if (!Number.isFinite(min) || !Number.isFinite(max)) {
		return {}
	}

	if (max <= min) {
		return {
			backgroundColor: withAlpha(neutralColor ?? baseColor, 0.32)
		}
	}

	const normalized = clamp((value - min) / (max - min), 0, 1)
	const alpha = minAlpha + (maxAlpha - minAlpha) * normalized

	return {
		backgroundColor: withAlpha(baseColor, alpha)
	}
}
