/** Thrown by `must` and `invariant` when no custom error is given. */
export class InvariantError extends Error {
	override name = 'InvariantError'
}

/** An error's message: Error → `message`, string → itself, `{ message: string }` → that, else `String(error)`. */
export function getErrorMessage(error: unknown, fallback = ''): string {
	let message: string
	if (typeof error === 'string') message = error
	else if (
		typeof error === 'object' &&
		error !== null &&
		'message' in error &&
		typeof error.message === 'string'
	)
		message = error.message
	else {
		try {
			message = String(error)
		} catch {
			// e.g. Object.create(null) has no toString
			message = ''
		}
	}
	return message || fallback
}

/** Returns Errors unchanged, wraps anything else; a `prefix` always wraps as `${prefix}: ${message}` with `cause`. */
export function toError(error: unknown, prefix?: string): Error {
	if (error instanceof Error && !prefix) return error
	const message = getErrorMessage(error)
	return new Error(prefix ? `${prefix}: ${message}` : message, {
		cause: error
	})
}

function fail(
	message: string | (() => Error) | undefined,
	fallback: string
): never {
	throw typeof message === 'function'
		? message()
		: new InvariantError(message ?? fallback)
}

/** Returns `value`, throwing when it is null or undefined. Pass a function to throw your own error. */
export function must<T>(
	value: T,
	message?: string | (() => Error)
): NonNullable<T> {
	if (value === null || value === undefined) {
		fail(message, 'Expected value to be defined')
	}
	return value
}

/** Throws when `condition` is falsy. Pass a function to throw your own error. */
export function invariant(
	condition: unknown,
	message?: string | (() => Error)
): asserts condition {
	if (!condition) fail(message, 'Invariant failed')
}
