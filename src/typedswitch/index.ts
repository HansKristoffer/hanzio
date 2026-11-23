/**
 * typedSwitch - A type-safe switch statement for discriminated unions
 *
 * Supports two input modes:
 *
 * 1. PLAIN VALUE INPUT - switch on a string, number or boolean value directly.
 *    Cases are keyed by `String(value)`:
 *
 *    @example
 *    const status: 'success' | 'error' = 'success'
 *
 *    // All cases required (no default)
 *    typedSwitch(status, {
 *      success: (val) => 'handled success',
 *      error: (val) => 'handled error',
 *    })
 *
 *    // Partial cases with default handler
 *    typedSwitch(status, {
 *      success: (val) => 'handled success',
 *    }, (val) => 'default handler')
 *
 *    typedSwitch(code, { 200: (c) => 'ok', 404: (c) => 'missing' }) // c: 200, 404
 *    typedSwitch(flag, { true: () => 'on', false: () => 'off' })
 *
 *    // A value that can be null or undefined needs `null` and `undefined` cases (or a default)
 *    typedSwitch(maybeStatus, { success: …, error: …, undefined: () => 'none' })
 *
 *
 * 2. OBJECT INPUT - switch on a discriminated union with custom key:
 *
 *    @example
 *    type Event =
 *      | { type: 'click'; x: number; y: number }
 *      | { type: 'scroll'; offset: number }
 *
 *    // All cases required (no default)
 *    typedSwitch(event, 'type', {
 *      click: (e) => `Clicked at ${e.x}, ${e.y}`,
 *      scroll: (e) => `Scrolled ${e.offset}px`,
 *    })
 *
 *    // Partial cases with default handler
 *    typedSwitch(event, 'type', {
 *      click: (e) => `Clicked at ${e.x}, ${e.y}`,
 *    }, (e) => 'unhandled event')
 *
 *    // Works with any discriminant key (not just 'type')
 *    type Order = { status: 'pending' } | { status: 'completed' }
 *    typedSwitch(order, 'status', {
 *      pending: (o) => 'waiting...',
 *      completed: (o) => 'done!',
 *    })
 *
 *
 * 3. GROUPED CASES - share one handler between several values with
 *    `typedSwitchGroup`. The handler receives the union of the grouped
 *    members, and the spread keeps exhaustiveness and return type inference:
 *
 *    @example
 *    typedSwitch(event, 'type', {
 *      ...typedSwitchGroup(event, 'type', ['click', 'scroll'], (e) => e.type), // e: ClickEvent | ScrollEvent
 *      key: (e) => e.key,
 *    })
 *
 *    typedSwitch(status, {
 *      ...typedSwitchGroup(status, ['success', 'pending'], (s) => 'fine'), // s: 'success' | 'pending'
 *      error: () => 'failed',
 *    })
 *
 *
 * 4. ENFORCING A RETURN TYPE - annotate the result:
 *
 *    @example
 *    const result: { id: string } = typedSwitch(status, {
 *      success: () => ({ id: '123' }),
 *      error: () => ({ id: '456' }),
 *    })
 */

/**
 * Extract raw return type from a handler function (preserves Promise). `never[]`
 * matches a handler with any parameter list, as `any[]` would, without `any`.
 */
type RawHandlerReturnType<T> = T extends (...args: never[]) => infer R
	? R
	: never

/** Get union of all raw return types from a cases object's values */
type RawCasesReturnType<Cases> = RawHandlerReturnType<Cases[keyof Cases]>

/**
 * `R` is inferred from the call's contextual type. Without one it stays
 * `unknown`, and the overload returns the handlers' own return types. When an
 * annotation or `satisfies` is present and the handlers' inferred union is
 * already assignable to `R`, keeping `Inferred` preserves extra properties and
 * narrower literal types without widening back to `R`.
 */
type Annotated<R, Inferred> = unknown extends R
	? Inferred
	: [Inferred] extends [NoInfer<R>]
		? Inferred
		: R

declare const objectCasesMarker: unique symbol

