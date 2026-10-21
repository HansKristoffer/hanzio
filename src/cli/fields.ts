import type { z } from 'zod'
import { unwrapOnce } from '../zod/introspect'
import { type Def, defOf, type Schema } from '../zod/zodToTypeString'

// No runtime `zod` import: a CLI made only of raw commands loads without it.

/** Thrown for bad argv; `cli.run()` turns it into a `CliUsageError`. */
export class UsageError extends Error {
	constructor(
		message: string,
		readonly kind:
			| 'missing-command'
			| 'unknown-command'
			| 'invalid-arguments' = 'invalid-arguments'
	) {
		super(message)
	}
}

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
	/** One-letter short flag. */
	alias?: string
	/** Extra long flag names, from multi-character aliases. */
	aliases: string[]
	env: string[]
	/** `--name` alone is `true`, `--name=value` is the value. */
	optionalValue: boolean
	choices?: string[]
}

/** The `parseArgs` option name. A `noX` key is its own flag, never `--x` negated. */
export const optionName = (field: Field) =>
	field.flag.startsWith('no-') ? field.key : field.flag

const strings = (value: unknown, what: string, key: string): string[] => {
	const list = value === undefined ? [] : Array.isArray(value) ? value : [value]
	if (list.some((item) => typeof item !== 'string' || !item))
		throw new Error(
			`hanzio/cli: ${what} ${JSON.stringify(value)} of "${key}" must be a string or string[]`
		)
	return list
}

const kindOf = (def: Def) =>
	def.type === 'boolean'
		? 'boolean'
		: def.type === 'number'
			? 'number'
			: 'string'

function choicesOf(def: Def): string[] | undefined {
	if (def.type === 'enum') return Object.values(def.entries).map(String)
	if (def.type === 'literal') return def.values.map(String)
	return undefined
}

// `z.union([z.boolean(), z.string()])` (or `z.literal(true)`): an optional value.
function optionalValueOf(def: Def): Def | undefined {
	if (def.type !== 'union' || def.options.length !== 2) return undefined
	const [a, b] = def.options.map(defOf) as [Def, Def]
	const flag = (d: Def) =>
		d.type === 'boolean' || (d.type === 'literal' && d.values.includes(true))
	if (flag(a) && kindOf(b) === 'string' && b.type !== 'literal') return b
	if (flag(b) && kindOf(a) === 'string' && a.type !== 'literal') return a
	return undefined
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
		// `.meta()` with no argument reads Zod's global registry.
		const meta = (
			current as { meta?: () => Record<string, unknown> | undefined }
		).meta?.()
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
	const valueDef = multiple ? undefined : optionalValueOf(def)
	const names = strings(meta.alias, 'alias', key)
	return {
		key,
		flag: kebab(key),
		kind: valueDef ? 'string' : kindOf(def),
		multiple,
		positional: meta.positional === true,
		optional,
		hasDefault,
		defaultValue,
		description:
			typeof meta.description === 'string' ? meta.description : undefined,
		alias: names.find((name) => name.length === 1),
		aliases: names.filter((name) => name.length > 1).map(kebab),
		env: strings(meta.env, 'env', key),
		optionalValue: valueDef !== undefined,
		choices: choicesOf(valueDef ?? def)
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
 * numbers coerced, `.meta({ env })` as fallback (blank variables count as
 * unset), and a missing required boolean or array read as `false` or `[]`.
 * Extra positionals are a usage error unless `strict` is false.
 */
export function readFields(
	fields: Field[],
	values: Record<string, string | boolean | (string | boolean)[] | undefined>,
	positionals: string[],
	env: Record<string, string | undefined>,
	strict = true
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
		else raw = values[optionName(field)]
		if (field.optionalValue && raw === '') raw = true
		const value =
			raw === undefined
				? field.env.map((name) => env[name]).find((value) => value?.trim())
				: undefined
		if (value !== undefined) raw = field.multiple ? [value] : value
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
	if (strict && queue.length)
		throw new UsageError(`Unexpected argument "${queue[0]}"`)
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
		field.kind === 'boolean' &&
		field.defaultValue === true &&
		!field.flag.startsWith('no-')
			? `--[no-]${field.flag}`
			: `--${field.flag}`
	const type = `<${field.choices?.join('|') ?? field.kind}>`
	const value =
		field.kind === 'boolean'
			? ''
			: field.optionalValue
				? `[=${type}]`
				: ` ${type}${field.multiple ? '...' : ''}`
	const aliases = field.aliases.map((alias) => `, --${alias}`).join('')
	return `${field.alias ? `-${field.alias}, ` : ''}${name}${aliases}${value}`
}

export function fieldHelp(field: Field): string {
	const showDefault =
		field.hasDefault &&
		field.defaultValue !== undefined &&
		!(field.kind === 'boolean' && field.defaultValue === false)
	return [
		field.description,
		showDefault && `(default: ${JSON.stringify(field.defaultValue)})`,
		field.env.length > 0 && `[env: ${field.env.join(', ')}]`
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
