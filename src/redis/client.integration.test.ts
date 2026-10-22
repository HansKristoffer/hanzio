import { describe, expect, test } from 'bun:test'
import { createManagedRedis } from './client.js'

describe.skipIf(
	!process.env.REDIS_URL || process.env.RUN_INTEGRATION_TESTS !== '1'
)('managed Redis on a real server', () => {
	test('delivers a published message to a subscribed handler', async () => {
		const redis = createManagedRedis({ url: process.env.REDIS_URL! })
		const channel = `managed-redis-test:${crypto.randomUUID()}`
		const received = Promise.withResolvers<string>()
		try {
			const leave = await redis.subscribe(channel, received.resolve)
			await redis.getClient().publish(channel, 'hello')
			expect(await received.promise).toBe('hello')
			await leave()
			expect(redis.getStats().channelCount).toBe(0)
		} finally {
			redis.close()
		}
	})
})