/**
 * TypeScript fixes a handler's return type the first time it checks it, and
 * an object-mode call (`value, key, cases`) is first tried against the
 * plain-value overload with a default (`value, cases, defaultCase`). This type
 * types those cases' handlers by the annotation there too, so they keep their
 * literals. A unique symbol marker makes it unsatisfiable without colliding
 * with any real string case key such as `'default'`.
 */
type ObjectCasesContext<R> = {
	[key: string]: (value: never) => R
	[objectCasesMarker]: never
}

/**
 * Only required, defined handlers guarantee that a case is handled. `K`
 * distributes over the keys, which TypeScript checks faster than a mapped type.
 */
type HandledCaseKeys<Cases, K = keyof Cases> = K extends keyof Cases
	? undefined extends Cases[K]
		? never
		: // biome-ignore lint/complexity/noBannedTypes: Empty-object assignability detects index signature keys.
			{} extends Record<K, 1>
			? never
			: K
	: never

// The exported case-map types below are annotation helpers for consumers who
// want to type reusable case maps. The typedSwitch overloads infer their own
// shapes and do not depend on these types.

/** Cases for string input - all cases required */
export type StringSwitchCases<T extends string, R> = {
	[K in T]: (value: K) => R | Promise<R>
}

/** Partial cases for string input (when default is provided) */
export type PartialStringSwitchCases<T extends string, R> = {
	[K in T]?: (value: K) => R | Promise<R>
}

/** Discriminant values supported in object mode. Cases are keyed by `${value}`. */
type Discriminant = string | number | boolean

/** Values the plain mode switches on. `null` and `undefined` get `null` and `undefined` cases. */
type PlainValue = Discriminant | null | undefined

/** Values of `V` whose case key (`${value}`) is in `Keys` */
type ValuesForKeys<V, Keys> = V extends PlainValue
	? `${V}` extends `${Keys & (string | number)}`
		? V
		: never
	: never

/**
 * Fast path for `ValuesForKeys` when both the union values and handled case
 * keys are strings, avoiding per-member template literal evaluation.
 */
type ValuesForCaseKeys<V extends PlainValue, Keys> = [Keys] extends [never]
	? never
	: [V] extends [string]
		? [Keys] extends [string]
			? Extract<V, Keys>
			: ValuesForKeys<V, Keys>
		: ValuesForKeys<V, Keys>

type Nullish = null | undefined

/**
 * String keys of `T` whose values are valid discriminants (`string | number |
 * boolean`), rejecting non-primitive, nullable, numeric and symbol keys at
 * compile time while preserving `any` compatibility.
 */
type DiscriminantKey<T> = [T] extends [never]
	? never
	: {
			[K in keyof T & string]: 0 extends 1 & T[K]
				? K
				: [T[K]] extends [Discriminant]
					? K
					: never
		}[keyof T & string]

/** Discriminant values of `T`, plus `null` and `undefined` when `T` can be them */
type ObjectCaseValue<T, K extends keyof NonNullable<T>> =
	| Extract<NonNullable<T>[K], Discriminant>
	| Extract<T, Nullish>

/**
 * The members of `T` whose discriminant can be one of `V`. A member whose
 * discriminant is itself a union, such as a row with a `status` column, is
 * narrowed to those values.
 */
type MembersWith<T, K extends keyof T, V> = T extends unknown
	? T[K] extends V
		? T
		: [Extract<T[K], V>] extends [never]
			? never
			: T & Record<K, Extract<T[K], V>>
	: never

/**
 * Single-value specialization of `MembersWith`: skips `Extract` and tuple
 * wrapping on non-matching members when `V` is one discriminant value.
 */
type SingleMembersWith<T, K extends keyof T, V> = T extends unknown
	? T[K] extends V
		? T
		: V extends T[K]
			? T & Record<K, V>
			: never
	: never

/** A `null` or `undefined` case receives the value itself. */
type ObjectCaseInput<T, K extends keyof NonNullable<T>, V> = V extends Nullish
	? V
	: SingleMembersWith<NonNullable<T>, K, V>

