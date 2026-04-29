import type { z } from 'zod'

// Helper to safely get a property from an unknown def object
function getDefProp<T>(def: unknown, prop: string): T | undefined {
	return (def as Record<string, unknown>)?.[prop] as T | undefined
}

/**
 * Convert a Zod schema to a human-readable TypeScript-like interface string
 */
export function zodToTypeString(schema: z.ZodType, indent = 0): string {
	const pad = '  '.repeat(indent)
	const innerPad = '  '.repeat(indent + 1)

	// Get the schema definition - try both Zod 4 and Zod 3 patterns
	const def =
		(schema as unknown as { _zod?: { def: unknown } })._zod?.def ??
		(schema as unknown as { _def: unknown })._def

	if (!def) return 'unknown'

	// Zod 4 uses 'type' property with lowercase values (e.g., 'object', 'string')
	// Zod 3 uses 'typeName' with 'Zod' prefix (e.g., 'ZodObject', 'ZodString')
	const schemaType =
		getDefProp<string>(def, 'type') ?? getDefProp<string>(def, 'typeName')

	switch (schemaType) {
		// Zod 4 lowercase types
		case 'object': {
			const shape = getDefProp<Record<string, z.ZodType>>(def, 'shape')
			if (!shape || Object.keys(shape).length === 0) return '{}'

			const fields = Object.entries(shape).map(([key, value]) => {
				// Zod 4: check value.type === 'optional', Zod 3: check _def.typeName
				const valueType = getDefProp<string>(
					(value as unknown as { _zod?: { def: unknown } })._zod?.def ??
						(value as unknown as { _def?: unknown })._def,
					'type'
				)
				const isOptional = valueType === 'optional'
				const innerSchema = isOptional
					? (getDefProp<z.ZodType>(
							(value as unknown as { _zod?: { def: unknown } })._zod?.def ??
								(value as unknown as { _def?: unknown })._def,
							'innerType'
						) ?? value)
					: value
				const typeStr = zodToTypeString(innerSchema, indent + 1)
				return `${innerPad}${key}${isOptional ? '?' : ''}: ${typeStr}`
			})

			return `{\n${fields.join('\n')}\n${pad}}`
		}

		case 'array': {
			// Zod 4 uses 'element', Zod 3 uses 'type'
			const itemType =
				getDefProp<z.ZodType>(def, 'element') ??
				getDefProp<z.ZodType>(def, 'type')
			return itemType ? `${zodToTypeString(itemType, indent)}[]` : 'unknown[]'
		}

		case 'string':
			return 'string'

		case 'number':
			return 'number'

		case 'boolean':
			return 'boolean'

		case 'date':
			return 'Date'

		case 'null':
			return 'null'

		case 'undefined':
			return 'undefined'

		case 'any':
			return 'any'

		case 'unknown':
			return 'unknown'

		case 'record': {
			const valueType = getDefProp<z.ZodType>(def, 'valueType')
			return valueType
				? `Record<string, ${zodToTypeString(valueType, indent)}>`
				: 'Record<string, unknown>'
		}

		case 'enum': {
			const values = getDefProp<string[]>(def, 'values')
			return values ? values.map((v) => `"${v}"`).join(' | ') : 'string'
		}

		case 'literal': {
			const value = getDefProp<unknown>(def, 'value')
			return typeof value === 'string' ? `"${value}"` : String(value)
		}

		case 'union': {
			const options = getDefProp<z.ZodType[]>(def, 'options')
			return options
				? options.map((o) => zodToTypeString(o, indent)).join(' | ')
				: 'unknown'
		}

		case 'optional': {
			const inner = getDefProp<z.ZodType>(def, 'innerType')
			return inner ? `${zodToTypeString(inner, indent)} | undefined` : 'unknown'
		}

		case 'nullable': {
			const inner = getDefProp<z.ZodType>(def, 'innerType')
			return inner ? `${zodToTypeString(inner, indent)} | null` : 'unknown'
		}

		case 'default': {
			const inner = getDefProp<z.ZodType>(def, 'innerType')
			return inner ? zodToTypeString(inner, indent) : 'unknown'
		}

		// Zod 3 compatibility (with 'Zod' prefix)
		case 'ZodObject':
		case 'ZodArray':
		case 'ZodString':
		case 'ZodNumber':
		case 'ZodBoolean':
		case 'ZodDate':
		case 'ZodNull':
		case 'ZodUndefined':
		case 'ZodAny':
		case 'ZodUnknown':
		case 'ZodRecord':
		case 'ZodEnum':
		case 'ZodLiteral':
		case 'ZodUnion':
		case 'ZodOptional':
		case 'ZodNullable':
		case 'ZodDefault':
			// For Zod 3, recurse with the lowercase version
			return zodToTypeString(schema, indent)

		default:
			return 'unknown'
	}
}

/**
 * Generate example JSON from a Zod schema
 */
export function zodToExample(schema: z.ZodType): unknown {
	const def =
		(schema as unknown as { _zod?: { def: unknown } })._zod?.def ??
		(schema as unknown as { _def: unknown })._def
	if (!def) return null

	// Zod 4 uses 'type', Zod 3 uses 'typeName'
	const schemaType =
		getDefProp<string>(def, 'type') ?? getDefProp<string>(def, 'typeName')

	switch (schemaType) {
		case 'object': {
			const shape = getDefProp<Record<string, z.ZodType>>(def, 'shape')
			if (!shape) return {}
			const result: Record<string, unknown> = {}
			for (const [key, value] of Object.entries(shape)) {
				const valueType = getDefProp<string>(
					(value as unknown as { _zod?: { def: unknown } })._zod?.def ??
						(value as unknown as { _def?: unknown })._def,
					'type'
				)
				const isOptional = valueType === 'optional'
				if (!isOptional) {
					result[key] = zodToExample(value)
				}
			}
			return result
		}

		case 'array': {
			// Zod 4 uses 'element', Zod 3 uses 'type'
			const itemType =
				getDefProp<z.ZodType>(def, 'element') ??
				getDefProp<z.ZodType>(def, 'type')
			// Always return array with one item for better example
			return itemType ? [zodToExample(itemType)] : []
		}

		case 'string':
			return ''

		case 'number':
			return 0

		case 'boolean':
			return false

		case 'enum': {
			const values = getDefProp<string[]>(def, 'values')
			return values?.[0] ?? ''
		}

		case 'literal':
			return getDefProp<unknown>(def, 'value')

		case 'optional':
		case 'default': {
			const inner = getDefProp<z.ZodType>(def, 'innerType')
			return inner ? zodToExample(inner) : null
		}

		case 'record':
			return {}

		default:
			return null
	}
}
