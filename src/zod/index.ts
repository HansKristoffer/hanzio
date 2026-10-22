import { z } from 'zod'
import { toArray } from '../array/index.js'
import { err, ok, type Result } from '../promise/index.js'
import type { JsonObject, JsonValue } from '../string/index.js'

export {
	getEnumValues,
	getObjectShape,
	unwrapSchema,
	zodDefaults
} from './introspect.js'

export { jsonToZodSchemaMapper } from './jsonToZodSchemaMapper.js'
export {
	createMinMaxFilter,
	type MinMaxFilter,
	toGteLteFilter,
	toGtLtFilter,
	type ZodMinMaxFilter,
	zodMinMaxFilter
} from './zodMinMaxFilter.js'
export { zodToExample, zodToTypeString } from './zodToTypeString.js'

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

/** An E.164 phone number: `+`, then 7 to 15 digits with no leading zero. */
export const E164_REGEX = /^\+[1-9]\d{6,14}$/

/**
 * An optional E.164 phone number for forms: a cleared input submits `''`,
 * which means "no number", so `''` and `null` both parse to `null`.
 *
 * Deliberately not `union([regex, literal('')])`: that serializes the empty
 * literal as `enum: [""]`, which Gemini function declarations reject.
 */
export const zOptionalE164 = z
	.string()
	.refine(
		(value) => value === '' || E164_REGEX.test(value),
		'Phone number must be in E.164 format (e.g. +14155551234)'
	)
	.describe('E.164 phone number (e.g. +14155551234); empty string clears it')
	.nullable()
	.transform((value) => value || null)

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
