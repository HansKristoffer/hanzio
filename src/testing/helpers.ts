type LogMethod = (...args: unknown[]) => void

export type NoopLogger = {
	trace: LogMethod
	debug: LogMethod
	info: LogMethod
	warn: LogMethod
	error: LogMethod
	fatal: LogMethod
	bind: (...args: unknown[]) => NoopLogger
	child: (...args: unknown[]) => NoopLogger
}

const noop: LogMethod = () => {}

/** A logger that discards everything; `bind` and `child` return itself. */
export const noopLogger: NoopLogger = {
	trace: noop,
	debug: noop,
	info: noop,
	warn: noop,
	error: noop,
	fatal: noop,
	bind: () => noopLogger,
	child: () => noopLogger
}

/**
 * Reads one argument from a mock's call history as `T`. Bun types
 * `mock.calls` as `never[]` for loosely typed mocks.
 *
 * @example
 * const input = mockCallArg<CreateUserInput>(createUser) // first call, first argument
 */
export function mockCallArg<T>(
	fn: { mock: { calls: unknown[][] } },
	callIndex = 0,
	argIndex = 0
): T {
	return fn.mock.calls[callIndex]?.[argIndex] as T
}
