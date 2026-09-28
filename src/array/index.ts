import { stableStringify } from '../string'

export interface ArrayDifference<TCurrent, TNext> {
	new: TNext[]
	/** Items present in both arrays (`update` + `unchanged`). */
	upsert: TNext[]
	delete: TCurrent[]
}

export interface ArrayDifferenceWithChanges<TCurrent, TNext>
	extends ArrayDifference<TCurrent, TNext> {
	/** Matched items where `isEqual` returned false. */
	update: TNext[]
	/** Matched items where `isEqual` returned true. */
	unchanged: TNext[]
}

type PropertyKeyValue = string | number | symbol
type NonNullableValue<T> = T extends null | undefined ? never : T
type ItemsMatchingKeyValue<T, TKey extends keyof T, TValue> = [
	Extract<T, Record<TKey, TValue>>
] extends [never]
	? T
	: Extract<T, Record<TKey, TValue>>

export function chunkArray<T>(array: readonly T[], chunkSize: number): T[][] {
	if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
		throw new Error('Chunk size must be a positive integer')
	}

	const chunks: T[][] = []
	for (let index = 0; index < array.length; index += chunkSize) {
		chunks.push(array.slice(index, index + chunkSize))
	}

	return chunks
}

type DifferenceKey<TCurrent, TNext> =
	| (keyof TCurrent & keyof TNext)
	| ((item: TCurrent | TNext) => unknown)

/**
 * Splits `next` into items that are new or also in `current` (`upsert`), and
 * lists the `current` items missing from `next` (`delete`). Items match by a
 * shared key name or a key function; key values are compared as strings.
 * Pass `isEqual` to also split `upsert` into `update` and `unchanged`.
 */
export function findArrayDifferenceByKey<TCurrent, TNext>(
	current: readonly TCurrent[],
	next: readonly TNext[],
	key: DifferenceKey<TCurrent, TNext>,
	options: { isEqual: (current: TCurrent, next: TNext) => boolean }
): ArrayDifferenceWithChanges<TCurrent, TNext>
export function findArrayDifferenceByKey<TCurrent, TNext>(
	current: readonly TCurrent[],
	next: readonly TNext[],
	key: DifferenceKey<TCurrent, TNext>,
	options?: { isEqual?: (current: TCurrent, next: TNext) => boolean }
): ArrayDifference<TCurrent, TNext>
export function findArrayDifferenceByKey<TCurrent, TNext>(
	current: readonly TCurrent[],
	next: readonly TNext[],
	key: DifferenceKey<TCurrent, TNext>,
	options: { isEqual?: (current: TCurrent, next: TNext) => boolean } = {}
):
	| ArrayDifference<TCurrent, TNext>
	| ArrayDifferenceWithChanges<TCurrent, TNext> {
	const { isEqual } = options
	const getKey = (item: TCurrent | TNext) =>
		String(typeof key === 'function' ? key(item) : item[key])
	const currentByKey = new Map(current.map((item) => [getKey(item), item]))
	const matchedKeys = new Set<string>()
	const newItems: TNext[] = []
	const upsertItems: TNext[] = []
	const updateItems: TNext[] = []
	const unchangedItems: TNext[] = []

	for (const item of next) {
		const itemKey = getKey(item)
		if (!currentByKey.has(itemKey)) {
			newItems.push(item)
			continue
		}

		matchedKeys.add(itemKey)
		upsertItems.push(item)
		if (isEqual) {
			const target = isEqual(currentByKey.get(itemKey) as TCurrent, item)
				? unchangedItems
				: updateItems
			target.push(item)
		}
	}

	const difference = {
		new: newItems,
		upsert: upsertItems,
		delete: current.filter((item) => !matchedKeys.has(getKey(item)))
	}

	return isEqual
		? { ...difference, update: updateItems, unchanged: unchangedItems }
		: difference
}

export function getUniqueValues<T>(array: readonly T[]): T[] {
	const seen = new Map<string, T>()

	for (const element of array) {
		const key = stableStringify(element)
		if (!seen.has(key)) {
			seen.set(key, element)
		}
	}

	return Array.from(seen.values())
}

export function compact<T>(array: readonly T[]): NonNullableValue<T>[] {
	return array.filter((item): item is NonNullableValue<T> => item != null)
}

export function getUniqueValuesByKey<T>(
	array: readonly T[],
	keyOrFn: keyof T | ((item: T) => unknown)
): T[] {
	const seen = new Set<unknown>()
	const result: T[] = []

	for (const item of array) {
		const value = typeof keyOrFn === 'function' ? keyOrFn(item) : item[keyOrFn]
		if (seen.has(value)) continue
		seen.add(value)
		result.push(item)
	}

	return result
}

export function groupBy<
	T,
	TKey extends keyof T,
	TGroupKey extends Extract<T[TKey], PropertyKeyValue>
>(array: readonly T[], key: TKey): Partial<Record<TGroupKey, T[]>>
export function groupBy<T, TGroupKey extends PropertyKeyValue>(
	array: readonly T[],
	keyFn: (item: T) => TGroupKey
): Partial<Record<TGroupKey, T[]>>
export function groupBy<T, TGroupKey extends PropertyKeyValue>(
	array: readonly T[],
	keyOrFn: keyof T | ((item: T) => TGroupKey)
): Partial<Record<TGroupKey, T[]>> {
	const result: Partial<Record<TGroupKey, T[]>> = {}

	for (const item of array) {
		const groupKey =
			typeof keyOrFn === 'function'
				? keyOrFn(item)
				: (item[keyOrFn] as TGroupKey)
		result[groupKey] ??= []
		result[groupKey].push(item)
	}

	return result
}

