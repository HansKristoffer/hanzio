import { expect, test } from 'bun:test'
import type {
	ElementOf,
	MaybePromise,
	NonEmptyArray,
	Nullable,
	Simplify,
	ValueOf
} from '.'

type Equal<A, B> =
	(<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2
		? true
		: false

test('type helpers resolve to the expected types', () => {
	const checks: [
		Equal<MaybePromise<number>, number | Promise<number>>,
		Equal<ValueOf<{ a: 1; b: 'x' }>, 1 | 'x'>,
		Equal<ElementOf<readonly ['a', 'b']>, 'a' | 'b'>,
		Equal<ElementOf<string[]>, string>,
		Equal<NonEmptyArray<number>, [number, ...number[]]>,
		Equal<Nullable<string>, string | null | undefined>,
		Equal<Simplify<{ a: 1 } & { b: 2 }>, { a: 1; b: 2 }>
	] = [true, true, true, true, true, true, true]
	expect(checks.every(Boolean)).toBe(true)

	// @ts-expect-error a non-empty array needs a first element
	const _empty: NonEmptyArray<number> = []
})