/** Input for a grouped object handler whose keys may mix discriminants and nullish values. */
type GroupObjectInput<T, K extends keyof NonNullable<T>, V> =
	| Extract<V, Nullish>
	| ([Exclude<V, Nullish>] extends [never]
			? never
			: MembersWith<NonNullable<T>, K, Exclude<V, Nullish>>)

type ObjectCases<T, K extends keyof NonNullable<T>, R> = {
	[V in ObjectCaseValue<T, K> as `${V}`]: (
		value: ObjectCaseInput<T, K, ValuesForKeys<ObjectCaseValue<T, K>, `${V}`>>
	) => R
}

type PartialObjectCases<T, K extends keyof NonNullable<T>, R> = {
	[V in ObjectCaseValue<T, K> as `${V}`]?: (
		value: ObjectCaseInput<T, K, ValuesForKeys<ObjectCaseValue<T, K>, `${V}`>>
	) => R
}

/**
 * The members, `null` and `undefined` that no required case of `Cases` handles.
 * Also narrows a member whose discriminant is a union to its unhandled values.
 */
type UnhandledObjects<
	T,
	K extends keyof NonNullable<T>,
	Cases,
	Handled = ValuesForCaseKeys<ObjectCaseValue<T, K>, HandledCaseKeys<Cases>>
> = [Handled] extends [never]
	? T
	:
			| MembersWith<NonNullable<T>, K, Exclude<NonNullable<T>[K], Handled>>
			| Exclude<Extract<T, Nullish>, Handled>

/** Cases for object input with custom key - all cases required */
export type ObjectSwitchCases<T, K extends keyof NonNullable<T>, R> = [
	NonNullable<T>[K]
] extends [Discriminant]
	? ObjectCases<T, K, R | Promise<R>>
	: never

/** Partial cases for object input with custom key (when default is provided) */
export type PartialObjectSwitchCases<T, K extends keyof NonNullable<T>, R> = [
	NonNullable<T>[K]
] extends [Discriminant]
	? PartialObjectCases<T, K, R | Promise<R>>
	: never

/**
 * Rejects case keys that are not values of the switched union, so a typo
 * fails to compile instead of silently falling through to the default.
 * Resolves to `unknown` on valid calls to avoid per-call mapped type and
 * intersection allocations.
 */
type NoUnknownCases<
	Cases,
	Allowed extends PlainValue
> = keyof Cases extends Allowed
	? unknown
	: `${keyof Cases & (string | number)}` extends `${Allowed}`
		? unknown
		: {
				[P in Exclude<
					`${keyof Cases & (string | number)}`,
					`${Allowed}`
				>]: never
			}

/**
 * When every overload fails, TypeScript reports only the last one that takes
 * that many arguments. For three, that is the plain-value overload with a
 * default, so a mistake in an object-mode call would be reported as "not
 * assignable to PlainValue". Given an object, this rest parameter makes that
 * overload want a fourth argument, so TypeScript skips it and reports the
 * object overload's error, which names the missing or unknown case. `T` must
 * accept objects there, or it falls back to its constraint and the skip is lost.
 */
type SkipForObjects<T> = [T] extends [PlainValue] ? [] : [never]

type Handler = (value: unknown) => unknown
type CasesRecord = Record<string, Handler | undefined>

// Cold error builders stay out of `typedSwitch` so its hot path stays small for JIT inlining.
function throwUnhandledCase(
	key: unknown,
	cases: CasesRecord,
	discriminantKey?: string
): never {
	const availableCases = Object.keys(cases).join(', ')
	const availableCasesSuffix =
		availableCases.length > 0
			? ` Available cases: ${availableCases}`
			: ' Available cases: (none)'
	const contextSuffix = discriminantKey
		? ` (discriminant key: "${discriminantKey}")`
		: ''

	throw new Error(
		`Unhandled case: ${String(key)}${contextSuffix}.${availableCasesSuffix}`
	)
}

function throwInvalidDiscriminant(
	discriminantKey: string,
	actualType: string
): never {
	throw new Error(
		`Invalid discriminant value for key "${discriminantKey}": expected string, number or boolean, received ${actualType}`
	)
}

