import { z } from 'zod'
import { unwrapOnce } from '../zod/introspect'
import { defOf, type Schema } from '../zod/zodToTypeString'

/** Thrown for bad argv. The CLI prints it with a `--help` hint and exits 2. */
export class UsageError extends Error {}

/** One key of an input or globals object, read as a flag or a positional. */
export type Field = {
	key: string
	flag: string
	kind: 'string' | 'number' | 'boolean'
	multiple: boolean
	positional: boolean
	optional: boolean
	hasDefault: boolean
	defaultValue: unknown
	description?: string
	alias?: string
	env?: string
	choices?: string[]
}

const kebab = (key: string) =>
	key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

export function fieldsOf(schema: z.ZodObject | undefined): Field[] {
	if (!schema) return []
	return Object.entries(schema.shape).map(([key, child]) => toField(key, child))
}

function toField(key: string, schema: Schema): Field {
	// Metadata can sit on any wrapper; the outermost `.meta()`/`.describe()` wins.
	const metas: Record<string, unknown>[] = []
	let optional = false
	let hasDefault = false
	let defaultValue: unknown
	let current = schema
	for (;;) {
		const meta = z.globalRegistry.get(current)
		if (meta) metas.unshift(meta)
		const def = defOf(current)
		if (def.type === 'optional') optional = true
		if ((def.type === 'default' || def.type === 'prefault') && !hasDefault) {
			hasDefault = true
			defaultValue = def.defaultValue
		}
		const inner = unwrapOnce(def)
		if (!inner) break
		current = inner
	}
	const meta: Record<string, unknown> = Object.assign({}, ...metas)

	let def = defOf(current)
	const multiple = def.type === 'array'
	if (def.type === 'array') {
		let element = def.element
		for (let inner = unwrapOnce(defOf(element)); inner; ) {
			element = inner
			inner = unwrapOnce(defOf(element))
		}
		def = defOf(element)
	}
	const alias = meta.alias
	if (alias !== undefined && (typeof alias !== 'string' || alias.length !== 1))
		throw new Error(
			`hanzio/cli: alias ${JSON.stringify(alias)} of "${key}" must be one character`
		)
	return {
		key,
		flag: kebab(key),
		kind:
			def.type === 'boolean'
				? 'boolean'
				: def.type === 'number'
					? 'number'
					: 'string',
		multiple,
		positional: meta.positional === true,
		optional,
		hasDefault,
		defaultValue,
		description:
			typeof meta.description === 'string' ? meta.description : undefined,
		alias,
		env: typeof meta.env === 'string' ? meta.env : undefined,
		choices:
			def.type === 'enum'
				? Object.values(def.entries).map(String)
				: def.type === 'literal'
					? def.values.map(String)
					: undefined
	}
}

function coerce(field: Field, value: string | boolean): unknown {
	if (typeof value !== 'string') return value
	if (field.kind === 'number' && value.trim() !== '') {
		const number = Number(value)
		return Number.isNaN(number) ? value : number
	}
	if (field.kind === 'boolean') {
		if (value === 'true' || value === '1') return true
		if (value === 'false' || value === '0' || value === '') return false
	}
	return value
}

/**
 * Builds the raw object Zod validates: flag values and positionals by key,
 * numbers coerced, `.meta({ env })` as fallback, and a missing required
 * boolean or array read as `false` or `[]`.
 */
export function readFields(
	fields: Field[],
	values: Record<string, string | boolean | (string | boolean)[] | undefined>,
	positionals: string[],
	env: Record<string, string | undefined>
): Record<string, unknown> {
	const result: Record<string, unknown> = {}
	const queue = [...positionals]
	for (const field of fields) {
		let raw: string | boolean | (string | boolean)[] | undefined
		if (field.positional)
			raw = field.multiple
				? queue.length
					? queue.splice(0)
					: undefined
				: queue.shift()
		else raw = values[field.flag]
		if (raw === undefined && field.env && env[field.env] !== undefined) {
			const value = env[field.env] as string
			raw = field.multiple ? [value] : value
		}
		if (raw === undefined) {
			if (field.optional || field.hasDefault) continue
			if (field.multiple) raw = []
			else if (field.kind === 'boolean') raw = false
			else continue
		}
		result[field.key] = Array.isArray(raw)
			? raw.map((item) => coerce(field, item))
			: coerce(field, raw)
	}
	if (queue.length) throw new UsageError(`Unexpected argument "${queue[0]}"`)
	return result
}

export function fieldLabel(field: Field): string {
	if (field.positional)
		return field.multiple
			? `<${field.flag}...>`
			: field.optional || field.hasDefault
				? `[${field.flag}]`
				: `<${field.flag}>`
	const name =
		field.kind === 'boolean' && field.defaultValue === true
			? `--[no-]${field.flag}`
			: `--${field.flag}`
	const value =
		field.kind === 'boolean'
			? ''
			: ` <${field.choices?.join('|') ?? field.kind}>${field.multiple ? '...' : ''}`
	return `${field.alias ? `-${field.alias}, ` : ''}${name}${value}`
}

export function fieldHelp(field: Field): string {
	const showDefault =
		field.hasDefault &&
		field.defaultValue !== undefined &&
		!(field.kind === 'boolean' && field.defaultValue === false)
	return [
		field.description,
		showDefault && `(default: ${JSON.stringify(field.defaultValue)})`,
		field.env && `[env: ${field.env}]`
	]
		.filter(Boolean)
		.join(' ')
}

/** Closest candidate within a few edits, for "Did you mean ...?" hints. */
export function closest(
	input: string,
	candidates: readonly string[]
): string | undefined {
	let best: string | undefined
	let bestDistance = Math.max(2, Math.floor(input.length / 3)) + 1
	for (const candidate of candidates) {
		const distance = candidate.startsWith(input)
			? 1
			: levenshtein(input, candidate)
		if (distance < bestDistance) {
			best = candidate
			bestDistance = distance
		}
	}
	return best
}

function levenshtein(a: string, b: string): number {
	let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
	for (let i = 1; i <= a.length; i++) {
		const current = [i]
		for (let j = 1; j <= b.length; j++)
			current[j] = Math.min(
				(previous[j] ?? 0) + 1,
				(current[j - 1] ?? 0) + 1,
				(previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)
			)
		previous = current
	}
	return previous[b.length] ?? 0
}
