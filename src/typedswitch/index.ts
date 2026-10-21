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

// ═══════════════════════════════════════════════════════════════════════════
// Helper types for return type inference
// ═══════════════════════════════════════════════════════════════════════════

/** Extract raw return type from a handler function (preserves Promise) */
// biome-ignore lint/suspicious/noExplicitAny: Required for type extraction from functions
type RawHandlerReturnType<T> = T extends (...args: any[]) => infer R ? R : never

/** Get union of all raw return types from a cases object's values */
type RawCasesReturnType<Cases> = {
	[K in keyof Cases]: RawHandlerReturnType<Cases[K]>
}[keyof Cases]

/**
 * `R` is only inferred from the call's contextual type. Without one it stays
 * `unknown`, and the overload returns the handlers' own return types.
 */
type Annotated<R, Inferred> = unknown extends R ? Inferred : R

/**
 * TypeScript fixes a handler's return type the first time it checks it, and
 * an object-mode call (`value, key, cases`) is first tried against the
 * plain-value overload with a default (`value, cases, defaultCase`). This type
 * types those cases' handlers by the annotation there too, so they keep their
 * literals. No value satisfies it: `default` would have to be `never`.
 */
type ObjectCasesContext<R> = { [key: string]: (value: never) => R } & {
	default: never
}

/** Only required, defined handlers guarantee that a case is handled. */
type HandledCaseKeys<Cases> = {
	// biome-ignore lint/complexity/noBannedTypes: Empty-object assignability detects optional keys and index signatures.
	[K in keyof Cases]-?: {} extends Pick<Cases, K>
		? never
		: undefined extends Cases[K]
			? never
			: K
}[keyof Cases]

// ═══════════════════════════════════════════════════════════════════════════
// String input mode types
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Object input mode types
// ═══════════════════════════════════════════════════════════════════════════

/** Discriminant values supported in object mode. Cases are keyed by `${value}`. */
type Discriminant = string | number | boolean

/** Discriminant values of `V` whose case key (`${value}`) is in `Keys` */
type ValuesForKeys<V, Keys> = V extends Discriminant
	? `${V}` extends `${Keys & (string | number)}`
		? V
		: never
	: never

type ObjectCases<T, K extends keyof T, R> = {
	[V in Extract<T[K], Discriminant> as `${V}`]: (
		value: Extract<T, Record<K, V>>
	) => R
}

type PartialObjectCases<T, K extends keyof T, R> = {
	[V in Extract<T[K], Discriminant> as `${V}`]?: (
		value: Extract<T, Record<K, V>>
	) => R
}

/** Cases for object input with custom key - all cases required */
export type ObjectSwitchCases<
	T,
	K extends keyof T,
	R
> = T[K] extends Discriminant ? ObjectCases<T, K, R | Promise<R>> : never

/** Partial cases for object input with custom key (when default is provided) */
export type PartialObjectSwitchCases<
	T,
	K extends keyof T,
	R
> = T[K] extends Discriminant ? PartialObjectCases<T, K, R | Promise<R>> : never

/**
 * Rejects case keys that are not values of the switched union, so a typo
 * fails to compile instead of silently falling through to the default.
 */
type NoUnknownCases<Cases, Allowed extends string> = {
	[P in keyof Cases as `${P & (string | number)}` extends Allowed
		? never
		: P]: never
}

type Handler = (value: unknown) => unknown
type CasesRecord = Record<string, Handler | undefined>

// ═══════════════════════════════════════════════════════════════════════════
// Function overloads
// ═══════════════════════════════════════════════════════════════════════════

// Each mode has two overloads. The first four take the result type `R` from
// the call's contextual type, such as an annotated variable or a declared
// return type, so handlers that return literals ('info', [{ name: 'asc' }])
// keep them. When that does not type-check, for example inside a generic call
// like useState(typedSwitch(...)), the last four union the handlers' types.

// Plain value input - all cases required, typed by the annotation
export function typedSwitch<
	T extends Discriminant,
	R,
	Cases extends { [V in T as `${V}`]: (value: V) => R } & NoUnknownCases<
		Cases,
		`${T}`
	>
>(value: T, cases: Cases): Annotated<R, RawCasesReturnType<Cases>>

// Plain value input - partial cases with default, typed by the annotation.
// It comes before the object overloads, which also take three arguments.
export function typedSwitch<
	T extends Discriminant,
	R,
	Cases extends {
		[V in T as `${V}`]?: (value: V) => R
	} & NoUnknownCases<Cases, `${T}`>,
	DefaultCase extends
		| ((value: Exclude<T, ValuesForKeys<T, HandledCaseKeys<Cases>>>) => R)
		| ObjectCasesContext<R>
>(
	value: T,
	cases: Cases,
	defaultCase: DefaultCase
): Annotated<R, RawCasesReturnType<Cases> | RawHandlerReturnType<DefaultCase>>

// Object input with key - all cases required, typed by the annotation
export function typedSwitch<
	T extends object,
	K extends keyof T,
	R,
	Cases extends ObjectCases<T, K, R> &
		NoUnknownCases<Cases, `${Extract<T[K], Discriminant>}`>
>(value: T, key: K, cases: Cases): Annotated<R, RawCasesReturnType<Cases>>

