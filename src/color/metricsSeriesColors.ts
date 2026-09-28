import { lerp, normalize } from '../math/scale'
import { colorFunctionArgs, parseColor } from './contrast'

/**
 * Stable series color assignment: the same hash + collision strategy maps a
 * label to the same palette slot index on every platform.
 */

/** Default palette slot count. */
export const METRICS_SERIES_PALETTE_SIZE = 10

/**
 * FNV-1a 32-bit hash — stable palette index for a string key.
 */
export function hashStringToColorIndex(
	str: string,
	paletteSize = METRICS_SERIES_PALETTE_SIZE
): number {
	let hash = 2166136261
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i)
		hash = Math.imul(hash, 16777619)
	}
	return Math.abs(hash) % paletteSize
}

/** Stable pick from `palette` for `seed` (same seed → same item). Throws on an empty palette. */
export function pickFromPalette<T>(seed: string, palette: readonly T[]): T {
	if (palette.length === 0) throw new RangeError('palette is empty')
	return palette[hashStringToColorIndex(seed, palette.length)]!
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
export function resolveSeriesColorMap(
	keys: string[],
	paletteSize = METRICS_SERIES_PALETTE_SIZE
): Map<string, number> {
	const result = new Map<string, number>()
	const uniqueKeys = [...new Set(keys)]
	if (uniqueKeys.length === 0) return result

	if (uniqueKeys.length === 1) {
		const only = uniqueKeys[0]!
		result.set(only, hashStringToColorIndex(only, paletteSize))
		return result
	}

	const usedIndices = new Set<number>()
	const entries = uniqueKeys.map((key) => ({
		key,
		preferred: hashStringToColorIndex(key, paletteSize)
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
	getSeriesHoverColor: (index: number) => string,
	paletteSize = METRICS_SERIES_PALETTE_SIZE
): ResolveColorsByKeysResult {
	const colorMap = resolveSeriesColorMap(keys, paletteSize)
	const indexOf = (key: string) =>
		colorMap.get(key) ?? hashStringToColorIndex(key, paletteSize)
	return {
		getColor: (key: string) => getSeriesColor(indexOf(key)),
		getHoverColor: (key: string) => getSeriesHoverColor(indexOf(key))
	}
}

/**
 * Apply `alpha` (0..1) to a color, replacing any existing alpha.
 *
 * - `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` → `rgba(r, g, b, a)` (works in React Native)
 * - `rgb()`/`rgba()`/`hsl()`/`hsla()`, comma or space syntax → `rgba(…)` / `hsla(…)`
 * - anything else (CSS variables, named colors, `oklch()`, …) →
 *   `color-mix(in srgb, <color> <alpha*100>%, transparent)` (web only)
 */
export function withAlpha(color: string, alpha: number): string {
	const trimmed = color.trim()
	const rgba = parseColor(trimmed)
	const fn = rgba && colorFunctionArgs(trimmed)

	if (fn?.name === 'hsl') {
		const [h, s, l] = fn.args
		return `hsla(${h}, ${s}, ${l}, ${alpha})`
	}
	if (rgba) return `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${alpha})`

	return `color-mix(in srgb, ${trimmed} ${alpha * 100}%, transparent)`
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

	return {
		backgroundColor: withAlpha(
			baseColor,
			lerp(minAlpha, maxAlpha, normalize(value, min, max))
		)
	}
}
