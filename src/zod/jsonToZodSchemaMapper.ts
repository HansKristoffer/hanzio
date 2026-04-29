import { z } from 'zod'

type PropertyConfig<T, U> = {
	[K in keyof T]?: (jsonObject: U) => T[K]
}

export function jsonToZodSchemaMapper<
	T extends z.ZodType,
	U extends Record<string, any>
>(
	jsonObject: U,
	zodSchema: T,
	config: PropertyConfig<z.infer<T>, U>
): z.infer<T> {
	const result: Partial<z.infer<T>> = {}

	const shape = zodSchema instanceof z.ZodObject ? zodSchema.shape : {}

	for (const key of Object.keys(shape)) {
		const fieldConfig = config[key as keyof z.infer<T>]
		let value: any = jsonObject[key as keyof U]

		if (fieldConfig) {
			value = fieldConfig(jsonObject)
		}

		if (
			shape[key] instanceof z.ZodObject &&
			value &&
			typeof value === 'object'
		) {
			// @ts-expect-error recursive mapper narrows key by shape iteration
			result[key] = jsonToZodSchemaMapper(
				value,
				shape[key] as z.ZodObject,
				(config[key as keyof z.infer<T>] || {}) as PropertyConfig<any, any>
			)
		} else {
			result[key as keyof z.infer<T>] = value
		}
	}

	return zodSchema.parse(result)
}