// Each mode has two overloads. The first four take the result type `R` from
// the call's contextual type, such as an annotated variable or a declared
// return type, so handlers that return literals ('info', [{ name: 'asc' }])
// keep them. When that does not type-check, for example inside a generic call
// like useState(typedSwitch(...)), the last four union the handlers' types.
//
// The `[...] extends [string]` branches stay inline in each `Cases` constraint
// (rather than behind a helper alias) so TypeScript resolves the pure-string
// mapped type directly without key remapping or extra alias instantiations.

// Plain value input - all cases required, typed by the annotation
export function typedSwitch<
	T extends PlainValue,
	R,
	Cases extends ([T] extends [string]
		? { [V in T]: (value: V) => R }
		: {
				[V in T as `${V}`]: (value: ValuesForKeys<T, `${V}`>) => R
			}) &
		NoUnknownCases<Cases, T>
>(value: T, cases: Cases): Annotated<R, RawCasesReturnType<Cases>>

// Plain value input - partial cases with default, typed by the annotation.
// It comes before the object overloads, which also take three arguments.
export function typedSwitch<
	T extends PlainValue,
	R,
	Cases extends ([T] extends [string]
		? { [V in T]?: ((value: V) => R) | undefined }
		: {
				[V in T as `${V}`]?:
					| ((value: ValuesForKeys<T, `${V}`>) => R)
					| undefined
			}) &
		NoUnknownCases<Cases, T>,
	DefaultCase extends
		| ((value: Exclude<T, ValuesForCaseKeys<T, HandledCaseKeys<Cases>>>) => R)
		| ObjectCasesContext<R>
>(
	value: T,
	cases: Cases,
	defaultCase: DefaultCase
): Annotated<R, RawCasesReturnType<Cases> | RawHandlerReturnType<DefaultCase>>

// Object input with key - all cases required, typed by the annotation
export function typedSwitch<
	T extends object | Nullish,
	K extends DiscriminantKey<NonNullable<T>>,
	R,
	Cases extends ([ObjectCaseValue<T, K>] extends [string]
		? {
				[V in ObjectCaseValue<T, K>]: (
					value: SingleMembersWith<NonNullable<T>, K, V>
				) => R
			}
		: {
				[V in ObjectCaseValue<T, K> as `${V}`]: (
					value: ObjectCaseInput<
						T,
						K,
						ValuesForKeys<ObjectCaseValue<T, K>, `${V}`>
					>
				) => R
			}) &
		NoUnknownCases<Cases, ObjectCaseValue<T, K>>
>(value: T, key: K, cases: Cases): Annotated<R, RawCasesReturnType<Cases>>

// Object input with key - partial cases with default, typed by the annotation
export function typedSwitch<
	T extends object | Nullish,
	K extends DiscriminantKey<NonNullable<T>>,
	R,
	Cases extends ([ObjectCaseValue<T, K>] extends [string]
		? {
				[V in ObjectCaseValue<T, K>]?:
					| ((value: SingleMembersWith<NonNullable<T>, K, V>) => R)
					| undefined
			}
		: {
				[V in ObjectCaseValue<T, K> as `${V}`]?:
					| ((
							value: ObjectCaseInput<
								T,
								K,
								ValuesForKeys<ObjectCaseValue<T, K>, `${V}`>
							>
					  ) => R)
					| undefined
			}) &
		NoUnknownCases<Cases, ObjectCaseValue<T, K>>,
	DefaultCase extends (value: UnhandledObjects<T, K, Cases>) => R
>(
	value: T,
	key: K,
	cases: Cases,
	defaultCase: DefaultCase
): Annotated<R, RawCasesReturnType<Cases> | RawHandlerReturnType<DefaultCase>>

// Plain value input - all cases required (no default)
export function typedSwitch<
	T extends PlainValue,
	Cases extends ([T] extends [string]
		? { [V in T]: (value: V) => unknown }
		: {
				[V in T as `${V}`]: (value: ValuesForKeys<T, `${V}`>) => unknown
			}) &
		NoUnknownCases<Cases, T>
>(value: T, cases: Cases): RawCasesReturnType<Cases>

