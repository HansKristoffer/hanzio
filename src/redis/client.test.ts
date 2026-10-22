import { describe, expect, mock, test } from 'bun:test'
import type { RedisClient } from 'bun'
import { createManagedRedis, type RedisMessageHandler } from './client.js'

/** A connection whose `unsubscribe` stays pending until settled or `close()` rejects it. */
function fakeConnection() {
	const listeners = new Map<string, RedisMessageHandler>()
	let rejectUnsubscribe: (error: Error) => void = () => {}
	const connection = {
		connected: true,
		onconnect: null as (() => void) | null,
		onclose: null as ((error: Error) => void) | null,
		subscribeCalls: 0,
		failSubscribe: null as Error | null,
		async subscribe(channel: string, listener: RedisMessageHandler) {
			connection.subscribeCalls++
			if (connection.failSubscribe) throw connection.failSubscribe
			listeners.set(channel, listener)
			return 1
		},
		unsubscribe(channel: string) {
			return new Promise<void>((resolve, reject) => {
				rejectUnsubscribe = reject
				listeners.delete(channel)
				if (!connection.holdUnsubscribe) resolve()
			})
		},
		holdUnsubscribe: false,
		close() {
			rejectUnsubscribe(new Error('Connection closed'))
			connection.onclose?.(new Error('Connection closed'))
		},
		failUnsubscribe: (error: Error) => rejectUnsubscribe(error),
		publish: (channel: string, message: string) =>
			listeners.get(channel)?.(message, channel),
		listeners
	}
	return connection
}

function setup() {
	const connections: ReturnType<typeof fakeConnection>[] = []
	const onError = mock((_error: unknown, _context: unknown) => {})
	const redis = createManagedRedis({
		url: 'redis://test',
		onError,
		createClient: () => {
			const connection = fakeConnection()
			connections.push(connection)
			return connection as unknown as RedisClient
		}
	})
	return { redis, connections, onError }
}

describe('createManagedRedis', () => {
	test('shares one SUBSCRIBE per channel and fans messages out', async () => {
		const { redis, connections } = setup()
		const first = mock(() => {})
		const second = mock(() => {})
		const leaveFirst = await redis.subscribe('events', first)
		const leaveSecond = await redis.subscribe('events', second)
		const subscriber = connections[0]!

		subscriber.publish('events', 'hello')
		expect(subscriber.subscribeCalls).toBe(1)
		expect(first).toHaveBeenCalledWith('hello', 'events')
		expect(second).toHaveBeenCalledWith('hello', 'events')

		await leaveFirst()
		expect(subscriber.listeners.has('events')).toBe(true)
		await leaveSecond()
		expect(subscriber.listeners.has('events')).toBe(false)
		expect(redis.getStats().channelCount).toBe(0)
	})

	test('resubscribes every channel when the subscriber reconnects', async () => {
		const { redis, connections } = setup()
		await redis.subscribe('a', () => {})
		await redis.subscribe('b', () => {})
		const subscriber = connections[0]!
		subscriber.listeners.clear()

		subscriber.onconnect?.()
		await Bun.sleep(0)
		expect([...subscriber.listeners.keys()]).toEqual(['a', 'b'])
	})

	test('rejects and cleans up when SUBSCRIBE fails', async () => {
		const failure = new Error('ERR denied')
		const onError = mock((_error: unknown, _context: unknown) => {})
		const redis = createManagedRedis({
			url: 'redis://test',
			onError,
			createClient: () => {
				const connection = fakeConnection()
				connection.failSubscribe = failure
				return connection as unknown as RedisClient
			}
		})

		await expect(redis.subscribe('events', () => {})).rejects.toBe(failure)
		expect(redis.getStats().channelCount).toBe(0)
		expect(onError).toHaveBeenCalledWith(failure, {
			role: 'subscriber',
			stage: 'subscribe',
			channel: 'events'
		})
	})

	test('does not report an in-flight unsubscribe rejected by close()', async () => {
		const { redis, connections, onError } = setup()
		const leave = await redis.subscribe('events', () => {})
		connections[0]!.holdUnsubscribe = true

		const leaving = leave()
		redis.close()
		await leaving

		expect(onError).not.toHaveBeenCalled()
	})

	test('reports an unsubscribe failure while the connection is still current', async () => {
		const { redis, connections, onError } = setup()
		const leave = await redis.subscribe('events', () => {})
		connections[0]!.holdUnsubscribe = true

		const leaving = leave()
		connections[0]!.failUnsubscribe(new Error('ERR unknown'))
		await leaving

		expect(onError).toHaveBeenCalledTimes(1)
	})

	test('reports an unexpected subscriber close and reconnects its channels', async () => {
		const { redis, connections, onError } = setup()
		await redis.subscribe('events', () => {})

		connections[0]!.onclose?.(new Error('retries exhausted'))
		expect(onError).toHaveBeenCalledTimes(1)
		expect(connections).toHaveLength(2)

		connections[1]!.onconnect?.()
		await Bun.sleep(0)
		expect(connections[1]!.listeners.has('events')).toBe(true)
	})

	test('a dropped command client is rebuilt on next use', () => {
		const { redis, connections, onError } = setup()
		const first = redis.getClient()
		connections[0]!.onclose?.(new Error('retries exhausted'))

		expect(redis.getClient()).not.toBe(first)
		expect(onError).toHaveBeenCalledWith(expect.any(Error), {
			role: 'client',
			stage: 'close'
		})
	})
})
