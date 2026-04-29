import { describe, expect, expectTypeOf, test } from 'bun:test'
import {
	typedSwitch,
	type StringSwitchCases,
	type PartialStringSwitchCases,
	type ObjectSwitchCases,
	type PartialObjectSwitchCases
} from '.'

// ═══════════════════════════════════════════════════════════════════════════
// Test helper types and values
// ═══════════════════════════════════════════════════════════════════════════

/** Identity function that preserves union types (prevents TypeScript narrowing) */
const asType = <T>(value: T): T => value

// Shorthand helpers for common test types
const getStatus = (v: 'success' | 'error') => asType(v)
const getTriStatus = (v: 'success' | 'error' | 'pending') => asType(v)

// Discriminated union types for object input tests
type ClickEvent = { type: 'click'; x: number; y: number }
type ScrollEvent = { type: 'scroll'; offset: number }
type KeyEvent = { type: 'key'; key: string }
type Event = ClickEvent | ScrollEvent | KeyEvent

const getEvent = (e: Event) => asType(e)

type PendingOrder = { status: 'pending'; createdAt: Date }
type CompletedOrder = { status: 'completed'; completedAt: Date }
type CancelledOrder = { status: 'cancelled'; reason: string }
type Order = PendingOrder | CompletedOrder | CancelledOrder

const getOrder = (o: Order) => asType(o)

// ═══════════════════════════════════════════════════════════════════════════
// Runtime tests
// ═══════════════════════════════════════════════════════════════════════════

