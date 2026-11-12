import { describe, expect, mock, test } from 'bun:test'
import type { RedisClient, RedisOptions } from 'bun'
import { createManagedRedis, type RedisMessageHandler } from './client'
import { createLuaScript, RedisUnavailableError } from './lua-script'

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
		sent: [] as [string, string[]][],
		reply: (async () => 'OK') as () => Promise<unknown>,
		send(command: string, args: string[]) {
			connection.sent.push([command, args])
			return connection.reply()
		},
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

	test('reports a subscriber close without an error as an Error', async () => {
		const { redis, connections, onError } = setup()
		await redis.subscribe('events', () => {})

		;(connections[0]!.onclose as (error?: Error) => void)(undefined)
		expect(onError).toHaveBeenCalledWith(expect.any(Error), {
			role: 'subscriber',
			stage: 'close'
		})
	})
})

describe('createManagedRedis send', () => {
	function withOptions(
		options: { commandTimeoutMs?: number; offlineQueue?: boolean } = {}
	) {
		const connections: ReturnType<typeof fakeConnection>[] = []
		const created: RedisOptions[] = []
		const redis = createManagedRedis({
			url: 'redis://test',
			onError: () => {},
			...options,
			createClient: (_url, connectionOptions) => {
				const connection = fakeConnection()
				connections.push(connection)
				created.push(connectionOptions)
				return connection as unknown as RedisClient
			}
		})
		return { redis, connections, created }
	}

	test('sends one raw command on the command connection', async () => {
		const { redis, connections } = withOptions()
		expect(await redis.send('INCR', ['visits'])).toBe('OK')
		expect(connections[0]!.sent).toEqual([['INCR', ['visits']]])
	})

	test('fits createLuaScript as its send', async () => {
		const { redis, connections } = withOptions()
		await createLuaScript(redis.send, 'return 1')([], [])
		expect(connections[0]!.sent.map(([command]) => command)).toEqual([
			'SCRIPT',
			'EVALSHA'
		])
	})

	test('rejects with RedisUnavailableError after commandTimeoutMs', async () => {
		const { redis, connections } = withOptions({ commandTimeoutMs: 20 })
		redis.getClient()
		connections[0]!.reply = () => new Promise(() => {})

		const sent = redis.send('GET', ['key'])
		await expect(sent).rejects.toBeInstanceOf(RedisUnavailableError)
		await expect(sent).rejects.toThrow('Redis GET timed out after 20ms')
	})

	test('rejects an invalid commandTimeoutMs', () => {
		for (const commandTimeoutMs of [0, -1, Number.NaN, Infinity]) {
			expect(() => withOptions({ commandTimeoutMs })).toThrow(
				`commandTimeoutMs must be a positive finite number, got ${commandTimeoutMs}`
			)
		}
	})

	test('offlineQueue: false applies to the command connection only', async () => {
		const { redis, created } = withOptions({ offlineQueue: false })
		redis.getClient()
		await redis.subscribe('events', () => {})
		expect(created.map((options) => options.enableOfflineQueue)).toEqual([
			false,
			true
		])
	})

	test('offlineQueue defaults to true', () => {
		const { redis, created } = withOptions()
		redis.getClient()
		expect(created[0]!.enableOfflineQueue).toBe(true)
	})
})
