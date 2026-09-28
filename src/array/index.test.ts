import { describe, expect, test } from 'bun:test'
import {
	chunkArray,
	compact,
	countBy,
	findArrayDifferenceByKey,
	getUniqueValues,
	getUniqueValuesByKey,
	groupBy,
	keyBy,
	partition,
	pickItemsInArray,
	range,
	sortBy,
	sumBy,
	toArray
} from '.'

describe('array utilities', () => {
	test('chunkArray splits arrays into fixed-size chunks', () => {
		expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
		expect(chunkArray([1, 2], 5)).toEqual([[1, 2]])
		expect(chunkArray([], 2)).toEqual([])
	})

	test('chunkArray rejects non-positive and non-integer sizes', () => {
		expect(() => chunkArray([1], 0)).toThrow('positive integer')
		expect(() => chunkArray([1], 1.5)).toThrow('positive integer')
	})

	test('findArrayDifferenceByKey groups new, upsert, and delete items', () => {
		const current = [
			{ id: 1, name: 'one' },
			{ id: 2, name: 'two' }
		]
		const next = [
			{ id: 2, name: 'updated two' },
			{ id: 3, name: 'three' }
		]

		expect(findArrayDifferenceByKey(current, next, 'id')).toEqual({
			new: [{ id: 3, name: 'three' }],
			upsert: [{ id: 2, name: 'updated two' }],
			delete: [{ id: 1, name: 'one' }]
		})
	})

	test('findArrayDifferenceByKey accepts a key function', () => {
		const current = [{ id: 1 }, { id: 2 }]
		const next = [{ userId: 2 }, { userId: 3 }]

		expect(
			findArrayDifferenceByKey(current, next, (item) =>
				'id' in item ? item.id : item.userId
			)
		).toEqual({
			new: [{ userId: 3 }],
			upsert: [{ userId: 2 }],
			delete: [{ id: 1 }]
		})
	})

	test('findArrayDifferenceByKey splits upsert with isEqual', () => {
		const current = [
			{ id: 1, name: 'one' },
			{ id: 2, name: 'two' }
		]
		const next = [
			{ id: 1, name: 'one' },
			{ id: 2, name: 'changed' }
		]

		const difference = findArrayDifferenceByKey(current, next, 'id', {
			isEqual: (a, b) => a.name === b.name
		})
		const update: { id: number; name: string }[] = difference.update

		expect(update).toEqual([{ id: 2, name: 'changed' }])
		expect(difference.unchanged).toEqual([{ id: 1, name: 'one' }])
		expect(difference.upsert).toEqual(next)
		expect(difference.delete).toEqual([])
	})

	test('findArrayDifferenceByKey keeps every current item that matches a key', () => {
		expect(
			findArrayDifferenceByKey([{ id: 1 }, { id: 1 }], [{ id: 1 }], 'id').delete
		).toEqual([])
	})

	test('getUniqueValues keeps first unique serialized value', () => {
		expect(getUniqueValues([1, 1, 2, 3, 2])).toEqual([1, 2, 3])
		expect(getUniqueValues([{ id: 1 }, { id: 1 }, { id: 2 }])).toEqual([
			{ id: 1 },
			{ id: 2 }
		])
		expect(
			getUniqueValues([
				{ a: 1, b: 2 },
				{ b: 2, a: 1 }
			])
		).toEqual([{ a: 1, b: 2 }])
	})

	test('getUniqueValuesByKey keeps first item for each key value', () => {
		const items = [
			{ id: 'a', value: 1 },
			{ id: 'a', value: 2 },
			{ id: 'b', value: 3 }
		]

		expect(getUniqueValuesByKey(items, 'id')).toEqual([
			{ id: 'a', value: 1 },
			{ id: 'b', value: 3 }
		])
		expect(getUniqueValuesByKey(items, (item) => item.value % 2)).toEqual([
			{ id: 'a', value: 1 },
			{ id: 'a', value: 2 }
		])
	})

	test('compact removes null and undefined values', () => {
		expect(compact([1, null, 2, undefined, 3])).toEqual([1, 2, 3])

		const values = compact(['a', null] as const)
		const typedValues: 'a'[] = values
		expect(typedValues).toEqual(['a'])
	})

	test('groupBy groups by property or callback', () => {
		const items = [
			{ type: 'fruit', name: 'apple', quantity: 1 },
			{ type: 'fruit', name: 'pear', quantity: 2 },
			{ type: 'veg', name: 'carrot', quantity: 3 }
		]

		expect(groupBy(items, 'type')).toEqual({
			fruit: [items[0]!, items[1]!],
			veg: [items[2]!]
		})
		expect(groupBy(items, (item) => item.quantity % 2)).toEqual({
			1: [items[0]!, items[2]!],
			0: [items[1]!]
		})
	})

	test('keyBy indexes items by property or callback', () => {
		const items = [
			{ id: 'a', value: 1 },
			{ id: 'b', value: 2 }
		] as const

		expect(keyBy(items, 'id')).toEqual({
			a: items[0],
			b: items[1]
		})
		expect(keyBy(items, (item) => item.value)).toEqual({
			1: items[0],
			2: items[1]
		})
	})

	test('partition splits items by predicate', () => {
		expect(partition([1, 2, 3, 4], (item) => item % 2 === 0)).toEqual([
			[2, 4],
			[1, 3]
		])
	})

	test('pickItemsInArray filters items by key values', () => {
		const items = [
			{ id: 1, name: 'one' },
			{ id: 2, name: 'two' },
			{ id: 3, name: 'three' }
		]

		expect(pickItemsInArray(items, 'id', [1, 3])).toEqual([
			items[0]!,
			items[2]!
		])
	})

	test('pickItemsInArray narrows discriminated unions by selected values', () => {
		type Item =
			| { type: 'user'; name: string }
			| { type: 'team'; members: number }
			| { type: 'org'; slug: string }

		const items: Item[] = [
			{ type: 'user', name: 'Ada' },
			{ type: 'team', members: 2 },
			{ type: 'org', slug: 'acme' }
		]

		const picked = pickItemsInArray(items, 'type', ['user', 'org'] as const)
		const narrowed: Array<
			{ type: 'user'; name: string } | { type: 'org'; slug: string }
		> = picked

		// @ts-expect-error `team` was excluded by the selected discriminants.
		const _teamOnly: Array<{ type: 'team'; members: number }> = picked

		expect(narrowed).toEqual([
			{ type: 'user', name: 'Ada' },
			{ type: 'org', slug: 'acme' }
		])
	})

	test('groupBy results are partial records', () => {
		const groups = groupBy([{ type: 'a' as 'a' | 'b' }], 'type')
		const missing: { type: 'a' | 'b' }[] | undefined = groups.b
		expect(missing).toBeUndefined()
	})

	test('countBy counts by property or callback', () => {
		const items = [{ type: 'a' }, { type: 'b' }, { type: 'a' }]
		expect(countBy(items, 'type')).toEqual({ a: 2, b: 1 })
		expect(countBy([1, 2, 3], (value) => (value % 2 ? 'odd' : 'even'))).toEqual(
			{ odd: 2, even: 1 }
		)
	})

	test('toArray normalizes single values and nullish input', () => {
		const source = [1, 2]
		expect(toArray(source)).toEqual([1, 2])
		expect(toArray(source)).not.toBe(source)
		expect(toArray(1)).toEqual([1])
		expect(toArray(null)).toEqual([])
		expect(toArray(undefined)).toEqual([])
	})

	test('sumBy sums a property or callback', () => {
		const items = [{ amount: 2 }, { amount: 3 }, { amount: undefined }]
		expect(sumBy(items, 'amount')).toBe(5)
		expect(sumBy([1, 2, 3], (value) => value * 2)).toBe(12)
		expect(sumBy([], (value: number) => value)).toBe(0)
	})

	test('sortBy sorts by multiple criteria without mutating', () => {
		const items = [
			{ name: 'b', age: 30 },
			{ name: 'a', age: null },
			{ name: 'c', age: 20 },
			{ name: 'a', age: 30 }
		]
		const original = [...items]

		expect(sortBy(items, 'age').map((item) => item.name)).toEqual([
			'c',
			'b',
			'a',
			'a'
		])
		expect(
			sortBy(items, { by: 'age', order: 'desc' }, (item) => item.name)
		).toEqual([items[3]!, items[0]!, items[2]!, items[1]!])
		expect(items).toEqual(original)
		expect(sortBy([3, 1, 2])).toEqual([1, 2, 3])
	})

	test('sortBy is stable', () => {
		const items = [
			{ group: 1, id: 'a' },
			{ group: 0, id: 'b' },
			{ group: 1, id: 'c' },
			{ group: 0, id: 'd' }
		]
		expect(sortBy(items, 'group').map((item) => item.id)).toEqual([
			'b',
			'd',
			'a',
			'c'
		])
	})

	test('range builds number sequences', () => {
		expect(range(4)).toEqual([0, 1, 2, 3])
		expect(range(1, 4)).toEqual([1, 2, 3])
		expect(range(0, 10, 3)).toEqual([0, 3, 6, 9])
		expect(range(3, 0)).toEqual([3, 2, 1])
		expect(range(0, 3, -1)).toEqual([])
		expect(() => range(0, 3, 0)).toThrow('zero')
	})
})
