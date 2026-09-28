export type BackgroundPromiseOptions = {
	onError?: (error: unknown) => void
	onSuccess?: () => void
	scheduler?: (callback: () => void) => void
}

export type Success<T> = {
	ok: true
	data: T
	error: null
}

export type Failure<E> = {
	ok: false
	data: null
	error: E
}

export type Result<T, E = Error> = Success<T> | Failure<E>

export function ok<T>(data: T): Success<T> {
	return { ok: true, data, error: null }
}

export function err<E>(error: E): Failure<E> {
	return { ok: false, data: null, error }
}

export function isSuccess<T, E>(result: Result<T, E>): result is Success<T> {
	return result.ok
}

export function isFailure<T, E>(result: Result<T, E>): result is Failure<E> {
	return !result.ok
}

export function unwrapResult<T, E>(result: Result<T, E>): T {
	if (result.ok) return result.data
	throw result.error
}

export function backgroundPromise<T>(
	promiseFactory: () => Promise<T>,
	options: BackgroundPromiseOptions = {}
): void {
	const run = () => {
		promiseFactory()
			.then(() => options.onSuccess?.())
			.catch((error: unknown) => options.onError?.(error))
	}

	if (options.scheduler) {
		options.scheduler(run)
		return
	}

	run()
}

export function backgroundPromiseSync<T>(
	promiseFactory: () => Promise<T>,
	options: BackgroundPromiseOptions = {}
): void {
	backgroundPromise(promiseFactory, {
		...options,
		scheduler: options.scheduler ?? queueMicrotask
	})
}

/** Resolves after `ms`; rejects with `signal.reason` if the signal aborts first. */
export function promiseTimeout(
	ms: number,
	options: { signal?: AbortSignal } = {}
): Promise<void> {
	const { signal } = options
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason)
			return
		}
		const onAbort = () => {
			clearTimeout(timer)
			reject(signal?.reason)
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort)
			resolve()
		}, ms)
		signal?.addEventListener('abort', onAbort, { once: true })
	})
}

/**
 * Accepts a promise or a function; sync throws inside the function are
 * captured too.
 */
export async function tryCatch<T, E = Error>(
	input: Promise<T> | (() => T | Promise<T>)
): Promise<Result<T, E>> {
	try {
		return ok(await (typeof input === 'function' ? input() : input))
	} catch (error) {
		return err(error as E)
	}
}

export class PromiseTimeoutError extends Error {
	readonly timeoutMs: number

	constructor(timeoutMs: number, message?: string) {
		super(message ?? `Promise timed out after ${timeoutMs}ms`)
		this.name = 'PromiseTimeoutError'
		this.timeoutMs = timeoutMs
	}
}

/**
 * Rejects with `PromiseTimeoutError` after `ms`, or with `signal.reason` when
 * the signal aborts. Pass a function to receive a signal that aborts on
 * timeout, so the underlying work can stop too.
 */
export async function withTimeout<T>(
	input: Promise<T> | ((signal: AbortSignal) => Promise<T>),
	ms: number,
	options: { signal?: AbortSignal; message?: string } = {}
): Promise<T> {
	const controller = new AbortController()
	const onAbort = () => controller.abort(options.signal?.reason)
	if (options.signal?.aborted) onAbort()
	else options.signal?.addEventListener('abort', onAbort, { once: true })

	const timer = setTimeout(
		() => controller.abort(new PromiseTimeoutError(ms, options.message)),
		ms
	)
	let rejectOnAbort: () => void = () => {}

	try {
		const aborted = new Promise<never>((_, reject) => {
			rejectOnAbort = () => reject(controller.signal.reason)
			controller.signal.addEventListener('abort', rejectOnAbort, { once: true })
		})
		if (controller.signal.aborted) throw controller.signal.reason

		const promise =
			typeof input === 'function' ? input(controller.signal) : input
		return await Promise.race([promise, aborted])
	} finally {
		clearTimeout(timer)
		options.signal?.removeEventListener('abort', onAbort)
		controller.signal.removeEventListener('abort', rejectOnAbort)
	}
}

export type BackoffOptions = {
	/** Delay for the first retry (default 300ms). */
	baseMs?: number
	/** Upper bound for any delay (default 30s). */
	maxMs?: number
	/**
	 * `true`/`'full'`: random delay in [0, computed] (default).
	 * `'partial'`: computed plus 0–`jitterRatio` extra (may exceed `maxMs`).
	 */
	jitter?: boolean | 'full' | 'partial'
	/** Max extra fraction for `'partial'` jitter (default 0.25). */
	jitterRatio?: number
	/** Source of randomness in [0, 1) (default `Math.random`). */
	random?: () => number
}

/** Exponential backoff delay for a 1-based retry attempt. */
export function exponentialBackoff(
	attempt: number,
	options: BackoffOptions = {}
): number {
	const {
		baseMs = 300,
		maxMs = 30_000,
		jitter = true,
		jitterRatio = 0.25,
		random = Math.random
	} = options
	const delay = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1))
	if (jitter === 'partial')
		return Math.round(delay * (1 + jitterRatio * random()))
	return jitter ? Math.round(random() * delay) : delay
}

export type RetryOptions = {
	/** Retries after the first attempt (default 3). */
	retries?: number
	/** Delay before retry `attempt` (1-based). Default: `exponentialBackoff`. */
	delayMs?: number | ((attempt: number, error: unknown) => number)
	/** Return false to stop retrying and rethrow (default: always retry). */
	shouldRetry?: (error: unknown, attempt: number) => boolean
	onRetry?: (error: unknown, attempt: number, delayMs: number) => void
	signal?: AbortSignal
}