// Object input with key - all cases required (no default)
export function typedSwitch<
	T extends object | Nullish,
	K extends DiscriminantKey<NonNullable<T>>,
	Cases extends ([ObjectCaseValue<T, K>] extends [string]
		? {
				[V in ObjectCaseValue<T, K>]: (
					value: SingleMembersWith<NonNullable<T>, K, V>
				) => unknown
			}
		: {
				[V in ObjectCaseValue<T, K> as `${V}`]: (
					value: ObjectCaseInput<
						T,
						K,
						ValuesForKeys<ObjectCaseValue<T, K>, `${V}`>
					>
				) => unknown
			}) &
		NoUnknownCases<Cases, ObjectCaseValue<T, K>>
>(value: T, key: K, cases: Cases): RawCasesReturnType<Cases>

// Plain value input - partial cases allowed (with default)
// The default handler only receives the cases not covered by `cases`.
export function typedSwitch<
	T extends PlainValue | object,
	Cases extends ([Extract<T, PlainValue>] extends [string]
		? { [V in Extract<T, PlainValue>]?: ((value: V) => unknown) | undefined }
		: {
				[V in Extract<T, PlainValue> as `${V}`]?:
					| ((value: ValuesForKeys<Extract<T, PlainValue>, `${V}`>) => unknown)
					| undefined
			}) &
		NoUnknownCases<Cases, Extract<T, PlainValue>>,
	DefaultCase extends (
		value: Exclude<
			T,
			ValuesForCaseKeys<Extract<T, PlainValue>, HandledCaseKeys<Cases>>
		>
	) => unknown
>(
	value: T,
	cases: Cases,
	defaultCase: DefaultCase,
	...objectInput: SkipForObjects<T>
): RawCasesReturnType<Cases> | RawHandlerReturnType<DefaultCase>

// Object input with key - partial cases allowed (with default)
// The default handler only receives the union members not covered by `cases`.
export function typedSwitch<
	T extends object | Nullish,
	K extends DiscriminantKey<NonNullable<T>>,
	Cases extends ([ObjectCaseValue<T, K>] extends [string]
		? {
				[V in ObjectCaseValue<T, K>]?:
					| ((value: SingleMembersWith<NonNullable<T>, K, V>) => unknown)
					| undefined
			}
		: {
				[V in ObjectCaseValue<T, K> as `${V}`]?:
					| ((
							value: ObjectCaseInput<
								T,
								K,
								ValuesForKeys<ObjectCaseValue<T, K>, `${V}`>
							>
					  ) => unknown)
					| undefined
			}) &
		NoUnknownCases<Cases, ObjectCaseValue<T, K>>,
	DefaultCase extends (value: UnhandledObjects<T, K, Cases>) => unknown
>(
	value: T,
	key: K,
	cases: Cases,
	defaultCase: DefaultCase
): RawCasesReturnType<Cases> | RawHandlerReturnType<DefaultCase>

