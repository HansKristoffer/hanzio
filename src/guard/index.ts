import { InvariantError } from '../error'
import type { NonEmptyArray } from '../types'

/** Non-null object that is not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Object literal or `Object.create(null)`; excludes arrays, class instances, Dates, Maps. */
export function isPlainObject(
	value: unknown
): value is Record<string, unknown> {
	if (!isRecord(value)) return false
	const prototype = Object.getPrototypeOf(value)
	return prototype === Object.prototype || prototype === null
}

export function isDefined<T>(value: T): value is NonNullable<T> {
	return value !== null && value !== undefined
}

export function isTruthy<T>(
	value: T
): value is Exclude<T, false | 0 | 0n | '' | null | undefined> {
	return Boolean(value)
}

export function isString(value: unknown): value is string {
	return typeof value === 'string'
}

/** `typeof number`, excluding NaN. Infinity passes. */
export function isNumber(value: unknown): value is number {
	return typeof value === 'number' && !Number.isNaN(value)
}

export function isBoolean(value: unknown): value is boolean {
	return typeof value === 'boolean'
}

// biome-ignore lint/suspicious/noExplicitAny: `any` params so every function signature narrows
export function isFunction(value: unknown): value is (...args: any[]) => any {
	return typeof value === 'function'
}

/** Whether `value` is in `list`. Omit `value` to get a reusable guard, e.g. for `.filter`. */
export function isOneOf<const T extends readonly unknown[]>(
	list: T
): (value: unknown) => value is T[number]
export function isOneOf<const T extends readonly unknown[]>(
	list: T,
	value: unknown
): value is T[number]
export function isOneOf(list: readonly unknown[], ...value: unknown[]) {
	if (value.length === 0) return (item: unknown) => list.includes(item)
	return list.includes(value[0])
}

/** Own-property check that narrows `key` to `keyof O`. */
export function hasKey<O extends object>(
	object: O,
	key: PropertyKey
): key is keyof O {
	return Object.hasOwn(object, key)
}

export function isNonEmpty<T>(
	array: readonly T[]
): array is readonly [T, ...T[]] {
	return array.length > 0
}

/** Copy of `array` typed as non-empty (e.g. for `z.enum`); throws when empty. */
export function nonEmpty<T>(
	array: readonly T[],
	message = 'Expected a non-empty array'
): NonEmptyArray<T> {
	if (!isNonEmpty(array)) throw new InvariantError(message)
	return [...array]
}