describe('typedSwitch runtime behavior', () => {
	describe('string input mode', () => {
		test('handles all cases without default', async () => {
			const result = await typedSwitch(getStatus('success'), {
				success: () => 'handled success',
				error: () => 'handled error'
			})

			expect(result).toBe('handled success')
		})

		test('passes value to handler', async () => {
			const getAB = (v: 'a' | 'b'): 'a' | 'b' => v

			const result = await typedSwitch(getAB('a'), {
				a: (val) => `got ${val}`,
				b: (val) => `got ${val}`
			})

			expect(result).toBe('got a')
		})

		test('handles partial cases with default', async () => {
			const result = await typedSwitch(
				getTriStatus('pending'),
				{
					success: () => 'handled success'
				},
				(val) => `default: ${val}`
			)

			expect(result).toBe('default: pending')
		})

		test('prefers specific case over default', async () => {
			const result = await typedSwitch(
				getStatus('success'),
				{
					success: () => 'specific handler'
				},
				() => 'default handler'
			)

			expect(result).toBe('specific handler')
		})

		test('supports async handlers', async () => {
			const getAsyncSync = (v: 'async' | 'sync'): 'async' | 'sync' => v

			const result = await typedSwitch(getAsyncSync('async'), {
				async: async () => {
					await new Promise((r) => setTimeout(r, 10))
					return 'async result'
				},
				sync: () => 'sync result'
			})

			expect(result).toBe('async result')
		})

		test('throws on unhandled case without default', () => {
			// Force a value that doesn't match any case
			const status = 'unknown' as 'success' | 'error'

			expect(() =>
				typedSwitch(status, {
					success: () => 'ok',
					error: () => 'err'
				})
			).toThrow('Unhandled case: unknown')
		})

		test('includes available cases in unhandled error', () => {
			const status = 'unknown' as 'success' | 'error'

			expect(() =>
				typedSwitch(status, {
					success: () => 'ok',
					error: () => 'err'
				})
			).toThrow('Available cases: success, error')
		})

		test('handlers can return null/undefined', async () => {
			const resultNull = await typedSwitch(getStatus('success'), {
				success: () => null,
				error: () => undefined
			})
			expect(resultNull).toBe(null)

			const resultUndefined = await typedSwitch(getStatus('error'), {
				success: () => null,
				error: () => undefined
			})
			expect(resultUndefined).toBe(undefined)
		})

		test('handles empty string as case', async () => {
			const getValue = (v: '' | 'filled'): '' | 'filled' => v

			const result = await typedSwitch(getValue(''), {
				'': () => 'empty',
				filled: () => 'has value'
			})
			expect(result).toBe('empty')
		})
	})

	describe('object input mode', () => {
		test('handles discriminated union with type key', async () => {
			const result = await typedSwitch(
				getEvent({ type: 'click', x: 10, y: 20 }),
				'type',
				{
					click: (e) => `Clicked at ${e.x}, ${e.y}`,
					scroll: (e) => `Scrolled ${e.offset}px`,
					key: (e) => `Key pressed: ${e.key}`
				}
			)

			expect(result).toBe('Clicked at 10, 20')
		})

		test('narrows type in handler', async () => {
			const result = await typedSwitch(
				getEvent({ type: 'scroll', offset: 100 }),
				'type',
				{
					click: (e) => e.x + e.y, // e is typed as ClickEvent
					scroll: (e) => e.offset, // e is typed as ScrollEvent
					key: (e) => e.key.length // e is typed as KeyEvent
				}
			)

			expect(result).toBe(100)
		})

		test('works with custom discriminant key', async () => {
			const result = await typedSwitch(
				getOrder({ status: 'completed', completedAt: new Date() }),
				'status',
				{
					pending: () => 'waiting',
					completed: () => 'done',
					cancelled: () => 'cancelled'
				}
			)

			expect(result).toBe('done')
		})

		test('handles partial cases with default', async () => {
			const result = await typedSwitch(
				getEvent({ type: 'scroll', offset: 50 }),
				'type',
				{
					click: (e) => `clicked at ${e.x}`
				},
				(e) => `unhandled: ${e.type}`
			)

			expect(result).toBe('unhandled: scroll')
		})

		test('supports async handlers', async () => {
			const result = await typedSwitch(
				getEvent({ type: 'click', x: 5, y: 5 }),
				'type',
				{
					click: async (e) => {
						await new Promise((r) => setTimeout(r, 10))
						return e.x * e.y
					},
					scroll: () => 0,
					key: () => 0
				}
			)

			expect(result).toBe(25)
		})

		test('throws clear error when discriminant key is missing', () => {
			const invalidEvent = { x: 10, y: 20 } as unknown as Event

			expect(() =>
				typedSwitch(invalidEvent, 'type', {
					click: () => 'clicked',
					scroll: () => 'scrolled',
					key: () => 'keyed'
				})
			).toThrow(
				'Invalid discriminant value for key "type": expected string, received undefined'
			)
		})

		test('throws clear error when discriminant value is not a string', () => {
			const invalidEvent = { type: 123 } as unknown as Event

			expect(() =>
				typedSwitch(invalidEvent, 'type', {
					click: () => 'clicked',
					scroll: () => 'scrolled',
					key: () => 'keyed'
				})
			).toThrow(
				'Invalid discriminant value for key "type": expected string, received number'
			)
		})

		test('throws on unhandled object discriminant without default', () => {
			const invalidEvent = { type: 'hover' } as unknown as Event

			expect(() =>
				typedSwitch(invalidEvent, 'type', {
					click: () => 'clicked',
					scroll: () => 'scrolled',
					key: () => 'keyed'
				})
			).toThrow(
				'Unhandled case: hover (discriminant key: "type"). Available cases: click, scroll, key'
			)
		})

		test('throws clear error when object mode is called without a string discriminant key', () => {
			const event = getEvent({ type: 'click', x: 10, y: 20 })

			expect(() =>
				typedSwitch(event, { click: () => 'clicked' } as unknown as 'type', {
					click: () => 'clicked',
					scroll: () => 'scrolled',
					key: () => 'keyed'
				})
			).toThrow(
				'Invalid typedSwitch call: object mode requires a string discriminant key'
			)
		})
	})
})

// ═══════════════════════════════════════════════════════════════════════════
// Type tests - String input mode
// ═══════════════════════════════════════════════════════════════════════════

