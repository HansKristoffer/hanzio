import { clamp } from '../math/scale'

/** An sRGB color: `r`/`g`/`b` in 0..255, `a` in 0..1. */
export type Rgba = { r: number; g: number; b: number; a: number }

/**
 * Splits `rgb(…)`/`rgba(…)`/`hsl(…)`/`hsla(…)` (comma, space or slash syntax)
 * into its name and 3-4 raw arguments. Internal; shared with `withAlpha`.
 */
export function colorFunctionArgs(
	color: string
): { name: 'rgb' | 'hsl'; args: string[] } | undefined {
	const match = /^(rgb|hsl)a?\(([^()]*)\)$/i.exec(color.trim())
	const args = match?.[2]?.trim().split(/[\s,/]+/)
	if (!match || !args || (args.length !== 3 && args.length !== 4)) {
		return undefined
	}
	return { name: match[1]!.toLowerCase() as 'rgb' | 'hsl', args }
}

// A number, or a percentage scaled so 100% = `percentOf`.
function parseChannel(raw: string, percentOf: number): number | undefined {
	const isPercent = raw.endsWith('%')
	const text = isPercent ? raw.slice(0, -1) : raw
	const n = text === '' ? Number.NaN : Number(text)
	if (!Number.isFinite(n)) return undefined
	return isPercent ? (n / 100) * percentOf : n
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	const a = s * Math.min(l, 1 - l)
	const f = (n: number) => {
		const k = (n + h / 30) % 12
		return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255
	}
	return [f(0), f(8), f(4)]
}

/**
 * Parse `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` and
 * `hsl()`/`hsla()` (comma or space/slash syntax, percentages allowed).
 * Returns `undefined` for anything else (named colors, CSS variables, …).
 */
export function parseColor(color: string): Rgba | undefined {
	const trimmed = color.trim()

	const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(trimmed)?.[1]
	if (hex) {
		const full = hex.length <= 4 ? hex.replace(/./g, '$&$&') : hex
		const [r = 0, g = 0, b = 0, a = 255] = [0, 2, 4, 6].map((i) =>
			i < full.length ? Number.parseInt(full.slice(i, i + 2), 16) : undefined
		)
		return { r, g, b, a: a / 255 }
	}

	const fn = colorFunctionArgs(trimmed)
	if (!fn) return undefined
	const [x = '', y = '', z = '', alpha = '1'] = fn.args
	const isRgb = fn.name === 'rgb'
	const c1 = parseChannel(isRgb ? x : x.replace(/deg$/i, ''), isRgb ? 255 : 360)
	const c2 = parseChannel(y, isRgb ? 255 : 100)
	const c3 = parseChannel(z, isRgb ? 255 : 100)
	const a = parseChannel(alpha, 1)
	if (c1 === undefined || c2 === undefined || c3 === undefined) return undefined
	if (a === undefined) return undefined

	const [r, g, b] = isRgb
		? [c1, c2, c3]
		: hslToRgb(
				((c1 % 360) + 360) % 360,
				clamp(c2 / 100, 0, 1),
				clamp(c3 / 100, 0, 1)
			)
	const channel = (v: number) => Math.round(clamp(v, 0, 255))
	return { r: channel(r), g: channel(g), b: channel(b), a: clamp(a, 0, 1) }
}

function toRgba(color: Rgba | string): Rgba {
	if (typeof color !== 'string') return color
	const parsed = parseColor(color)
	if (!parsed) throw new TypeError(`Unsupported color: ${color}`)
	return parsed
}

/** `#rrggbb` (or `#rrggbbaa` with `alpha: true`). Throws on unparseable strings. */
export function toHex(
	color: Rgba | string,
	options: { alpha?: boolean } = {}
): string {
	const { r, g, b, a } = toRgba(color)
	const channels = options.alpha ? [r, g, b, a * 255] : [r, g, b]
	return `#${channels
		.map((v) =>
			Math.round(clamp(v, 0, 255))
				.toString(16)
				.padStart(2, '0')
		)
		.join('')}`
}

/** `rgb(r, g, b)`, or `rgba(r, g, b, a)` when translucent. Throws on unparseable strings. */
export function toRgbString(color: Rgba | string): string {
	const { r, g, b, a } = toRgba(color)
	const [rr, gg, bb] = [r, g, b].map((v) => Math.round(clamp(v, 0, 255)))
	return a < 1 ? `rgba(${rr}, ${gg}, ${bb}, ${a})` : `rgb(${rr}, ${gg}, ${bb})`
}

/** WCAG 2.x relative luminance (0 = black, 1 = white); alpha is ignored. */
export function relativeLuminance(color: Rgba | string): number {
	const { r, g, b } = toRgba(color)
	const [lr, lg, lb] = [r, g, b].map((v) => {
		const c = clamp(v, 0, 255) / 255
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
	}) as [number, number, number]
	return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

/** WCAG contrast ratio between two colors, from 1 to 21. */
export function contrastRatio(a: Rgba | string, b: Rgba | string): number {
	const la = relativeLuminance(a)
	const lb = relativeLuminance(b)
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Whichever of `light`/`dark` contrasts more with `background` (ties go to `light`). */
export function contrastText(
	background: Rgba | string,
	options: { light?: string; dark?: string } = {}
): string {
	const { light = '#ffffff', dark = '#000000' } = options
	return contrastRatio(background, light) >= contrastRatio(background, dark)
		? light
		: dark
}

function mix(a: Rgba, b: Rgba, weight: number): Rgba {
	const t = clamp(weight, 0, 1)
	const at = (x: number, y: number) => x + (y - x) * t
	return {
		r: at(a.r, b.r),
		g: at(a.g, b.g),
		b: at(a.b, b.b),
		a: at(a.a, b.a)
	}
}

const hexOf = (color: Rgba) => toHex(color, { alpha: color.a < 1 })

/** Blend `b` into `a` by `weight` (0 = `a`, 1 = `b`) as hex; alpha kept only when translucent. */
export function mixColors(
	a: Rgba | string,
	b: Rgba | string,
	weight: number
): string {
	return hexOf(mix(toRgba(a), toRgba(b), weight))
}

/** Darken toward black (`amount` < 0) or lighten toward white (> 0); `amount` in -1..1. Returns hex. */
export function shade(color: Rgba | string, amount: number): string {
	const base = toRgba(color)
	const v = amount < 0 ? 0 : 255
	return hexOf(mix(base, { r: v, g: v, b: v, a: base.a }, Math.abs(amount)))
}
