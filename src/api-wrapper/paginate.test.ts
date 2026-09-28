import { describe, expect, test } from 'bun:test'
import { paginate } from '.'

const pages: Record<string, { items: number[]; next: string | null }> = {
	start: { items: [1, 2], next: 'b' },
	b: { items: [3], next: 'c' },
	c: { items: [4], next: null }
}

describe('paginate', () => {
	test('follows cursors until getNext returns null', async () => {
		const cursors: (string | undefined)[] = []
		const result = await Array.fromAsync(
			paginate(
				async (cursor: string | undefined) => {
					cursors.push(cursor)
					return pages[cursor ?? 'start']!
				},
				(page) => page.next
			)
		)
		expect(result.flatMap((page) => page.items)).toEqual([1, 2, 3, 4])
		expect(cursors).toEqual([undefined, 'b', 'c'])
	})

	test('stops after maxPages', async () => {
		let calls = 0
		const result = await Array.fromAsync(
			paginate(
				async (cursor: number | undefined) => {
					calls++
					return cursor ?? 0
				},
				(page) => page + 1,
				{ maxPages: 3 }
			)
		)
		expect(result).toEqual([0, 1, 2])
		expect(calls).toBe(3)
	})

	test('throws the abort reason before fetching the next page', async () => {
		const controller = new AbortController()
		let calls = 0
		const iterate = async () => {
			for await (const _ of paginate(
				async () => {
					calls++
					return calls
				},
				(page) => page,
				{ signal: controller.signal }
			)) {
				controller.abort(new Error('stop'))
			}
		}
		await expect(iterate()).rejects.toThrow('stop')
		expect(calls).toBe(1)
	})
})
