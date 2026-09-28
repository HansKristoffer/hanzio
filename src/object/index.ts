/** `Object.keys` typed as the object's string keys. */
export function typedKeys<T extends object>(object: T): (keyof T & string)[] {
	return Object.keys(object) as (keyof T & string)[]
}

/** `Object.entries` typed as `[key, value]` pairs per key. */
export function typedEntries<T extends object>(
	object: T
): { [K in keyof T & string]: [K, T[K]] }[keyof T & string][] {
	return Object.entries(object) as {
		[K in keyof T & string]: [K, T[K]]
	}[keyof T & string][]
}

/** `Object.fromEntries` typed as `Record<K, V>`. */
export function typedFromEntries<const K extends PropertyKey, V>(
	entries: Iterable<readonly [K, V]>
): Record<K, V> {
	return Object.fromEntries(entries) as Record<K, V>
}

/** Builds a record with one entry per key. */
export function recordFromKeys<const K extends PropertyKey, V>(
	keys: readonly K[],
	fn: (key: K) => V
): Record<K, V> {
	return typedFromEntries(keys.map((key) => [key, fn(key)] as const))
}

export function mapValues<T extends object, R>(
	object: T,
	fn: (value: T[keyof T & string], key: keyof T & string) => R
): Record<keyof T & string, R> {
	return typedFromEntries(
		typedEntries(object).map(([key, value]) => [key, fn(value, key)] as const)
	)
}

export function pick<T extends object, const K extends keyof T>(
	object: T,
	keys: readonly K[]
): Pick<T, K> {
	const result = {} as Pick<T, K>
	for (const key of keys) {
		if (key in object) result[key] = object[key]
	}
	return result
}

export function omit<T extends object, const K extends keyof T>(
	object: T,
	keys: readonly K[]
): Omit<T, K> {
	const result = { ...object }
	for (const key of keys) delete result[key]
	return result
}

type Path = string | readonly (string | number)[]

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function toPath(path: Path): readonly (string | number)[] {
	if (typeof path !== 'string') return path
	return path === '' ? [] : path.split('.')
}

/** Reads a nested value by dot path (`a.b.0.c`) or segment array; undefined when missing. */
export function getAtPath(object: unknown, path: Path): unknown {
	let current = object
	for (const key of toPath(path)) {
		if (current === null || typeof current !== 'object') return undefined
		current = (current as Record<PropertyKey, unknown>)[key]
	}
	return current
}

/** Writes a nested value in place, creating arrays for numeric segments and objects otherwise. */
export function setAtPath(object: object, path: Path, value: unknown): void {
	const keys = toPath(path)
	if (keys.length === 0) throw new Error('Path must not be empty')
	for (const key of keys) {
		if (UNSAFE_KEYS.has(String(key))) {
			throw new Error(`Unsafe path segment: ${key}`)
		}
	}

	let current = object as Record<PropertyKey, unknown>
	for (let index = 0; index < keys.length - 1; index++) {
		const key = keys[index]!
		let next = current[key]
		if (next === null || typeof next !== 'object') {
			next = /^\d+$/.test(String(keys[index + 1])) ? [] : {}
			current[key] = next
		}
		current = next as Record<PropertyKey, unknown>
	}
	current[keys.at(-1)!] = value
}
