import type { RedisClient, RedisOptions } from 'bun'

export type RedisRole = 'client' | 'subscriber'

export type RedisErrorContext = {
	role: RedisRole
	stage: 'close' | 'subscribe' | 'resubscribe' | 'unsubscribe' | 'handler'
	channel?: string
}

export type ManagedRedisOptions = {
	/** Read when a connection is created, so a secret store can resolve it lazily. */
	url: string | (() => string)
	/** Every failure, for logging, metrics and error tracking. Defaults to `console.error`. */
	onError?: (error: unknown, context: RedisErrorContext) => void
	/** Builds each connection. Defaults to `new Bun.RedisClient(url, options)`. */
	createClient?: (url: string, options: RedisOptions) => RedisClient
}

export type RedisMessageHandler = (message: string, channel: string) => void

export type ManagedRedis = {
	/** The shared command connection, created on first use. */
	getClient(): RedisClient
	/**
	 * Subscribes `handler` to `channel` on the shared subscriber connection.
	 * Channels are ref-counted: Redis sees one `SUBSCRIBE` however many handlers
	 * share it, and the returned function unsubscribes when the last one leaves.
	 */
	subscribe(
		channel: string,
		handler: RedisMessageHandler
	): Promise<() => Promise<void>>
	isConnected(): boolean
	getStats(): {
		channelCount: number
		channels: string[]
		isConnected: boolean
		isSubscriberConnected: boolean
	}
	/** Closes both connections. Errors from the shutdown itself are not reported. */
	close(): void
}

/**
 * Reconnect effectively forever. Bun caps its backoff at about 2s, so a large
 * budget keeps a long-lived server reconnecting through extended outages
 * (Bun's default of 10 gives up after about 20s). Transient drops re-fire
 * `onconnect`, which resubscribes channels; `onclose` only fires on a
 * permanent close or an explicit `close()`.
 */
const CONNECTION_OPTIONS: RedisOptions = {
	autoReconnect: true,
	maxRetries: 1_000_000_000,
	enableOfflineQueue: true
}

function defaultCreateClient(url: string, options: RedisOptions) {
	return new Bun.RedisClient(url, options)
}

function defaultOnError(error: unknown, context: RedisErrorContext) {
	const channel = context.channel ? ` (${context.channel})` : ''
	console.error(
		`Redis ${context.role} ${context.stage} failed${channel}`,
		error
	)
}

/**
 * A command connection plus one shared subscriber connection for a Bun
 * server. Both reconnect on their own, and subscriptions come back after a
 * reconnect.
 *
 * @example
 * export const redis = createManagedRedis({
 *   url: () => getSecret('REDIS_URL'),
 *   onError: (error, context) => captureException(error, 'redis', context)
 * })
 * await redis.getClient().set('key', 'value')
 * const unsubscribe = await redis.subscribe('events', (message) => handle(message))
 */
export function createManagedRedis(options: ManagedRedisOptions): ManagedRedis {
	const createClient = options.createClient ?? defaultCreateClient
	const report = options.onError ?? defaultOnError
	const url = () =>
		typeof options.url === 'function' ? options.url() : options.url

	let client: RedisClient | null = null
	let subscriber: RedisClient | null = null
	const handlers = new Map<string, Set<{ handler: RedisMessageHandler }>>()
	const listeners = new Map<string, RedisMessageHandler>()
	const subscribing = new Map<string, Promise<unknown>>()

	function listenerFor(channel: string) {
		let listener = listeners.get(channel)
		if (!listener) {
			listener = (message, messageChannel) => {
				if (messageChannel !== channel) return
				for (const entry of [...(handlers.get(channel) ?? [])]) {
					try {
						entry.handler(message, channel)
					} catch (error) {
						report(error, { role: 'subscriber', stage: 'handler', channel })
					}
				}
			}
			listeners.set(channel, listener)
		}
		return listener
	}

	async function resubscribe(connection: RedisClient) {
		for (const channel of handlers.keys()) {
			try {
				await connection.subscribe(channel, listenerFor(channel))
			} catch (error) {
				report(error, { role: 'subscriber', stage: 'resubscribe', channel })
			}
		}
	}

	function getSubscriber() {
		if (subscriber) return subscriber
		const connection = createClient(url(), CONNECTION_OPTIONS)
		connection.onconnect = () => {
			void resubscribe(connection)
		}
		// close() detaches the connection first, so a deliberate close (which Bun
		// still reports as an error) returns here without being reported.
		connection.onclose = (error) => {
			if (subscriber !== connection) return
			subscriber = null
			listeners.clear()
			report(error, { role: 'subscriber', stage: 'close' })
			// A fresh connection resubscribes the remaining channels on connect.
			if (handlers.size > 0) getSubscriber()
		}
		subscriber = connection
		return connection
	}

	function getClient() {
		if (client) return client
		const connection = createClient(url(), CONNECTION_OPTIONS)
		connection.onclose = (error) => {
			if (client !== connection) return
			// Drop the dead reference so the next call builds a fresh client.
			client = null
			if (error) report(error, { role: 'client', stage: 'close' })
		}
		client = connection
		return connection
	}

	async function subscribe(channel: string, handler: RedisMessageHandler) {
		const entry = { handler }
		let entries = handlers.get(channel)
		if (!entries) {
			entries = new Set()
			handlers.set(channel, entries)
		}
		entries.add(entry)

		let pending = subscribing.get(channel)
		const first = !pending && entries.size === 1
		if (first) {
			pending = getSubscriber().subscribe(channel, listenerFor(channel))
			subscribing.set(channel, pending)
			void pending
				.catch(() => {})
				.finally(() => {
					if (subscribing.get(channel) === pending) subscribing.delete(channel)
				})
		}

		try {
			await pending
		} catch (error) {
			entries.delete(entry)
			if (entries.size === 0 && handlers.get(channel) === entries) {
				handlers.delete(channel)
				listeners.delete(channel)
			}
			if (first)
				report(error, { role: 'subscriber', stage: 'subscribe', channel })
			throw error
		}

		let left = false
		return async () => {
			if (left) return
			left = true
			const current = handlers.get(channel)
			if (!current?.delete(entry) || current.size > 0) return
			handlers.delete(channel)
			const listener = listeners.get(channel)
			listeners.delete(channel)
			const connection = subscriber
			try {
				if (listener) await connection?.unsubscribe(channel, listener)
			} catch (error) {
				// close() rejects in-flight commands; once this connection is no
				// longer current the channel is already gone.
				if (subscriber !== connection) return
				report(error, { role: 'subscriber', stage: 'unsubscribe', channel })
			}
		}
	}

	function close() {
		const connections = [client, subscriber]
		client = null
		subscriber = null
		handlers.clear()
		listeners.clear()
		subscribing.clear()
		for (const connection of connections) {
			try {
				connection?.close()
			} catch {
				// Already closed.
			}
		}
	}

	return {
		getClient,
		subscribe,
		isConnected: () => client?.connected === true,
		getStats: () => ({
			channelCount: handlers.size,
			channels: [...handlers.keys()],
			isConnected: client?.connected === true,
			isSubscriberConnected: subscriber?.connected === true
		}),
		close
	}
}
