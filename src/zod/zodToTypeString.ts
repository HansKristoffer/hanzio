import type { z } from 'zod'
import { isRecord } from '../guard'

export type Schema = z.core.$ZodType
export type Def = z.core.$ZodTypes['_zod']['def']

// Schemas on the current render path, so recursive (lazy/getter) schemas terminate
const visiting = new Set<Schema>()

export function walk<T>(schema: Schema, onCycle: T, fn: (def: Def) => T): T {
	if (visiting.has(schema)) return onCycle
	visiting.add(schema)
	try {
		return fn(defOf(schema))
	} finally {
		visiting.delete(schema)
	}
}

export function defOf(schema: Schema): Def {
	return (schema as z.core.$ZodTypes)._zod.def
}

// Pipes are described by their output, except transforms, whose output can't be inspected
function pipeTarget(def: z.core.$ZodPipeDef): Schema {
	return defOf(def.out).type === 'transform' ? def.in : def.out
}

function literal(value: unknown): string {
	if (typeof value === 'string') return JSON.stringify(value)
	return typeof value === 'bigint' ? `${value}n` : String(value)
}

// Parenthesize unions/intersections where they'd otherwise bind wrongly (e.g. `(a | b)[]`)
function wrap(type: string): string {
	return /[|&]/.test(type) ? `(${type})` : type
}

/**
 * Convert a Zod schema to a human-readable TypeScript-like interface string
 */
export function zodToTypeString(schema: Schema, indent = 0): string {
	return walk(schema, 'unknown', (def) => {
		const pad = '  '.repeat(indent)
		const innerPad = '  '.repeat(indent + 1)
		const render = (inner: Schema) => zodToTypeString(inner, indent)

		switch (def.type) {
			case 'object': {
				const entries = Object.entries(def.shape)
				if (entries.length === 0) return '{}'

				const fields = entries.map(([key, value]) => {
					const valueDef = defOf(value)
					const isOptional = valueDef.type === 'optional'
					const typeStr = zodToTypeString(
						isOptional ? valueDef.innerType : value,
						indent + 1
					)
					return `${innerPad}${key}${isOptional ? '?' : ''}: ${typeStr}`
				})

				return `{\n${fields.join('\n')}\n${pad}}`
			}

			case 'array':
				return `${wrap(render(def.element))}[]`

			case 'tuple': {
				const items = def.items.map(render)
				if (def.rest) items.push(`...${wrap(render(def.rest))}[]`)
				return `[${items.join(', ')}]`
			}

			case 'string':
			case 'number':
			case 'bigint':
			case 'boolean':
			case 'symbol':
			case 'null':
			case 'undefined':
			case 'void':
			case 'never':
			case 'any':
			case 'unknown':
				return def.type

			case 'date':
				return 'Date'

			case 'record':
				return `Record<${render(def.keyType)}, ${render(def.valueType)}>`

			case 'map':
				return `Map<${render(def.keyType)}, ${render(def.valueType)}>`

			case 'set':
				return `Set<${render(def.valueType)}>`

			case 'promise':
				return `Promise<${render(def.innerType)}>`

			case 'enum':
				return Object.values(def.entries).map(literal).join(' | ')

			case 'literal':
				return def.values.map(literal).join(' | ')

			case 'union':
				return def.options.map(render).join(' | ')

			case 'intersection':
				return `${wrap(render(def.left))} & ${wrap(render(def.right))}`

			case 'optional':
				return `${render(def.innerType)} | undefined`

			case 'nullable':
				return `${render(def.innerType)} | null`

			case 'nonoptional': {
				const innerDef = defOf(def.innerType)
				return render(
					innerDef.type === 'optional' ? innerDef.innerType : def.innerType
				)
			}

			case 'default':
			case 'prefault':
			case 'catch':
			case 'readonly':
				return render(def.innerType)

			case 'lazy':
				return render(def.getter())

			case 'pipe':
				return render(pipeTarget(def))

			default:
				return 'unknown'
		}
	})
}

/**
 * Generate example JSON from a Zod schema. Values are JSON-safe: dates become ISO
 * strings, bigints numbers, sets arrays and maps/records empty objects.
 */
export function zodToExample(schema: Schema): unknown {
	return walk(schema, null, (def): unknown => {
		switch (def.type) {
			case 'object': {
				const result: Record<string, unknown> = {}
				for (const [key, value] of Object.entries(def.shape)) {
					if (defOf(value).type !== 'optional') {
						result[key] = zodToExample(value)
					}
				}
				return result
			}

			// Always return array with one item for better example
			case 'array':
				return [zodToExample(def.element)]

			case 'set':
				return [zodToExample(def.valueType)]

			case 'tuple':
				return def.items.map(zodToExample)

			case 'string':
				return ''

			case 'number':
			case 'bigint':
				return 0

			case 'boolean':
				return false

			case 'date':
				return new Date(0).toISOString()

			case 'enum':
				return Object.values(def.entries)[0]

			case 'literal':
				return def.values[0]

			case 'union':
				return zodToExample(def.options[0] as Schema)

			case 'intersection': {
				const left = zodToExample(def.left)
				const right = zodToExample(def.right)
				return isRecord(left) && isRecord(right) ? { ...left, ...right } : left
			}

			case 'optional':
			case 'nullable':
			case 'nonoptional':
			case 'default':
			case 'prefault':
			case 'catch':
			case 'readonly':
			case 'promise':
				return zodToExample(def.innerType)

			case 'lazy':
				return zodToExample(def.getter())

			case 'pipe':
				return zodToExample(pipeTarget(def))

			case 'record':
			case 'map':
				return {}

			default:
				return null
		}
	})
}