describe('typedSwitch string mode type inference', () => {
	test('return type is inferred from handler return types (uniform)', async () => {
		const result = await typedSwitch(getStatus('success'), {
			success: () => 'handled success',
			error: () => 'handled error'
		})

		// All handlers return string, so result should be string
		expectTypeOf(result).toEqualTypeOf<string>()
	})

	test('return type is union of different handler return types', async () => {
		const result = await typedSwitch(getStatus('success'), {
			success: () => 'string result',
			error: () => 42
		})

		// Handlers return string | number
		expectTypeOf(result).toEqualTypeOf<string | number>()
	})

	test('return type includes null and undefined from handlers', async () => {
		const result = await typedSwitch(getStatus('success'), {
			success: () => null,
			error: () => undefined
		})

		expectTypeOf(result).toEqualTypeOf<null | undefined>()
	})

	test('handler receives the specific string literal type', async () => {
		await typedSwitch(getStatus('success'), {
			success: (val) => {
				// val should be exactly 'success', not the full union
				expectTypeOf(val).toEqualTypeOf<'success'>()
				return val
			},
			error: (val) => {
				// val should be exactly 'error'
				expectTypeOf(val).toEqualTypeOf<'error'>()
				return val
			}
		})
	})

	test('with default: return type includes default handler return type', async () => {
		const result = await typedSwitch(
			getTriStatus('success'),
			{
				success: () => 'ok' as const
			},
			() => 'default' as const
		)

		// Result is union of handler return and default return
		expectTypeOf(result).toEqualTypeOf<'ok' | 'default'>()
	})

	test('with default: default handler receives full union type', async () => {
		await typedSwitch(
			getTriStatus('pending'),
			{
				success: () => 'ok'
			},
			(val) => {
				// Default handler receives the full union type
				expectTypeOf(val).toEqualTypeOf<'success' | 'error' | 'pending'>()
				return 'default'
			}
		)
	})

	test('async handlers preserve promise return type when awaited', async () => {
		const result = await typedSwitch(getStatus('success'), {
			success: async () => 'async string',
			error: () => 42
		})

		// Awaiting the raw return still produces the resolved union.
		expectTypeOf(result).toEqualTypeOf<string | number>()
	})

	test('mixed sync and async handlers have correct return type', async () => {
		const result = await typedSwitch(getStatus('success'), {
			success: async () => ({ async: true }),
			error: () => ({ sync: true })
		})

		expectTypeOf(result).toEqualTypeOf<{ async: boolean } | { sync: boolean }>()
	})
})

// ═══════════════════════════════════════════════════════════════════════════
// Type tests - Object input mode
// ═══════════════════════════════════════════════════════════════════════════

describe('typedSwitch object mode type inference', () => {
	test('handler receives narrowed discriminated union type', async () => {
		await typedSwitch(getEvent({ type: 'click', x: 10, y: 20 }), 'type', {
			click: (e) => {
				// e should be narrowed to ClickEvent
				expectTypeOf(e).toEqualTypeOf<ClickEvent>()
				expectTypeOf(e.x).toEqualTypeOf<number>()
				expectTypeOf(e.y).toEqualTypeOf<number>()
				return 'clicked'
			},
			scroll: (e) => {
				// e should be narrowed to ScrollEvent
				expectTypeOf(e).toEqualTypeOf<ScrollEvent>()
				expectTypeOf(e.offset).toEqualTypeOf<number>()
				return 'scrolled'
			},
			key: (e) => {
				// e should be narrowed to KeyEvent
				expectTypeOf(e).toEqualTypeOf<KeyEvent>()
				expectTypeOf(e.key).toEqualTypeOf<string>()
				return 'key'
			}
		})
	})

	test('return type is inferred from handler return types', async () => {
		const result = await typedSwitch(
			getEvent({ type: 'click', x: 10, y: 20 }),
			'type',
			{
				click: (e) => e.x + e.y,
				scroll: (e) => e.offset,
				key: () => 0
			}
		)

		expectTypeOf(result).toEqualTypeOf<number>()
	})

	test('return type is union of different handler return types', async () => {
		const result = await typedSwitch(
			getEvent({ type: 'click', x: 10, y: 20 }),
			'type',
			{
				click: (e) => ({ x: e.x, y: e.y }),
				scroll: (e) => e.offset,
				key: (e) => e.key
			}
		)

		expectTypeOf(result).toEqualTypeOf<
			{ x: number; y: number } | number | string
		>()
	})

	test('works with custom discriminant key (status)', async () => {
		const result = await typedSwitch(
			getOrder({ status: 'completed', completedAt: new Date() }),
			'status',
			{
				pending: (o) => {
					// o should be narrowed to PendingOrder
					expectTypeOf(o).toEqualTypeOf<PendingOrder>()
					return o.createdAt
				},
				completed: (o) => {
					// o should be narrowed to CompletedOrder
					expectTypeOf(o).toEqualTypeOf<CompletedOrder>()
					return o.completedAt
				},
				cancelled: (o) => {
					// o should be narrowed to CancelledOrder
					expectTypeOf(o).toEqualTypeOf<CancelledOrder>()
					return o.reason
				}
			}
		)

		expectTypeOf(result).toEqualTypeOf<Date | string>()
	})

	test('with default: return type includes default handler return type', async () => {
		const result = await typedSwitch(
			getEvent({ type: 'scroll', offset: 50 }),
			'type',
			{
				click: () => 'clicked' as const
			},
			() => 'unhandled' as const
		)

		expectTypeOf(result).toEqualTypeOf<'clicked' | 'unhandled'>()
	})

	test('with default: default handler receives full union type', async () => {
		await typedSwitch(
			getEvent({ type: 'scroll', offset: 50 }),
			'type',
			{
				click: () => 'handled'
			},
			(e) => {
				// Default handler receives the full Event union
				expectTypeOf(e).toEqualTypeOf<Event>()
				return 'default'
			}
		)
	})

	test('async handlers are properly unwrapped in return type', async () => {
		const result = await typedSwitch(
			getEvent({ type: 'click', x: 10, y: 20 }),
			'type',
			{
				click: async (e) => ({ coords: { x: e.x, y: e.y } }),
				scroll: async (e) => ({ scrollOffset: e.offset }),
				key: async (e) => ({ keyPressed: e.key })
			}
		)

		expectTypeOf(result).toEqualTypeOf<
			| { coords: { x: number; y: number } }
			| { scrollOffset: number }
			| { keyPressed: string }
		>()
	})
})

