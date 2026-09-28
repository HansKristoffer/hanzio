export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value))
}

/** Linear interpolation: `t = 0` → `start`, `t = 1` → `end`. */
export function lerp(start: number, end: number, t: number): number {
	return start + (end - start) * t
}

/**
 * Position of `value` within `[min, max]` as 0..1 (clamped). Returns 0 when
 * the range is empty.
 */
export function normalize(value: number, min: number, max: number): number {
	if (max <= min) return 0
	return clamp((value - min) / (max - min), 0, 1)
}
