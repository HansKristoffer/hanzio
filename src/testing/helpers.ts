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
 * `mock.calls` as `never[]` for loosely typed mocks. Throws when the call or
 * argument does not exist.
 *
 * @example
 * const input = mockCallArg<CreateUserInput>(createUser) // first call, first argument
 */
export function mockCallArg<T>(
	fn: { mock: { calls: unknown[][] } },
	callIndex = 0,
	argIndex = 0
): T {
	const { calls } = fn.mock
	const call = calls[callIndex]
	if (!call) {
		throw new Error(
			`mock was called ${calls.length} time(s); no call at index ${callIndex}`
		)
	}
	if (argIndex >= call.length) {
		throw new Error(
			`mock was called ${calls.length} time(s); call ${callIndex} has ${call.length} argument(s), no argument at index ${argIndex}`
		)
	}
	return call[argIndex] as T
}
