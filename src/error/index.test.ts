import { describe, expect, test } from 'bun:test'
import { InvariantError, getErrorMessage, invariant, must, toError } from '.'

describe('getErrorMessage', () => {
	test('reads messages from errors, strings and message-shaped objects', () => {
		expect(getErrorMessage(new Error('boom'))).toBe('boom')
		expect(getErrorMessage('plain')).toBe('plain')
		expect(getErrorMessage({ message: 'shaped' })).toBe('shaped')
		expect(getErrorMessage({ message: 42 })).toBe('[object Object]')
		expect(getErrorMessage(404)).toBe('404')
		expect(getErrorMessage(null)).toBe('null')
	})

	test('uses the fallback for empty messages and unstringifiable values', () => {
		expect(getErrorMessage(new Error(''), 'Unknown')).toBe('Unknown')
		expect(getErrorMessage('', 'Unknown')).toBe('Unknown')
		expect(getErrorMessage(Object.create(null), 'Unknown')).toBe('Unknown')
		expect(getErrorMessage('')).toBe('')
	})
})

describe('toError', () => {
	test('returns errors unchanged', () => {
		const error = new TypeError('bad')
		expect(toError(error)).toBe(error)
	})

	test('wraps non-errors with cause', () => {
		const wrapped = toError({ message: 'shaped' })
		expect(wrapped).toBeInstanceOf(Error)
		expect(wrapped.message).toBe('shaped')
		expect(wrapped.cause).toEqual({ message: 'shaped' })
	})

	test('prefixes messages and keeps the original as cause', () => {
		const error = new Error('boom')
		const wrapped = toError(error, 'Sync failed')
		expect(wrapped).not.toBe(error)
		expect(wrapped.message).toBe('Sync failed: boom')
		expect(wrapped.cause).toBe(error)
		expect(toError('raw', 'Load').message).toBe('Load: raw')
	})
})

describe('must', () => {
	test('returns defined values including falsy ones', () => {
		expect(must(0)).toBe(0)
		expect(must('')).toBe('')
		expect(must(false)).toBe(false)
	})

	test('throws InvariantError with default or custom message', () => {
		expect(() => must(null)).toThrow(
			new InvariantError('Expected value to be defined')
		)
		expect(() => must(undefined, 'User not found')).toThrow('User not found')
		try {
			must(undefined)
		} catch (error) {
			expect(error).toBeInstanceOf(InvariantError)
			expect((error as Error).name).toBe('InvariantError')
		}
	})

	test('throws the error returned by a factory', () => {
		class NotFound extends Error {}
		expect(() => must(null, () => new NotFound('missing'))).toThrow(NotFound)
	})

	test('narrows to NonNullable', () => {
		const value = [1, 2].find((item) => item === 2)
		const _number: number = must(value)
		// @ts-expect-error without must the value may be undefined
		const _unsafe: number = value
		expect(_number).toBe(2)
	})
})

describe('invariant', () => {
	test('passes truthy conditions and throws on falsy ones', () => {
		expect(() => invariant(1)).not.toThrow()
		expect(() => invariant(0)).toThrow(new InvariantError('Invariant failed'))
		expect(() => invariant('', 'Empty name')).toThrow('Empty name')
		class Custom extends Error {}
		expect(() => invariant(false, () => new Custom())).toThrow(Custom)
	})

	test('asserts the condition', () => {
		const value = 'a' as string | null
		invariant(value)
		const _string: string = value
		expect(_string).toBe('a')
	})
})
