export interface ArrayDifference<TCurrent, TNext> {
	new: TNext[]
	upsert: TNext[]
	delete: TCurrent[]
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

export function findArrayDifferenceByKey<
	TCurrent,
	TNext,
	TKey extends keyof TCurrent & keyof TNext
>(
	current: readonly TCurrent[],
	next: readonly TNext[],
	key: TKey
): ArrayDifference<TCurrent, TNext> {
	const currentByKey = new Map(
		current.map((item) => [String(item[key]), item] as const)
	)
	const itemsToDelete = [...current]
	const newItems: TNext[] = []
	const upsertItems: TNext[] = []

	for (const item of next) {
		const keyValue = String(item[key])

		if (!currentByKey.has(keyValue)) {
			newItems.push(item)
			continue
		}

		upsertItems.push(item)
		const deleteIndex = itemsToDelete.findIndex(
			(currentItem) => String(currentItem[key]) === keyValue
		)
		if (deleteIndex >= 0) {
			itemsToDelete.splice(deleteIndex, 1)
		}
	}

	return {
		new: newItems,
		upsert: upsertItems,
		delete: itemsToDelete
	}
}

export function getUniqueValues<T>(array: readonly T[]): T[] {
	const seen = new Map<string, T>()

	for (const element of array) {
		const key = JSON.stringify(element)
		if (!seen.has(key)) {
			seen.set(key, element)
		}
	}

	return Array.from(seen.values())
}

export function compact<T>(array: readonly T[]): NonNullableValue<T>[] {
	return array.filter((item): item is NonNullableValue<T> => item != null)
}

export function getUniqueValuesByKey<T, TKey extends keyof T>(
	array: readonly T[],
	key: TKey
): T[] {
	const seen = new Set<T[TKey]>()
	const result: T[] = []

	for (const item of array) {
		const value = item[key]
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
>(array: readonly T[], key: TKey): Record<TGroupKey, T[]>
export function groupBy<T, TGroupKey extends PropertyKeyValue>(
	array: readonly T[],
	keyFn: (item: T) => TGroupKey
): Record<TGroupKey, T[]>
export function groupBy<T, TGroupKey extends PropertyKeyValue>(
	array: readonly T[],
	keyOrFn: keyof T | ((item: T) => TGroupKey)
): Record<TGroupKey, T[]> {
	return array.reduce(
		(result, item) => {
			const groupKey =
				typeof keyOrFn === 'function'
					? keyOrFn(item)
					: (item[keyOrFn] as TGroupKey)

			result[groupKey] ??= []
			result[groupKey].push(item)
			return result
		},
		{} as Record<TGroupKey, T[]>
	)
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
