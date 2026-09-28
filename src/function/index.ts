type Timer = ReturnType<typeof setTimeout>

export type Debounced<A extends unknown[]> = ((...args: A) => void) & {
	/** Drops the pending call. */
	cancel(): void
	/** Runs the pending call now, if any. */
	flush(): void
	/** True while a trailing call is waiting. */
	pending(): boolean
}

/**
 * Calls `fn` with the latest args once calls stop for `waitMs` (trailing).
 * `leading` also calls on the first call of a burst; `maxWaitMs` forces a
 * call at least that often during a continuous burst.
 */
export function debounce<A extends unknown[]>(
	fn: (...args: A) => void,
	waitMs: number,
	options: { leading?: boolean; maxWaitMs?: number } = {}
): Debounced<A> {
	let timer: Timer | undefined
	let maxTimer: Timer | undefined
	let lastArgs: A | undefined

	const cancel = () => {
		clearTimeout(timer)
		clearTimeout(maxTimer)
		timer = maxTimer = lastArgs = undefined
	}
	const flush = () => {
		const args = lastArgs
		cancel()
		if (args) fn(...args)
	}

	const debounced = (...args: A) => {
		const idle = timer === undefined
		clearTimeout(timer)
		timer = setTimeout(flush, waitMs)
		if (options.maxWaitMs !== undefined && maxTimer === undefined) {
			maxTimer = setTimeout(flush, options.maxWaitMs)
		}
		if (idle && options.leading) fn(...args)
		else lastArgs = args
	}

	return Object.assign(debounced, {
		cancel,
		flush,
		pending: () => lastArgs !== undefined
	})
}

/**
 * One independent trailing debounce per key. `cancel`/`flush` without a key
 * apply to every pending key.
 */
export function keyedDebounce<K, A extends unknown[]>(
	fn: (key: K, ...args: A) => void,
	waitMs: number
): {
	call(key: K, ...args: A): void
	cancel(key?: K): void
	flush(key?: K): void
} {
	const byKey = new Map<K, Debounced<A>>()
	const each = (key: K | undefined, action: (d: Debounced<A>) => void) => {
		const targets = key === undefined ? [...byKey.values()] : [byKey.get(key)]
		for (const debounced of targets) if (debounced) action(debounced)
	}

	return {
		call(key, ...args) {
			let debounced = byKey.get(key)
			if (!debounced) {
				debounced = debounce((...latest: A) => {
					byKey.delete(key)
					fn(key, ...latest)
				}, waitMs)
				byKey.set(key, debounced)
			}
			debounced(...args)
		},
		cancel(key) {
			each(key, (debounced) => debounced.cancel())
			if (key === undefined) byKey.clear()
			else byKey.delete(key)
		},
		flush(key) {
			each(key, (debounced) => debounced.flush())
		}
	}
}

/**
 * Calls `fn` immediately, then at most once per `intervalMs`. With `trailing`
 * (default), the last call made during an interval runs when it ends.
 */
export function throttle<A extends unknown[]>(
	fn: (...args: A) => void,
	intervalMs: number,
	options: { trailing?: boolean } = {}
): ((...args: A) => void) & { cancel(): void } {
	const { trailing = true } = options
	let timer: Timer | undefined
	let trailingArgs: A | undefined

	const invoke = (args: A) => {
		timer = setTimeout(() => {
			timer = undefined
			const next = trailingArgs
			trailingArgs = undefined
			if (next) invoke(next)
		}, intervalMs)
		fn(...args)
	}

	const throttled = (...args: A) => {
		if (timer === undefined) invoke(args)
		else if (trailing) trailingArgs = args
	}

	return Object.assign(throttled, {
		cancel: () => {
			clearTimeout(timer)
			timer = trailingArgs = undefined
		}
	})
}

/** Calls `fn` on the first call only; later calls return the first result. */
export function once<A extends unknown[], R>(
	fn: (...args: A) => R
): (...args: A) => R {
	let called = false
	let result: R
	return (...args) => {
		if (!called) {
			called = true
			result = fn(...args)
		}
		return result
	}
}

export type HeartbeatOptions = {
	/** Called on the first activity, then at most once per `intervalMs`. */
	send: () => void
	/** Called once when an active heartbeat stops (idle or `stop()`). */
	onStop?: () => void
	intervalMs: number
	/** Stop after this long without `activity()`. */
	idleMs: number
	now?: () => number
	setTimeout?: (callback: () => void, ms: number) => unknown
	clearTimeout?: (timer: unknown) => void
}

/**
 * Turns bursts of activity into heartbeats (e.g. "is typing" signals): sends
 * immediately on the first activity, then at most once per `intervalMs` while
 * activity continues, and stops after `idleMs` without activity.
 */
export function createHeartbeat(options: HeartbeatOptions): {
	/** Report activity. */
	activity(): void
	/** Stop now; calls `onStop` if active. Safe to call repeatedly. */
	stop(): void
} {
	const {
		now = Date.now,
		setTimeout: schedule = (callback, ms) => setTimeout(callback, ms),
		clearTimeout: unschedule = (timer) => clearTimeout(timer as Timer)
	} = options
	let active = false
	let lastSentAt = 0
	let idleTimer: unknown

	const stop = () => {
		if (idleTimer !== undefined) unschedule(idleTimer)
		idleTimer = undefined
		if (!active) return
		active = false
		options.onStop?.()
	}

	return {
		activity() {
			const time = now()
			if (!active || time - lastSentAt >= options.intervalMs) {
				active = true
				lastSentAt = time
				options.send()
			}
			if (idleTimer !== undefined) unschedule(idleTimer)
			idleTimer = schedule(stop, options.idleMs)
		},
		stop
	}
}
