import { createHmac, randomBytes } from 'node:crypto'
import { raceAbort } from '../promise/index.js'

export type ConnectionAuthToken = { token: string; expiresAt: number }

type Entry = {
	identity: string
	token?: ConnectionAuthToken
	pending?: Promise<ConnectionAuthToken>
}

/**
 * Shares one login per connection across every client instance in the process,
 * for APIs that exchange credentials for a short-lived token.
 *
 * - Concurrent callers share one exchange; aborting one caller's wait leaves the
 *   exchange running for the others.
 * - Changing any of `authInputs` (rotated password, new client id) retires the
 *   old token: a retired client may finish its request but cannot store its
 *   token. Inputs are kept only as an HMAC under a random per-cache key, so
 *   the cache never holds, and cannot be used to guess, the credentials.
 * - On a 401, `reject(token)` drops the refused token, unless a newer one has
 *   already replaced it, and the next `get()` exchanges again.
 * - `get({ fresh: true })` always exchanges, for an explicit credential check;
 *   its failure never falls back to the previous token.
 * - At most `maxEntries` connections are kept, least recently used first;
 *   connections with an exchange in flight are never evicted.
 *
 * @example
 * const auth = new ConnectionAuthCache()
 *
 * class ShopApi {
 *   private readonly token
 *   constructor(credentials: { connectionId: string; apiKey: string; secret: string }) {
 *     this.token = auth.bind({
 *       connectionId: credentials.connectionId,
 *       authInputs: [credentials.apiKey, credentials.secret],
 *       refreshMarginMs: 60_000,
 *       exchange: () => login(credentials) // resolves { token, expiresAt }
 *     })
 *   }
 *   async read(signal?: AbortSignal) {
 *     const current = await this.token.get({ signal })
 *     // On a 401: this.token.reject(current), then retry once with this.token.get().
 *   }
 * }
 */
export class ConnectionAuthCache {
	private readonly key = randomBytes(32)
	private readonly entries = new Map<string, Entry>()

	constructor(private readonly maxEntries = 1_000) {}

	get size() {
		return this.entries.size
	}

	clear() {
		for (const entry of this.entries.values()) entry.token = undefined
		this.entries.clear()
	}

	private prune(protectedEntry?: Entry) {
		for (const [connectionId, entry] of this.entries) {
			if (this.entries.size <= this.maxEntries) break
			// In-flight work must remain discoverable by identical callers. Its
			// ownership ends on settlement, when pruning runs again.
			if (entry.pending || entry === protectedEntry) continue
			entry.token = undefined
			this.entries.delete(connectionId)
		}
	}

	bind(input: {
		connectionId: string
		authInputs: readonly (string | number)[]
		refreshMarginMs: number
		exchange: () => Promise<ConnectionAuthToken>
	}) {
		const identity = createHmac('sha256', this.key)
			.update(JSON.stringify(input.authInputs))
			.digest('hex')
		let entry = this.entries.get(input.connectionId)

		if (!entry || entry.identity !== identity) {
			if (entry) entry.token = undefined
			entry = { identity }
		}

		// Map order is LRU. Eviction never cancels an exchange already in use.
		this.entries.delete(input.connectionId)
		this.entries.set(input.connectionId, entry)
		this.prune(entry)

		const state = entry
		const get = (options?: { fresh?: boolean; signal?: AbortSignal }) => {
			if (options?.signal?.aborted) {
				return Promise.reject<ConnectionAuthToken>(options.signal.reason)
			}

			if (this.entries.get(input.connectionId) === state) {
				this.entries.delete(input.connectionId)
				this.entries.set(input.connectionId, state)
			}

			// Aborting cancels only this wait; the exchange belongs to every waiter.
			if (state.pending) return raceAbort(state.pending, options?.signal)
			if (
				!options?.fresh &&
				state.token &&
				state.token.expiresAt - Date.now() > input.refreshMarginMs
			) {
				return Promise.resolve(state.token)
			}

			// A fresh check cannot leave the previous token usable after failure.
			state.token = undefined
			const pending = input
				.exchange()
				.then((token) => {
					if (this.entries.get(input.connectionId) === state) {
						state.token = token
					}
					return token
				})
				.finally(() => {
					if (state.pending === pending) state.pending = undefined
					this.prune()
				})
			state.pending = pending

			return raceAbort(pending, options?.signal)
		}

		return {
			get,
			reject(token: ConnectionAuthToken) {
				if (state.token === token) state.token = undefined
			}
		}
	}
}