export async function retry<T>(
	fn: (context: { attempt: number; signal?: AbortSignal }) => Promise<T> | T,
	options: RetryOptions = {}
): Promise<T> {
	const { retries = 3, delayMs, shouldRetry, onRetry, signal } = options

	for (let attempt = 0; ; attempt++) {
		signal?.throwIfAborted()
		try {
			return await fn({ attempt, signal })
		} catch (error) {
			const nextAttempt = attempt + 1
			if (attempt >= retries || shouldRetry?.(error, nextAttempt) === false) {
				throw error
			}
			const delay =
				delayMs === undefined
					? exponentialBackoff(nextAttempt)
					: typeof delayMs === 'function'
						? delayMs(nextAttempt, error)
						: delayMs
			onRetry?.(error, nextAttempt, delay)
			await promiseTimeout(delay, { signal })
		}
	}
}

/** Maps with bounded concurrency; results keep input order. */
export async function pMap<T, R>(
	items: Iterable<T>,
	fn: (item: T, index: number) => Promise<R> | R,
	options: { concurrency?: number; signal?: AbortSignal } = {}
): Promise<R[]> {
	const { concurrency = Number.POSITIVE_INFINITY, signal } = options
	if (!(concurrency >= 1)) {
		throw new Error('Concurrency must be at least 1')
	}

	const list = [...items]
	const results = new Array<R>(list.length)
	let next = 0

	const worker = async () => {
		while (next < list.length) {
			signal?.throwIfAborted()
			const index = next++
			results[index] = await fn(list[index]!, index)
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(concurrency, list.length) }, worker)
	)
	return results
}

const clock = (): number => globalThis.performance?.now() ?? Date.now()

/** Starts a clock; call the returned function to read elapsed ms. */
export function startTimer(): () => number {
	const start = clock()
	return () => clock() - start
}

/** Runs `fn` and reports how long it took (throws pass through). */
export async function timed<T>(
	fn: () => Promise<T> | T
): Promise<{ result: T; durationMs: number }> {
	const elapsed = startTimer()
	const result = await fn()
	return { result, durationMs: elapsed() }
}

/**
 * Aborts when any input aborts, with that signal's `reason`. Undefined inputs
 * are skipped; no inputs gives a signal that never aborts.
 */
export function anySignal(
	...signals: (AbortSignal | undefined)[]
): AbortSignal {
	const list = signals.filter((signal) => signal !== undefined)
	if (list.length === 1) return list[0]!
	if (typeof AbortSignal.any === 'function') return AbortSignal.any(list)

	// ponytail: fallback keeps listeners on inputs until one aborts (no WeakRef).
	const controller = new AbortController()
	const aborted = list.find((signal) => signal.aborted)
	if (aborted) {
		controller.abort(aborted.reason)
		return controller.signal
	}
	const onAbort = (event: Event) => {
		for (const signal of list) signal.removeEventListener('abort', onAbort)
		controller.abort((event.target as AbortSignal).reason)
	}
	for (const signal of list) signal.addEventListener('abort', onAbort)
	return controller.signal
}

/** Aborts with a `TimeoutError` after `ms`, or earlier if `signal` aborts. */
export function timeoutSignal(ms: number, signal?: AbortSignal): AbortSignal {
	if (typeof AbortSignal.timeout === 'function') {
		return anySignal(AbortSignal.timeout(ms), signal)
	}
	const controller = new AbortController()
	setTimeout(() => {
		const reason = new Error('The operation timed out.')
		reason.name = 'TimeoutError'
		controller.abort(reason)
	}, ms)
	return anySignal(controller.signal, signal)
}

/**
 * Settles like `promise`, but rejects with `signal.reason` as soon as the
 * signal aborts. The underlying work is not cancelled.
 */
export async function raceAbort<T>(
	promise: Promise<T>,
	signal: AbortSignal | undefined
): Promise<T> {
	if (!signal) return promise
	let onAbort = () => {}
	const aborted = new Promise<never>((_, reject) => {
		onAbort = () => reject(signal.reason)
		if (signal.aborted) onAbort()
		else signal.addEventListener('abort', onAbort, { once: true })
	})
	try {
		return await Promise.race([aborted, promise])
	} finally {
		signal.removeEventListener('abort', onAbort)
	}
}

export type LatestGuard = {
	/** Starts a new generation; earlier tokens become stale. */
	next(): number
	isCurrent(token: number): boolean
	/** Marks every outstanding token stale. */
	invalidate(): void
	/** Runs `fn` under a new token; stale results and errors become `{ stale: true }`. */
	run<T>(
		fn: () => Promise<T> | T
	): Promise<{ stale: true } | { stale: false; value: T }>
}

/** Ignores results of async work superseded by a newer call. */
export function createLatestGuard(): LatestGuard {
	let current = 0
	const isCurrent = (token: number) => token === current
	return {
		next: () => ++current,
		isCurrent,
		invalidate: () => {
			current++
		},
		async run(fn) {
			const token = ++current
			try {
				const value = await fn()
				return isCurrent(token) ? { stale: false, value } : { stale: true }
			} catch (error) {
				if (!isCurrent(token)) return { stale: true }
				throw error
			}
		}
	}
}
