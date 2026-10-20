export type PlaceholderValue = string | number

// `\w` in PLACEHOLDER_PATTERN, spelled out so the types match the runtime exactly
type Chars<S extends string> = S extends `${infer C}${infer Rest}`
	? C | Chars<Rest>
	: never
type Letter = Chars<'abcdefghijklmnopqrstuvwxyz'>
type WordChar = Letter | Uppercase<Letter> | Chars<'0123456789_'>

type IsWord<S extends string> = S extends `${infer C}${infer Rest}`
	? C extends WordChar
		? Rest extends ''
			? true
			: IsWord<Rest>
		: false
	: false

// `{a {b}` holds the placeholder `b`: keep the text after the last `{`
type AfterLastBrace<S extends string> = S extends `${string}{${infer Rest}`
	? AfterLastBrace<Rest>
	: S

type ExtractNames<
	S extends string,
	Found extends string = never
> = S extends `${string}{${infer Body}}${infer Rest}`
	? ExtractNames<
			Rest,
			| Found
			| (IsWord<AfterLastBrace<Body>> extends true
					? AfterLastBrace<Body>
					: never)
		>
	: Found

/** `'Hi {name}, you have {count}'` → `'name' | 'count'`; `string` for non-literal templates. */
export type PlaceholderNames<S extends string> = string extends S
	? string
	: ExtractNames<S>

export type PlaceholderParams<S extends string> = Record<
	PlaceholderNames<S>,
	PlaceholderValue
>

/** Params argument: required with placeholders, absent without, optional for non-literal templates. */
export type PlaceholderArgs<S extends string> = string extends S
	? [params?: PlaceholderParams<S>]
	: [PlaceholderNames<S>] extends [never]
		? []
		: [params: PlaceholderParams<S>]

/** A `{name}` placeholder: word characters only, so `{ x }` and `{n, plural}` are plain text. */
const PLACEHOLDER_PATTERN = /\{(\w+)\}/g

/** Unique placeholder names in order of first appearance. */
export function extractPlaceholders<S extends string>(
	template: S
): PlaceholderNames<S>[] {
	const names = template.matchAll(PLACEHOLDER_PATTERN).map((match) => match[1])
	return [...new Set(names)] as PlaceholderNames<S>[]
}

/**
 * Replaces `{name}` placeholders with `params`. Placeholders without a
 * (non-null) param are left as-is. There is no escape syntax.
 */
export function interpolate<S extends string>(
	template: S,
	...args: PlaceholderArgs<S>
): string {
	const params: Partial<Record<string, PlaceholderValue>> = args[0] ?? {}
	return template.replace(PLACEHOLDER_PATTERN, (match, name: string) => {
		const value = Object.hasOwn(params, name) ? params[name] : undefined
		return value == null ? match : String(value)
	})
}

export type Messages = { readonly [key: string]: string | Messages }

/** Dot-path keys of the string leaves: `{ a: { b: 'x' } }` → `'a.b'`. */
export type MessageKeys<T> = {
	[K in keyof T & string]: T[K] extends string ? K : `${K}.${MessageKeys<T[K]>}`
}[keyof T & string]

/** Message at a dot-path key. */
export type MessageAt<T, K extends string> = K extends keyof T
	? T[K]
	: K extends `${infer Head}.${infer Rest}`
		? Head extends keyof T
			? MessageAt<T[Head], Rest>
			: never
		: never

/** `{ a: { b: 'x' } }` → `{ 'a.b': 'x' }` */
export function flattenMessages<const T extends Messages>(
	messages: T
): Record<MessageKeys<T>, string> {
	const out: Record<string, string> = {}
	const visit = (node: Messages, prefix: string) => {
		for (const [key, value] of Object.entries(node)) {
			if (typeof value === 'string') out[prefix + key] = value
			else visit(value, `${prefix + key}.`)
		}
	}
	visit(messages, '')
	return out
}

/**
 * Typed `t(key, params)` over a nested messages object. With literal messages
 * (inline `const` objects), params are required exactly when the message has
 * placeholders. Unknown keys at runtime return the key.
 */
export function createTranslator<const T extends Messages>(messages: T) {
	const flat: Partial<Record<string, string>> = flattenMessages(messages)
	return <K extends MessageKeys<T>>(
		key: K,
		...args: PlaceholderArgs<Extract<MessageAt<T, K>, string>>
	): string =>
		interpolate(
			flat[key] ?? key,
			...(args as [Record<string, PlaceholderValue>?])
		)
}

export type TranslationValue = PlaceholderValue

/** Generated key → placeholder-name map: `{ 'greeting': 'name', 'common.save': never }`. */
export type TranslationParamsMap = Record<string, string>

/**
 * Strict `t` over a generated key → placeholder-name map (see `hanzio-i18n
 * generate`). Keys without placeholders take no params; keys with placeholders
 * require every named value.
 */
export type TypedTranslate<Params extends TranslationParamsMap> = <
	Key extends keyof Params & string
>(
	...args: [Params[Key]] extends [never]
		? [key: Key]
		: [key: Key, params: Record<Params[Key], TranslationValue>]
) => string

/** Explicit escape hatch for data-driven keys validated outside TypeScript. */
export type DynamicTranslate = (
	key: string,
	params?: Record<string, TranslationValue>
) => string

/**
 * Narrows a framework's string-wide `t` (vue-i18n, i18next) to the generated
 * map. Types only; returns `t` unchanged.
 */
export function typedTranslate<Params extends TranslationParamsMap>(
	t: (...args: never[]) => unknown
): TypedTranslate<Params> {
	return t as unknown as TypedTranslate<Params>
}

export * from './locales'
