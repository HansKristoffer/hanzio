export type Listener<P> = (payload: P) => void

/** Payload is optional for events typed `void` or `undefined`. */
export type EmitArgs<P> = undefined extends P ? [payload?: P] : [payload: P]

export type Emitter<Events extends Record<string, unknown>> = {
	/** Adds a listener; returns an unsubscribe function. */
	on<K extends keyof Events>(
		event: K,
		listener: Listener<Events[K]>
	): () => void
	/** Like `on`, but removed before its first call. */
	once<K extends keyof Events>(
		event: K,
		listener: Listener<Events[K]>
	): () => void
	off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void
	/**
	 * Calls every listener, even if some throw, then rethrows the error (or an
	 * `AggregateError` if several threw). Listeners added during an emit wait
	 * for the next one; listeners removed during an emit are skipped.
	 */
	emit<K extends keyof Events>(event: K, ...args: EmitArgs<Events[K]>): void
	/** Removes all listeners for `event`, or for every event. */
	clear(event?: keyof Events): void
	listenerCount(event: keyof Events): number
}

/** Typed event emitter. Adding the same listener twice keeps one entry. */
export function createEmitter<
	Events extends Record<string, unknown>
>(): Emitter<Events> {
	// listener -> registered with `once`
	const listeners = new Map<keyof Events, Map<Listener<unknown>, boolean>>()

	const add = (
		event: keyof Events,
		listener: Listener<never>,
		once: boolean
	) => {
		const map = listeners.get(event) ?? new Map()
		listeners.set(event, map)
		map.set(listener as Listener<unknown>, once)
		return () => {
			map.delete(listener as Listener<unknown>)
		}
	}

	return {
		on: (event, listener) => add(event, listener, false),
		once: (event, listener) => add(event, listener, true),
		off(event, listener) {
			listeners.get(event)?.delete(listener as Listener<unknown>)
		},
		emit(event, ...[payload]) {
			const map = listeners.get(event)
			if (!map) return
			const errors: unknown[] = []
			for (const [listener, once] of [...map]) {
				if (!map.has(listener)) continue
				if (once) map.delete(listener)
				try {
					listener(payload)
				} catch (error) {
					errors.push(error)
				}
			}
			if (errors.length === 1) throw errors[0]
			if (errors.length > 1) {
				throw new AggregateError(
					errors,
					`${errors.length} listeners threw for "${String(event)}"`
				)
			}
		},
		clear(event) {
			if (event === undefined) listeners.clear()
			else listeners.delete(event)
		},
		listenerCount: (event) => listeners.get(event)?.size ?? 0
	}
}