// Implementation
export function typedSwitch(
	value: PlainValue | object,
	keyOrCases: string | CasesRecord,
	casesOrDefault?: CasesRecord | Handler,
	defaultCase?: Handler
): unknown {
	let cases: CasesRecord
	let defaultHandler: Handler | undefined
	let discriminantKey: string | undefined
	let key: string
	let numKey: number | undefined

	// Branching on `keyOrCases` first lets JITs fold the mode check at call sites
	// (where the discriminant key is a constant string and `cases` is an object).
	if (typeof keyOrCases === 'string') {
		discriminantKey = keyOrCases
		cases = casesOrDefault as CasesRecord
		defaultHandler = defaultCase

		if (value === null || value === undefined) {
			key = value === null ? 'null' : 'undefined'
		} else {
			const discriminantValue = (value as Record<string, unknown>)[keyOrCases]
			const t = typeof discriminantValue
			if (t === 'string') {
				key = discriminantValue as string
			} else if (t === 'number') {
				numKey = discriminantValue as number
				key = ''
			} else if (t === 'boolean') {
				key = discriminantValue ? 'true' : 'false'
			} else {
				throwInvalidDiscriminant(keyOrCases, t)
			}
		}
	} else {
		cases = keyOrCases
		defaultHandler = casesOrDefault as Handler | undefined

		if (typeof value === 'string') {
			key = value
		} else if (typeof value === 'number') {
			numKey = value
			key = ''
		} else if (typeof value === 'boolean') {
			key = value ? 'true' : 'false'
		} else if (value === null) {
			key = 'null'
		} else if (value === undefined) {
			key = 'undefined'
		} else if (typeof value === 'object') {
			throw new Error(
				'Invalid typedSwitch call: object mode requires a string discriminant key'
			)
		} else {
			key = String(value)
		}
	}

	// Only own properties count as cases - a key like 'toString' must not
	// resolve to an inherited Object.prototype method. Keeping number and string
	// lookups on separate sites avoids stringifying numbers and keeps each IC monomorphic.
	const handler =
		numKey !== undefined
			? Object.hasOwn(cases, numKey)
				? cases[numKey]
				: undefined
			: Object.hasOwn(cases, key)
				? cases[key]
				: undefined

	if (handler) {
		return handler(value)
	}

	if (defaultHandler) {
		return defaultHandler(value)
	}

	return throwUnhandledCase(
		numKey !== undefined ? numKey : key,
		cases,
		discriminantKey
	)
}

/**
 * Builds cases that share one handler, for spreading into `typedSwitch` cases.
 * Pass the switched value so its type is inferred; the handler receives the
 * union of the grouped members. A case listed after the spread replaces the
 * grouped handler for that key; listing it before the spread is a type error.
 * If two groups list the same key, the later group wins.
 *
 * @example
 * typedSwitch(event, 'type', {
 *   ...typedSwitchGroup(event, 'type', ['click', 'scroll'], (e) => e.type),
 *   key: (e) => e.key,
 * })
 */
export function typedSwitchGroup<
	T extends PlainValue,
	const Keys extends readonly T[],
	R
>(
	value: T,
	keys: Keys,
	handler: (value: Keys[number]) => R
): [Keys[number]] extends [string]
	? { [V in Keys[number]]: (value: V) => R }
	: {
			[V in Keys[number] as `${V}`]: (
				value: ValuesForKeys<Keys[number], `${V}`>
			) => R
		}
export function typedSwitchGroup<
	T extends object | Nullish,
	K extends DiscriminantKey<NonNullable<T>>,
	const Keys extends readonly ObjectCaseValue<T, K>[],
	R
>(
	value: T,
	key: K,
	keys: Keys,
	handler: (value: GroupObjectInput<T, K, Keys[number]>) => R
): [Keys[number]] extends [string]
	? {
			[V in Keys[number]]: (value: SingleMembersWith<NonNullable<T>, K, V>) => R
		}
	: {
			[V in Keys[number] as `${V}`]: (
				value: ObjectCaseInput<T, K, ValuesForKeys<Keys[number], `${V}`>>
			) => R
		}
export function typedSwitchGroup(
	_value: unknown,
	keyOrKeys: unknown,
	keysOrHandler: unknown,
	handler?: Handler
): CasesRecord {
	// The object form has a key argument, so its keys and handler sit one place later.
	const isObjectForm = handler !== undefined
	const keys = (isObjectForm ? keysOrHandler : keyOrKeys) as PlainValue[]
	const shared = (isObjectForm ? handler : keysOrHandler) as Handler

	const cases: CasesRecord = {}
	for (let i = 0; i < keys.length; i++) {
		const k = keys[i]
		cases[typeof k === 'string' || typeof k === 'number' ? k : String(k)] =
			shared
	}
	return cases
}

/**
 * Exhaustiveness helper for regular `switch` statements. Place it in the
 * `default` branch: it only type-checks when every case has been handled, and
 * throws if an unexpected value reaches it at runtime.
 *
 * @example
 * switch (status) {
 *   case 'success': return 1
 *   case 'error': return 0
 *   default: return assertNever(status)
 * }
 */
export function assertNever(value: never, message?: string): never {
	throw new Error(message ?? `Unexpected value: ${String(value)}`)
}
