import type { z } from 'zod'
import { type Def, defOf, type Schema, walk } from './zodToTypeString'

// Pipes are read from their input side, except preprocess (`in` is a transform)
function pipeInput(def: z.core.$ZodPipeDef): Schema {
	return defOf(def.in).type === 'transform' ? def.out : def.in
}

function unwrapOnce(def: Def): Schema | undefined {
	switch (def.type) {
		case 'optional':
		case 'nullable':
		case 'default':
		case 'prefault':
		case 'nonoptional':
		case 'catch':
		case 'readonly':
			return def.innerType
		case 'lazy':
			return def.getter()
		case 'pipe':
			return pipeInput(def)
		default:
			return undefined
	}
}

/**
 * Strips optional/nullable/default/prefault/nonoptional/catch/readonly/lazy
 * wrappers and pipes (input side) until the schema that carries the shape.
 */
export function unwrapSchema(schema: Schema): Schema {
	const inner = unwrapOnce(defOf(schema))
	return inner ? unwrapSchema(inner) : schema
}

/** Values of a (possibly wrapped) `z.enum`, stringified; `undefined` for other schemas. */
export function getEnumValues(schema: Schema): string[] | undefined {
	const def = defOf(unwrapSchema(schema))
	return def.type === 'enum'
		? Object.values(def.entries).map(String)
		: undefined
}

/** Shape of a (possibly wrapped) `z.object`; `undefined` for other schemas. */
export function getObjectShape(
	schema: Schema
): Readonly<Record<string, Schema>> | undefined {
	const def = defOf(unwrapSchema(schema))
	return def.type === 'object' ? def.shape : undefined
}

/**
 * Initial form state for a schema: `.default()` values, `undefined` for
 * optional, `null` for nullable, first enum/literal/union option, `''`, `0`,
 * `false`, `[]`, and objects filled per key. Other types give `undefined`.
 * The result is typed as the schema output but is NOT validated (`''` fails
 * `.min(1)`, dates stay `undefined`).
 */
export function zodDefaults<S extends Schema>(schema: S): z.output<S> {
	return defaultFor(schema) as z.output<S>
}

function defaultFor(schema: Schema): unknown {
	return walk(schema, undefined, (def): unknown => {
		switch (def.type) {
			case 'default':
			case 'prefault':
				return def.defaultValue
			case 'optional':
				return undefined
			case 'nullable':
				return null
			case 'object': {
				const result: Record<string, unknown> = {}
				for (const [key, child] of Object.entries(def.shape)) {
					result[key] = defaultFor(child)
				}
				return result
			}
			case 'array':
				return []
			case 'string':
				return ''
			case 'number':
				return 0
			case 'bigint':
				return 0n
			case 'boolean':
				return false
			case 'enum':
				return Object.values(def.entries)[0]
			case 'literal':
				return def.values[0]
			case 'union':
				return def.options[0] && defaultFor(def.options[0])
			default: {
				const inner = unwrapOnce(def)
				return inner && defaultFor(inner)
			}
		}
	})
}