export function countBy<
	T,
	TKey extends keyof T,
	TGroupKey extends Extract<T[TKey], PropertyKeyValue>
>(array: readonly T[], key: TKey): Partial<Record<TGroupKey, number>>
export function countBy<T, TGroupKey extends PropertyKeyValue>(
	array: readonly T[],
	keyFn: (item: T) => TGroupKey
): Partial<Record<TGroupKey, number>>
export function countBy<T, TGroupKey extends PropertyKeyValue>(
	array: readonly T[],
	keyOrFn: keyof T | ((item: T) => TGroupKey)
): Partial<Record<TGroupKey, number>> {
	const result: Partial<Record<TGroupKey, number>> = {}

	for (const item of array) {
		const groupKey =
			typeof keyOrFn === 'function'
				? keyOrFn(item)
				: (item[keyOrFn] as TGroupKey)
		result[groupKey] = (result[groupKey] ?? 0) + 1
	}

	return result
}

export function keyBy<
	T,
	TKey extends keyof T,
	TRecordKey extends Extract<T[TKey], PropertyKeyValue>
>(array: readonly T[], key: TKey): Record<TRecordKey, T>
export function keyBy<T, TRecordKey extends PropertyKeyValue>(
	array: readonly T[],
	keyFn: (item: T) => TRecordKey
): Record<TRecordKey, T>
export function keyBy<T, TRecordKey extends PropertyKeyValue>(
	array: readonly T[],
	keyOrFn: keyof T | ((item: T) => TRecordKey)
): Record<TRecordKey, T> {
	const result = {} as Record<TRecordKey, T>

	for (const item of array) {
		const recordKey =
			typeof keyOrFn === 'function'
				? keyOrFn(item)
				: (item[keyOrFn] as TRecordKey)
		result[recordKey] = item
	}

	return result
}

export function partition<T>(
	array: readonly T[],
	predicate: (item: T, index: number) => boolean
): [matched: T[], unmatched: T[]] {
	const matched: T[] = []
	const unmatched: T[] = []

	array.forEach((item, index) => {
		if (predicate(item, index)) {
			matched.push(item)
		} else {
			unmatched.push(item)
		}
	})

	return [matched, unmatched]
}

export function pickItemsInArray<
	T,
	TKey extends keyof T,
	const TValue extends readonly T[TKey][]
>(
	array: readonly T[],
	key: TKey,
	values: TValue
): ItemsMatchingKeyValue<T, TKey, TValue[number]>[] {
	return array.filter(
		(item): item is ItemsMatchingKeyValue<T, TKey, TValue[number]> =>
			values.includes(item[key])
	)
}

/** Wraps a single value in an array; `null`/`undefined` become `[]`. Arrays are copied. */
export function toArray<T>(value: T | readonly T[] | null | undefined): T[] {
	if (value == null) return []
	if (Array.isArray(value)) return [...(value as readonly T[])]
	return [value as T]
}

type NumericKey<T> = {
	[K in keyof T]: T[K] extends number | null | undefined ? K : never
}[keyof T]

/** Sums a numeric property or callback result; nullish values count as 0. */
export function sumBy<T>(
	array: readonly T[],
	fn: (item: T) => number | null | undefined
): number
export function sumBy<T>(array: readonly T[], key: NumericKey<T>): number
export function sumBy<T>(
	array: readonly T[],
	keyOrFn: NumericKey<T> | ((item: T) => number | null | undefined)
): number {
	let sum = 0
	for (const item of array) {
		const value =
			typeof keyOrFn === 'function'
				? keyOrFn(item)
				: (item[keyOrFn] as number | null | undefined)
		sum += value ?? 0
	}
	return sum
}

type SortSelector<T> = keyof T | ((item: T) => unknown)
export type SortCriterion<T> =
	| SortSelector<T>
	| { by: SortSelector<T>; order: 'asc' | 'desc' }

/**
 * Returns a sorted copy. Each criterion is a key, a callback, or
 * `{ by, order }`; later criteria break ties. The sort is stable, and
 * `null`/`undefined` values always go last. Without criteria the items
 * themselves are compared.
 */
export function sortBy<T>(
	array: readonly T[],
	...criteria: SortCriterion<T>[]
): T[] {
	const comparators = (criteria.length ? criteria : [(item: T) => item]).map(
		(criterion) => {
			const { by, order } =
				typeof criterion === 'object'
					? criterion
					: { by: criterion, order: 'asc' as const }
			const select = (item: T) =>
				typeof by === 'function' ? by(item) : item[by as keyof T]
			const direction = order === 'desc' ? -1 : 1

			return (left: T, right: T) => {
				const a = select(left) as number
				const b = select(right) as number
				if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1
				return a < b ? -direction : a > b ? direction : 0
			}
		}
	)

	return [...array].sort((left, right) => {
		for (const compare of comparators) {
			const result = compare(left, right)
			if (result !== 0) return result
		}
		return 0
	})
}

/**
 * Numbers from `start` up to (not including) `end`. With one argument it
 * counts from 0. `step` defaults to 1, or -1 when `end < start`.
 */
export function range(start: number, end?: number, step?: number): number[] {
	const from = end === undefined ? 0 : start
	const to = end ?? start
	const increment = step ?? (to < from ? -1 : 1)
	if (increment === 0) throw new Error('Step must not be zero')

	const length = Math.max(Math.ceil((to - from) / increment), 0)
	return Array.from({ length }, (_, index) => from + index * increment)
}
