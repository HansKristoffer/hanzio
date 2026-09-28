import { z } from 'zod'
import { toArray } from '../array'
import { err, ok, type Result } from '../promise'
import type { JsonObject, JsonValue } from '../string'

export {
	getEnumValues,
	getObjectShape,
	unwrapSchema,
	zodDefaults
} from './introspect'

export { jsonToZodSchemaMapper } from './jsonToZodSchemaMapper'
export {
	createMinMaxFilter,
	type MinMaxFilter,
	toGteLteFilter,
	toGtLtFilter,
	type ZodMinMaxFilter,
	zodMinMaxFilter
} from './zodMinMaxFilter'
export { zodToExample, zodToTypeString } from './zodToTypeString'

export type GenericId<TypeName extends string> = string & z.$brand<TypeName>

export function createZId<TypeName extends string>(
	typeName: TypeName,
	{ prefix = '' }: { prefix?: string } = {}
) {
	return z
		.string()
		.min(1, `${typeName} ID is required`)
		.startsWith(prefix, `${typeName} ID must start with "${prefix}"`)
		.brand<TypeName>()
}

/** Branded string id: `Id<'User'>` is not assignable to `Id<'Organization'>`. */
export type Id<TypeName extends string> = GenericId<TypeName>

/** Brands a string without checking it (fixtures, trusted sources). */
export function asId<TypeName extends string>(value: string): Id<TypeName> {
	return value as Id<TypeName>
}

/** Validates a non-empty string and brands it; throws a `ZodError` otherwise. */
export function parseId<TypeName extends string>(
	typeName: TypeName,
	value: unknown
): Id<TypeName> {
	return createZId(typeName).parse(value) as Id<TypeName>
}

export function safeParseId<TypeName extends string>(
	typeName: TypeName,
	value: unknown
): Result<Id<TypeName>, z.ZodError> {
	// `.brand()` output stays deferred for a generic TypeName
	return toResult(createZId(typeName).safeParse(value)) as Result<
		Id<TypeName>,
		z.ZodError
	>
}

/**
 * Binds the id helpers to a project's union of entity names once:
 * `export const { zId, asId, parseId, safeParseId } = createIdHelpers<'User' | 'Organization'>()`
 */
export function createIdHelpers<TypeNames extends string>() {
	return {
		zId: <T extends TypeNames>(typeName: T) => createZId(typeName),
		asId: asId as <T extends TypeNames>(value: string) => Id<T>,
		parseId: parseId as <T extends TypeNames>(
			typeName: T,
			value: unknown
		) => Id<T>,
		safeParseId: safeParseId as <T extends TypeNames>(
			typeName: T,
			value: unknown
		) => Result<Id<T>, z.ZodError>
	}
}

/** Any JSON value (no `undefined`, `NaN` or `Infinity`). */
export const zJsonValue: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(zJsonValue),
		zJsonObject
	])
)

export const zJsonObject: z.ZodType<JsonObject> = z.record(
	z.string(),
	zJsonValue
)

/** `JSON.parse` + `schema.safeParse` without throwing. */
export function parseJson<S extends z.ZodType>(
	text: string,
	schema: S
): Result<z.output<S>, SyntaxError | z.ZodError> {
	let value: unknown
	try {
		value = JSON.parse(text)
	} catch (error) {
		return { ok: false, data: null, error: error as SyntaxError }
	}
	return toResult(schema.safeParse(value))
}

function toResult<T>(result: z.ZodSafeParseResult<T>): Result<T, z.ZodError> {
	return result.success ? ok(result.data) : err(result.error)
}

export function zSingleOrArray<T extends z.ZodType>(
	schema: T
): z.ZodUnion<readonly [z.ZodArray<T>, T]> {
	return z.union([z.array(schema), schema])
}

/** @deprecated Use `toArray` from `hanzio`. */
export const normalizeSingleOrArray = toArray
