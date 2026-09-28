import { z } from 'zod'
import { isRecord } from '../guard'

type ObjectConfig<V> =
	V extends Record<string, unknown>
		? PropertyConfig<V, Record<string, any>>
		: never

// Nested objects (and arrays of objects) take a config for the nested JSON value
type NestedConfig<V> = V extends readonly (infer E)[]
	? ObjectConfig<E>
	: ObjectConfig<V>

type PropertyConfig<T, U> = {
	[K in keyof T]?: ((jsonObject: U) => T[K]) | NestedConfig<NonNullable<T[K]>>
}

export function jsonToZodSchemaMapper<
	T extends z.ZodType,
	U extends Record<string, any>
>(
	jsonObject: U,
	zodSchema: T,
	config: PropertyConfig<z.infer<T>, U>
): z.infer<T> {
	return zodSchema.parse(mapObject(jsonObject, zodSchema, config))
}

function mapObject(
	jsonObject: Record<string, any>,
	schema: z.core.$ZodType,
	config: Record<string, unknown>
): Record<string, unknown> {
	const shape = schema instanceof z.ZodObject ? schema.shape : {}
	const result: Record<string, unknown> = {}

	for (const [key, fieldSchema] of Object.entries(shape)) {
		const fieldConfig = config[key]
		if (typeof fieldConfig === 'function') {
			result[key] = fieldConfig(jsonObject)
			continue
		}

		const nested = (fieldConfig ?? {}) as Record<string, unknown>
		const value = jsonObject[key]
		const inner = unwrap(fieldSchema)
		const element = inner instanceof z.ZodArray && unwrap(inner.element)

		if (inner instanceof z.ZodObject && isRecord(value)) {
			result[key] = mapObject(value, inner, nested)
		} else if (element instanceof z.ZodObject && Array.isArray(value)) {
			result[key] = value.map((item) =>
				isRecord(item) ? mapObject(item, element, nested) : item
			)
		} else {
			result[key] = value
		}
	}

	return result
}

function unwrap(schema: z.core.$ZodType): z.core.$ZodType {
	return schema instanceof z.ZodOptional || schema instanceof z.ZodNullable
		? unwrap(schema.unwrap())
		: schema
}