// ═══════════════════════════════════════════════════════════════════════════
// Type tests - Case exhaustiveness
// ═══════════════════════════════════════════════════════════════════════════

describe('typedSwitch exhaustiveness type checking', () => {
	test('string mode: all cases required when no default provided', () => {
		type Status = 'a' | 'b' | 'c'
		type Cases = StringSwitchCases<Status, string>

		// Cases type should require all keys
		expectTypeOf<Cases>().toEqualTypeOf<{
			a: (value: 'a') => string | Promise<string>
			b: (value: 'b') => string | Promise<string>
			c: (value: 'c') => string | Promise<string>
		}>()
	})

	test('string mode: partial cases allowed with default', () => {
		type Status = 'a' | 'b' | 'c'
		type Cases = PartialStringSwitchCases<Status, string>

		// Cases type should have optional keys
		expectTypeOf<Cases>().toEqualTypeOf<{
			a?: (value: 'a') => string | Promise<string>
			b?: (value: 'b') => string | Promise<string>
			c?: (value: 'c') => string | Promise<string>
		}>()
	})

	test('object mode: all discriminant values required when no default', () => {
		type Cases = ObjectSwitchCases<Event, 'type', string>

		// Cases type should require all discriminant values
		expectTypeOf<Cases>().toEqualTypeOf<{
			click: (value: ClickEvent) => string | Promise<string>
			scroll: (value: ScrollEvent) => string | Promise<string>
			key: (value: KeyEvent) => string | Promise<string>
		}>()
	})

	test('object mode: partial cases allowed with default', () => {
		type Cases = PartialObjectSwitchCases<Event, 'type', string>

		// Cases type should have optional keys
		expectTypeOf<Cases>().toEqualTypeOf<{
			click?: (value: ClickEvent) => string | Promise<string>
			scroll?: (value: ScrollEvent) => string | Promise<string>
			key?: (value: KeyEvent) => string | Promise<string>
		}>()
	})
})

