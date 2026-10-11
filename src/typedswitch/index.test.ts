import { describe, expect, expectTypeOf, test } from 'bun:test'
import {
	assertNever,
	typedSwitch,
	typedSwitchGroup,
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

		test('does not treat inherited Object.prototype keys as cases', () => {
			const status = 'toString' as 'success' | 'error'

			expect(() =>
				typedSwitch(status, {
					success: () => 'ok',
					error: () => 'err'
				})
			).toThrow('Unhandled case: toString')

			const protoStatus = '__proto__' as 'success' | 'error'

			expect(() =>
				typedSwitch(protoStatus, {
					success: () => 'ok',
					error: () => 'err'
				})
			).toThrow('Unhandled case: __proto__')
		})

		test('inherited Object.prototype keys fall through to default', async () => {
			const status = 'hasOwnProperty' as 'success' | 'error'

			const result = await typedSwitch(
				status,
				{
					success: () => 'ok'
				},
				(val) => `default: ${val}`
			)

			expect(result).toBe('default: hasOwnProperty')
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
				'Invalid discriminant value for key "type": expected string, number or boolean, received undefined'
			)
		})

		test('throws clear error when discriminant value is not a primitive', () => {
			const invalidEvent = { type: {} } as unknown as Event

			expect(() =>
				typedSwitch(invalidEvent, 'type', {
					click: () => 'clicked',
					scroll: () => 'scrolled',
					key: () => 'keyed'
				})
			).toThrow(
				'Invalid discriminant value for key "type": expected string, number or boolean, received object'
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

		test('works with unions of interface declarations', async () => {
			interface Circle {
				kind: 'circle'
				radius: number
			}
			interface Square {
				kind: 'square'
				size: number
			}
			type Shape = Circle | Square

			const shape = asType<Shape>({ kind: 'circle', radius: 2 })

			const result = await typedSwitch(shape, 'kind', {
				circle: (s) => {
					expectTypeOf(s).toEqualTypeOf<Circle>()
					return s.radius * 2
				},
				square: (s) => {
					expectTypeOf(s).toEqualTypeOf<Square>()
					return s.size
				}
			})

			expect(result).toBe(4)
			expectTypeOf(result).toEqualTypeOf<number>()
		})

		test('supports number discriminants', () => {
			type Response =
				| { code: 200; body: string }
				| { code: 404; path: string }
				| { code: 500; error: Error }
			const res = asType<Response>({ code: 404, path: '/x' })

			const result = typedSwitch(res, 'code', {
				200: (r) => {
					expectTypeOf(r).toEqualTypeOf<{ code: 200; body: string }>()
					return r.body
				},
				404: (r) => {
					expectTypeOf(r).toEqualTypeOf<{ code: 404; path: string }>()
					return `missing ${r.path}`
				},
				500: (r) => r.error.message
			})

			expect(result).toBe('missing /x')
			expectTypeOf(result).toEqualTypeOf<string>()
		})

		test('supports boolean discriminants', () => {
			type Result = { ok: true; value: number } | { ok: false; error: string }
			const handle = (r: Result) =>
				typedSwitch(r, 'ok', {
					true: (s) => {
						expectTypeOf(s).toEqualTypeOf<{ ok: true; value: number }>()
						return s.value
					},
					false: (f) => {
						expectTypeOf(f).toEqualTypeOf<{ ok: false; error: string }>()
						return f.error
					}
				})

			expect(handle({ ok: true, value: 1 })).toBe(1)
			expect(handle({ ok: false, error: 'bad' })).toBe('bad')
		})

		test('number discriminant default receives only unhandled members', () => {
			type Response =
				| { code: 200; body: string }
				| { code: 404 }
				| { code: 500 }
			const res = asType<Response>({ code: 500 })

			const result = typedSwitch(res, 'code', { 200: (r) => r.body }, (r) => {
				expectTypeOf(r).toEqualTypeOf<{ code: 404 } | { code: 500 }>()
				return r.code
			})

			expect(result).toBe(500)
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

	test('with default: default handler receives only unhandled cases', async () => {
		await typedSwitch(
			getTriStatus('pending'),
			{
				success: () => 'ok'
			},
			(val) => {
				// Default handler receives only the cases not covered above
				expectTypeOf(val).toEqualTypeOf<'error' | 'pending'>()
				return 'default'
			}
		)
	})

	test('with default: optional and undefined handlers remain unhandled', () => {
		const cases: {
			success?: (value: 'success') => string
			error: ((value: 'error') => string) | undefined
			pending: (value: 'pending') => string
		} = { error: undefined, pending: () => 'waiting' }

		for (const status of ['success', 'error'] as const) {
			const result = typedSwitch(getTriStatus(status), cases, (value) => {
				expectTypeOf(value).toEqualTypeOf<'success' | 'error'>()
				return `default: ${value}`
			})
			expect(result).toBe(`default: ${status}`)
		}
	})

	test('with default: reusable partial maps preserve the full union', () => {
		const cases: PartialStringSwitchCases<'success' | 'error', string> = {}
		const result = typedSwitch(getStatus('success'), cases, (value) => {
			expectTypeOf(value).toEqualTypeOf<'success' | 'error'>()
			return value
		})
		expect(result).toBe('success')
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

	test('with default: default handler receives only unhandled union members', async () => {
		await typedSwitch(
			getEvent({ type: 'scroll', offset: 50 }),
			'type',
			{
				click: () => 'handled'
			},
			(e) => {
				// Default handler receives only the members not covered above
				expectTypeOf(e).toEqualTypeOf<ScrollEvent | KeyEvent>()
				return 'default'
			}
		)
	})

	test('with default: optional object handlers remain in the fallback union', () => {
		const cases: {
			click?: (event: ClickEvent) => number
			scroll: ((event: ScrollEvent) => number) | undefined
			key: (event: KeyEvent) => number
		} = { scroll: undefined, key: () => 0 }

		const result = typedSwitch(
			getEvent({ type: 'click', x: 10, y: 20 }),
			'type',
			cases,
			(event) => {
				expectTypeOf(event).toEqualTypeOf<ClickEvent | ScrollEvent>()
				return event.type === 'click' ? event.x : event.offset
			}
		)
		expect(result).toBe(10)
	})

	test('with default: reusable partial object maps preserve the full union', () => {
		const cases: PartialObjectSwitchCases<Event, 'type', string> = {}
		const result = typedSwitch(
			getEvent({ type: 'click', x: 10, y: 20 }),
			'type',
			cases,
			(event) => {
				expectTypeOf(event).toEqualTypeOf<Event>()
				return event.type
			}
		)
		expect(result).toBe('click')
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

	test('reusable case maps accept number discriminants', () => {
		type NumericEvent = { type: 1; value: string } | { type: 2; value: number }

		const cases: ObjectSwitchCases<NumericEvent, 'type', string> = {
			1: (e) => e.value,
			2: (e) => String(e.value)
		}

		expect(
			typedSwitch(asType<NumericEvent>({ type: 2, value: 3 }), 'type', cases)
		).toBe('3')
	})

	test('rejects missing number cases without default', () => {
		type NumericEvent = { type: 1 } | { type: 2 }

		const assertTypeErrors = () => {
			// @ts-expect-error missing the 2 case without a default handler
			typedSwitch(asType<NumericEvent>({ type: 1 }), 'type', {
				1: () => 'one'
			})
		}

		expect(assertTypeErrors).toBeDefined()
	})

	test('rejects non-primitive object discriminant values', () => {
		type ObjectKeyed = { type: { a: 1 } }

		const assertTypeErrors = () => {
			// @ts-expect-error object mode only supports string, number and boolean discriminants
			const cases: ObjectSwitchCases<ObjectKeyed, 'type', string> = {}

			expect(cases).toBeDefined()
		}

		expect(assertTypeErrors).toBeDefined()
	})

	test('rejects unknown case keys', () => {
		const assertTypeErrors = () => {
			const event = getEvent({ type: 'click', x: 10, y: 20 })
			const code = asType<200 | 404>(200)

			const status = getStatus('success')

			// @ts-expect-error "sucess" is a typo; "success" would hit the default
			typedSwitch(status, { sucess: () => 1, error: () => 2 }, () => 0)
			// @ts-expect-error "drag" is not a value of the "type" discriminant
			typedSwitch(event, 'type', { click: () => 1, drag: () => 2 }, () => 0)
			// @ts-expect-error 500 is not a value of code
			typedSwitch(code, { 200: () => 1, 404: () => 2, 500: () => 3 })
		}

		expect(assertTypeErrors).toBeDefined()
	})

	test('rejects handlers that break an annotated return type', () => {
		const assertTypeErrors = () => {
			// @ts-expect-error the error handler returns a string, not a number
			const result: number = typedSwitch(getStatus('success'), {
				success: () => 1,
				error: () => 'not a number'
			})

			expect(result).toBeDefined()
		}

		expect(assertTypeErrors).toBeDefined()
	})

	test('rejects the removed explicit constraint type argument', () => {
		const assertTypeErrors = () => {
			// @ts-expect-error use a result annotation instead of typedSwitch<Constraint>
			typedSwitch<number>(getStatus('success'), {
				success: () => 1,
				error: () => 0
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
// Type tests - Enforcing a return type
// ═══════════════════════════════════════════════════════════════════════════

describe('typedSwitch annotated return type', () => {
	interface HasId {
		id: string
	}

	test('annotating the result checks every handler and keeps exhaustiveness', async () => {
		const sync: HasId = typedSwitch(getStatus('success'), {
			success: () => ({ id: '1', name: 'John' }),
			error: () => ({ id: '2', code: 500 })
		})
		const async: Promise<HasId> = typedSwitch(
			getEvent({ type: 'key', key: 'a' }),
			'type',
			{
				click: async () => ({ id: 'click' }),
				scroll: async () => ({ id: 'scroll' }),
				key: async (e) => ({ id: e.key })
			}
		)

		expect(sync).toMatchObject({ id: '1' })
		expect(await async).toEqual({ id: 'a' })
	})
})

describe('typedSwitch plain number and boolean values', () => {
	test('switches on number literals', () => {
		const code = asType<200 | 404>(404)

		const result = typedSwitch(code, {
			200: (c) => {
				expectTypeOf(c).toEqualTypeOf<200>()
				return 'ok'
			},
			404: (c) => {
				expectTypeOf(c).toEqualTypeOf<404>()
				return `missing ${c}`
			}
		})

		expectTypeOf(result).toEqualTypeOf<string>()
		expect(result).toBe('missing 404')
	})

	test('switches on booleans', () => {
		const flag = asType<boolean>(false)

		const result = typedSwitch(flag, {
			true: (f) => {
				expectTypeOf(f).toEqualTypeOf<true>()
				return 1
			},
			false: (f) => {
				expectTypeOf(f).toEqualTypeOf<false>()
				return 0
			}
		})

		expectTypeOf(result).toEqualTypeOf<number>()
		expect(result).toBe(0)
	})

	test('default handler receives unhandled numbers', () => {
		const code = asType<200 | 404 | 500>(500)

		const result = typedSwitch(code, { 200: () => 'ok' }, (c) => {
			expectTypeOf(c).toEqualTypeOf<404 | 500>()
			return `error ${c}`
		})

		expect(result).toBe('error 500')
	})

	test('throws with the stringified value and available cases', () => {
		expect(() =>
			typedSwitch(asType<200 | 404>(500 as 200), { 200: () => 1, 404: () => 2 })
		).toThrow('Unhandled case: 500. Available cases: 200, 404')
	})

	test('rejects missing number and boolean cases', () => {
		const assertTypeErrors = () => {
			// @ts-expect-error missing the 404 case without a default handler
			typedSwitch(asType<200 | 404>(200), { 200: () => 'ok' })
			// @ts-expect-error missing the false case without a default handler
			typedSwitch(asType<boolean>(true), { true: () => 'on' })
		}

		expect(assertTypeErrors).toBeDefined()
	})
})

describe('typedSwitch grouped cases', () => {
	test('object mode: shared handler receives the union of grouped members', () => {
		const event = getEvent({ type: 'scroll', offset: 5 })

		const result = typedSwitch(event, 'type', {
			...typedSwitchGroup(event, 'type', ['click', 'scroll'], (e) => {
				expectTypeOf(e).toEqualTypeOf<ClickEvent | ScrollEvent>()
				return e.type
			}),
			key: (e) => {
				expectTypeOf(e).toEqualTypeOf<KeyEvent>()
				return e.key.length
			}
		})

		expectTypeOf(result).toEqualTypeOf<'click' | 'scroll' | number>()
		expect(result).toBe('scroll')
	})

	test('string mode: shared handler receives the union of grouped values', () => {
		const status = getTriStatus('pending')

		const result = typedSwitch(status, {
			...typedSwitchGroup(status, ['success', 'pending'], (s) => {
				expectTypeOf(s).toEqualTypeOf<'success' | 'pending'>()
				return `fine: ${s}`
			}),
			error: () => 'failed'
		})

		expectTypeOf(result).toEqualTypeOf<string>()
		expect(result).toBe('fine: pending')
	})

	test('number and boolean groups', () => {
		type Response = { code: 200 } | { code: 201 } | { code: 404 }
		const response = asType<Response>({ code: 201 })
		const flag = asType<boolean>(true)

		const status = typedSwitch(response, 'code', {
			...typedSwitchGroup(response, 'code', [200, 201], (r) => {
				expectTypeOf(r).toEqualTypeOf<{ code: 200 } | { code: 201 }>()
				return 'ok'
			}),
			404: () => 'missing'
		})
		const label = typedSwitch(flag, {
			...typedSwitchGroup(flag, [true, false], (f) => {
				expectTypeOf(f).toEqualTypeOf<boolean>()
				return 'either'
			})
		})

		expect(status).toBe('ok')
		expect(label).toBe('either')
	})

	test('default handler excludes grouped keys', () => {
		const order = getOrder({ status: 'cancelled', reason: 'late' })

		const result = typedSwitch(
			order,
			'status',
			{
				...typedSwitchGroup(order, 'status', ['pending', 'completed'], () => 1)
			},
			(o) => {
				expectTypeOf(o).toEqualTypeOf<CancelledOrder>()
				return o.reason
			}
		)

		expectTypeOf(result).toEqualTypeOf<number | string>()
		expect(result).toBe('late')
	})

	test('async grouped handlers keep their Promise type', async () => {
		const status = getTriStatus('success')

		const result = typedSwitch(status, {
			...typedSwitchGroup(status, ['success', 'error'], async (s) => s.length),
			pending: async () => 0
		})

		expectTypeOf(result).toEqualTypeOf<Promise<number>>()
		expect(await result).toBe(7)
	})

	test('a case listed after the group replaces its handler', () => {
		const status = getStatus('error')

		const result = typedSwitch(status, {
			...typedSwitchGroup(status, ['success', 'error'], () => 'group'),
			error: () => 'own'
		})

		expect(result).toBe('own')
	})

	test('unknown values list grouped keys among the available cases', () => {
		const event = { type: 'drag' } as unknown as Event

		expect(() =>
			typedSwitch(event, 'type', {
				...typedSwitchGroup(event, 'type', ['click', 'scroll'], () => 1),
				key: () => 2
			})
		).toThrow(
			'Unhandled case: drag (discriminant key: "type"). Available cases: click, scroll, key'
		)
	})

	test('rejects missing cases and unknown group keys', () => {
		const assertTypeErrors = () => {
			const event = getEvent({ type: 'click', x: 1, y: 2 })
			const status = getTriStatus('success')

			// @ts-expect-error the "key" case is not grouped or handled
			typedSwitch(event, 'type', {
				...typedSwitchGroup(event, 'type', ['click', 'scroll'], () => 1)
			})
			// @ts-expect-error "drag" is not a value of the "type" discriminant
			typedSwitchGroup(event, 'type', ['click', 'drag'], () => 1)
			// @ts-expect-error "done" is not a value of status
			typedSwitchGroup(status, ['success', 'done'], () => 1)
		}

		expect(assertTypeErrors).toBeDefined()
	})
})

describe('assertNever', () => {
	test('type-checks exhaustive switches and throws at runtime', () => {
		const label = (status: 'success' | 'error') => {
			switch (status) {
				case 'success':
					return 'ok'
				case 'error':
					return 'fail'
				default:
					return assertNever(status)
			}
		}

		expect(label('success')).toBe('ok')
		expect(() => label('pending' as 'success')).toThrow(
			'Unexpected value: pending'
		)
		expect(() => assertNever('x' as never, 'custom')).toThrow('custom')
	})

	test('rejects non-exhaustive switches', () => {
		const assertTypeErrors = (status: 'success' | 'error') => {
			switch (status) {
				case 'success':
					return 'ok'
				default:
					// @ts-expect-error 'error' is not handled
					return assertNever(status)
			}
		}

		expect(assertTypeErrors).toBeDefined()
	})
})