// Object input with key - partial cases with default, typed by the annotation
export function typedSwitch<
	T extends object,
	K extends keyof T,
	R,
	Cases extends PartialObjectCases<T, K, R> &
		NoUnknownCases<Cases, `${Extract<T[K], Discriminant>}`>,
	DefaultCase extends (
		value: Exclude<T, Record<K, ValuesForKeys<T[K], HandledCaseKeys<Cases>>>>
	) => R
>(
	value: T,
	key: K,
	cases: Cases,
	defaultCase: DefaultCase
): Annotated<R, RawCasesReturnType<Cases> | RawHandlerReturnType<DefaultCase>>

// Plain value input - all cases required (no default)
export function typedSwitch<
	T extends Discriminant,
	Cases extends { [V in T as `${V}`]: (value: V) => unknown } & NoUnknownCases<
		Cases,
		`${T}`
	>
>(value: T, cases: Cases): RawCasesReturnType<Cases>

// Object input with key - all cases required (no default)
export function typedSwitch<
	T extends object,
	K extends keyof T,
	Cases extends ObjectCases<T, K, unknown> &
		NoUnknownCases<Cases, `${Extract<T[K], Discriminant>}`>
>(value: T, key: K, cases: Cases): RawCasesReturnType<Cases>

// Plain value input - partial cases allowed (with default)
// The default handler only receives the cases not covered by `cases`.
export function typedSwitch<
	T extends Discriminant,
	Cases extends {
		[V in T as `${V}`]?: (value: V) => unknown
	} & NoUnknownCases<Cases, `${T}`>,
	DefaultCase extends (
		value: Exclude<T, ValuesForKeys<T, HandledCaseKeys<Cases>>>
	) => unknown
>(
	value: T,
	cases: Cases,
	defaultCase: DefaultCase
): RawCasesReturnType<Cases> | RawHandlerReturnType<DefaultCase>

// Object input with key - partial cases allowed (with default)
// The default handler only receives the union members not covered by `cases`.
export function typedSwitch<
	T extends object,
	K extends keyof T,
	Cases extends PartialObjectCases<T, K, unknown> &
		NoUnknownCases<Cases, `${Extract<T[K], Discriminant>}`>,
	DefaultCase extends (
		value: Exclude<T, Record<K, ValuesForKeys<T[K], HandledCaseKeys<Cases>>>>
	) => unknown
>(
	value: T,
	key: K,
	cases: Cases,
	defaultCase: DefaultCase
): RawCasesReturnType<Cases> | RawHandlerReturnType<DefaultCase>

// Implementation
export function typedSwitch(
	value: Discriminant | object,
	keyOrCases: string | CasesRecord,
	casesOrDefault?: CasesRecord | Handler,
	defaultCase?: Handler
): unknown {
	let key: string
	let cases: CasesRecord
	let defaultHandler: Handler | undefined
	let discriminantKey: string | undefined

	if (typeof value !== 'object') {
		// Plain value input: typedSwitch(value, cases, default?)
		key = String(value)
		cases = keyOrCases as CasesRecord
		defaultHandler = casesOrDefault as Handler | undefined
	} else {
		// Object input: typedSwitch(obj, key, cases, default?)
		if (typeof keyOrCases !== 'string') {
			throw new Error(
				'Invalid typedSwitch call: object mode requires a string discriminant key'
			)
		}

		discriminantKey = keyOrCases
		const discriminantValue = (value as Record<string, unknown>)[
			discriminantKey
		]
		if (
			typeof discriminantValue !== 'string' &&
			typeof discriminantValue !== 'number' &&
			typeof discriminantValue !== 'boolean'
		) {
			throw new Error(
				`Invalid discriminant value for key "${discriminantKey}": expected string, number or boolean, received ${typeof discriminantValue}`
			)
		}

		key = String(discriminantValue)
		cases = casesOrDefault as CasesRecord
		defaultHandler = defaultCase
	}

	// Only own properties count as cases - a key like 'toString' must not
	// resolve to an inherited Object.prototype method.
	const handler = Object.hasOwn(cases, key) ? cases[key] : undefined

	if (handler) {
		return handler(value)
	}

	if (defaultHandler) {
		return defaultHandler(value)
	}

	const availableCases = Object.keys(cases).join(', ')
	const availableCasesSuffix =
		availableCases.length > 0
			? ` Available cases: ${availableCases}`
			: ' Available cases: (none)'
	const contextSuffix = discriminantKey
		? ` (discriminant key: "${discriminantKey}")`
		: ''

	throw new Error(
		`Unhandled case: ${key}${contextSuffix}.${availableCasesSuffix}`
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
	T extends Discriminant,
	const Keys extends readonly T[],
	R
>(
	value: T,
	keys: Keys,
	handler: (value: Keys[number]) => R
): { [V in Keys[number] as `${V}`]: (value: V) => R }
export function typedSwitchGroup<
	T extends object,
	K extends keyof T,
	const Keys extends readonly Extract<T[K], Discriminant>[],
	R
>(
	value: T,
	key: K,
	keys: Keys,
	handler: (value: Extract<T, Record<K, Keys[number]>>) => R
): { [V in Keys[number] as `${V}`]: (value: Extract<T, Record<K, V>>) => R }
export function typedSwitchGroup(
	_value: unknown,
	keyOrKeys: unknown,
	keysOrHandler: unknown,
	handler?: Handler
): CasesRecord {
	const keys = (handler ? keysOrHandler : keyOrKeys) as Discriminant[]
	const shared = handler ?? (keysOrHandler as Handler)
	return Object.fromEntries(keys.map((key) => [String(key), shared]))
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