describe('typedSwitch negative type checking', () => {
	test('rejects missing string cases without default', () => {
		const assertTypeErrors = () => {
			// @ts-expect-error missing the "pending" case without a default handler
			typedSwitch(getTriStatus('success'), {
				success: () => 'ok',
				error: () => 'error'
			})
		}

		expect(assertTypeErrors).toBeDefined()
	})

	test('rejects missing object cases without default', () => {
		const assertTypeErrors = () => {
			// @ts-expect-error missing the "key" case without a default handler
			typedSwitch(getEvent({ type: 'click', x: 10, y: 20 }), 'type', {
				click: () => 'clicked',
				scroll: () => 'scrolled'
			})
		}

		expect(assertTypeErrors).toBeDefined()
	})

	test('rejects invalid object discriminant keys', () => {
		const assertTypeErrors = () => {
			// @ts-expect-error "kind" is not a key of Event
			typedSwitch(getEvent({ type: 'click', x: 10, y: 20 }), 'kind', {
				click: () => 'clicked',
				scroll: () => 'scrolled',
				key: () => 'keyed'
			})
		}

		expect(assertTypeErrors).toBeDefined()
	})

	test('rejects non-string object discriminant values', () => {
		type NumericEvent = { type: 1; value: string } | { type: 2; value: number }

		const assertTypeErrors = () => {
			// @ts-expect-error object mode only supports string-valued discriminants
			const cases: ObjectSwitchCases<NumericEvent, 'type', string> = {
				1: () => 'one',
				2: () => 'two'
			}

			expect(cases).toBeDefined()
		}

		expect(assertTypeErrors).toBeDefined()
	})

	test('direct constraint rejects handlers that do not satisfy the constraint', () => {
		const assertTypeErrors = () => {
			typedSwitch<number>(getStatus('success'), {
				success: () => 1,
				// @ts-expect-error error handler must return number or Promise<number>
				error: () => 'not a number'
			})
		}

		expect(assertTypeErrors).toBeDefined()
	})
})

// ═══════════════════════════════════════════════════════════════════════════
// Type tests - Edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('typedSwitch edge case types', () => {
	test('empty string is valid case key', async () => {
		type EmptyOrFilled = '' | 'filled'

		const result = await typedSwitch('' as EmptyOrFilled, {
			'': () => 'was empty' as const,
			filled: () => 'was filled' as const
		})

		expectTypeOf(result).toEqualTypeOf<'was empty' | 'was filled'>()
	})

	test('single case union still works', async () => {
		// Even with a single-value union, types should work
		type SingleStatus = 'only'
		const status: SingleStatus = 'only'

		const result = await typedSwitch(status, {
			only: () => 'handled only' as const
		})

		expectTypeOf(result).toEqualTypeOf<'handled only'>()
	})

	test('handler returning void is typed correctly', async () => {
		const result = await typedSwitch(getStatus('success'), {
			success: () => {
				// implicit void return
			},
			error: () => undefined
		})

		expectTypeOf(result).toEqualTypeOf<void | undefined>()
	})

	test('complex object return types are preserved', async () => {
		interface User {
			id: string
			name: string
			roles: string[]
		}

		interface Error {
			code: number
			message: string
		}

		const result = await typedSwitch(getStatus('success'), {
			success: (): User => ({ id: '1', name: 'John', roles: ['admin'] }),
			error: (): Error => ({ code: 500, message: 'Failed' })
		})

		expectTypeOf(result).toEqualTypeOf<User | Error>()
	})

	test('generic function handlers work correctly', async () => {
		const makeResult = <T>(value: T) => ({ wrapped: value })

		const result = await typedSwitch(getStatus('success'), {
			success: () => makeResult('success value'),
			error: () => makeResult(42)
		})

		expectTypeOf(result).toEqualTypeOf<
			{ wrapped: string } | { wrapped: number }
		>()
	})
})

// ═══════════════════════════════════════════════════════════════════════════
// Type tests - Sync vs Async return types
// ═══════════════════════════════════════════════════════════════════════════

