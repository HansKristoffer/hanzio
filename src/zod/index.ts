import { z } from 'zod'

export { jsonToZodSchemaMapper } from './jsonToZodSchemaMapper'
export {
	toGteLteFilter,
	type ZodMinMaxFilter,
	zodMinMaxFilter
} from './zodMinMaxFilter'
export { zodToExample, zodToTypeString } from './zodToTypeString'

export type GenericId<TypeName extends string> = string & z.$brand<TypeName>

export function createZId<TypeName extends string>(typeName: TypeName) {
	return z.string().min(1, `${typeName} ID is required`).brand<TypeName>()
}

export function zSingleOrArray<T extends z.ZodType>(
	schema: T
): z.ZodUnion<readonly [z.ZodArray<T>, T]> {
	return z.union([z.array(schema), schema])
}

export function normalizeSingleOrArray<T>(
	value: T | readonly T[] | null | undefined
): T[] {
	if (value == null) return []
	if (Array.isArray(value)) return [...(value as readonly T[])]
	return [value as T]
}
