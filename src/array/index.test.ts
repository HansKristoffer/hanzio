import { describe, expect, test } from 'bun:test'
import {
	chunkArray,
	compact,
	findArrayDifferenceByKey,
	getUniqueValues,
	getUniqueValuesByKey,
	groupBy,
	keyBy,
	partition,
	pickItemsInArray
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

	test('getUniqueValues keeps first unique serialized value', () => {
		expect(getUniqueValues([1, 1, 2, 3, 2])).toEqual([1, 2, 3])
		expect(getUniqueValues([{ id: 1 }, { id: 1 }, { id: 2 }])).toEqual([
			{ id: 1 },
			{ id: 2 }
		])
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
})