describe('typedSwitch sync/async return type inference', () => {
	test('sync handlers return non-Promise type', () => {
		const result = typedSwitch(getStatus('success'), {
			success: () => 'ok',
			error: () => 'err'
		})

		// Result should NOT be a Promise when all handlers are sync
		expectTypeOf(result).toEqualTypeOf<string>()
		expectTypeOf(result).not.toMatchTypeOf<Promise<unknown>>()
	})

	test('async handlers return Promise type', async () => {
		const result = typedSwitch(getStatus('success'), {
			success: async () => 'ok',
			error: async () => 'err'
		})

		// Result should be Promise when handlers are async
		expectTypeOf(result).toEqualTypeOf<Promise<string>>()

		// Value should still work correctly
		expect(await result).toBe('ok')
	})

	test('mixed sync/async handlers preserve raw selected return type', async () => {
		const result = typedSwitch(getStatus('success'), {
			success: () => 'sync',
			error: async () => 'async'
		})

		// The runtime returns the selected handler's raw value.
		expectTypeOf(result).toEqualTypeOf<string | Promise<string>>()
		expect(result).toBe('sync')
	})

	test('object mode: sync handlers return non-Promise type', () => {
		const result = typedSwitch(
			getEvent({ type: 'click', x: 10, y: 20 }),
			'type',
			{
				click: (e) => e.x + e.y,
				scroll: (e) => e.offset,
				key: (e) => e.key.length
			}
		)

		// Result should NOT be a Promise when all handlers are sync
		expectTypeOf(result).toEqualTypeOf<number>()
		expectTypeOf(result).not.toMatchTypeOf<Promise<unknown>>()
	})

	test('can use sync result without await', () => {
		const result = typedSwitch(getStatus('success'), {
			success: () => 42,
			error: () => 0
		})

		// Can use result directly as a number (no await needed)
		const doubled: number = result * 2
		expect(doubled).toBe(84)
	})
})

// ═══════════════════════════════════════════════════════════════════════════
// Type tests - Generic constraint mode
// ═══════════════════════════════════════════════════════════════════════════

describe('typedSwitch return constraint mode', () => {
	interface HasId {
		id: string
	}

	interface UserResult extends HasId {
		id: string
		name: string
	}

	interface ErrorResult extends HasId {
		id: string
		code: number
	}

	test('constraint: handlers must return type extending constraint', () => {
		const result = typedSwitch<HasId>(getStatus('success'), {
			success: () => ({ id: '123', name: 'John' }) as UserResult,
			error: () => ({ id: '456', code: 500 }) as ErrorResult
		})

		expectTypeOf(result).toEqualTypeOf<HasId>()
	})

	test('constraint: works with primitive return constraints', () => {
		const result = typedSwitch<number>(getStatus('success'), {
			success: () => 1,
			error: () => 0
		})

		expectTypeOf(result).toEqualTypeOf<number>()
		expect(result).toBe(1)
	})

	test('constraint: works with object mode', () => {
		const result = typedSwitch<HasId>(
			getEvent({ type: 'click', x: 10, y: 20 }),
			'type',
			{
				click: () => ({ id: 'click-1', coords: { x: 10, y: 20 } }),
				scroll: () => ({ id: 'scroll-1', offset: 100 }),
				key: () => ({ id: 'key-1', pressed: 'Enter' })
			}
		)

		expectTypeOf(result).toEqualTypeOf<HasId>()
	})

	test('constraint: works with async handlers', async () => {
		const result = typedSwitch<HasId>(getStatus('success'), {
			success: async () => ({ id: '1', name: 'John' }),
			error: async () => ({ id: '2', code: 500 })
		})

		expectTypeOf(result).toEqualTypeOf<HasId | Promise<HasId>>()

		const value = await result
		expect(value).toMatchObject({ id: '1' })
	})

	test('constraint: with default enforces constraint and preserves inferred union', async () => {
		const result = await typedSwitch<HasId>(
			getTriStatus('pending'),
			{
				success: () => ({ id: 'success-1', kind: 'success' as const })
			},
			(status) => ({ id: `default-${status}`, kind: 'default' as const })
		)

		expectTypeOf(result).toEqualTypeOf<HasId>()
		expect(result).toMatchObject({ id: 'default-pending' })
	})

	test('constraint: runtime behavior works correctly', () => {
		const result = typedSwitch<HasId>(getStatus('success'), {
			success: () => ({ id: 'success-id', value: 42 }),
			error: () => ({ id: 'error-id', message: 'failed' })
		})

		expect(result).toMatchObject({ id: 'success-id' })
	})

	test('without constraint: handlers can return anything', () => {
		// Without constraint, this should work fine
		const result = typedSwitch(getStatus('success'), {
			success: () => 'a string',
			error: () => 42
		})

		expectTypeOf(result).toEqualTypeOf<string | number>()
	})
})
