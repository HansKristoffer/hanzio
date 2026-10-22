import { describe, expect, test } from 'bun:test'
import { RedisClient } from 'bun'
import { createRedisConcurrencyLimit } from './concurrency-limit.js'

describe.skipIf(
	!process.env.REDIS_URL || process.env.RUN_INTEGRATION_TESTS !== '1'
)('fleet admission on Redis', () => {
	test('separate worker limiters share capacity, renew held slots, and drain cancelled admission', async () => {
		const redis = new RedisClient(process.env.REDIS_URL)
		const key = `knowledge-admission-test:${crypto.randomUUID()}`
		const makeLimit = () =>
			createRedisConcurrencyLimit({
				key,
				max: 1,
				slotTtlMs: 300,
				send: (command, args) => redis.send(command, args)
			})
		const first = makeLimit()
		const second = makeLimit()
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		let calls = 0
		const holding = first(async () => {
			entered.resolve()
			await release.promise
		})
		await entered.promise
		const controller = new AbortController()
		const waiting = second(async () => {
			calls++
		}, controller.signal)
		try {
			await Bun.sleep(450)
			expect(calls).toBe(0)
			controller.abort(new Error('cancelled admission'))
			await expect(
				Promise.race([
					waiting,
					Bun.sleep(100).then(() => {
						throw new Error('abort did not stop admission')
					})
				])
			).rejects.toThrow('cancelled admission')
		} finally {
			release.resolve()
			await holding
			await waiting.catch(() => {})
		}
		try {
			await second(async () => {
				calls++
			})
			expect(calls).toBe(1)
			await Bun.sleep(150)
			expect(await redis.send('ZCARD', [`{${key}}:inflight`])).toBe(0)
		} finally {
			first.dispose()
			second.dispose()
			await redis.send('DEL', [
				`{${key}}:inflight`,
				`{${key}}:cooldown`,
				`{${key}}:starts`
			])
			redis.close()
		}
	})

	test('one worker cooldown prevents starts on another worker', async () => {
		const redis = new RedisClient(process.env.REDIS_URL)
		const key = `knowledge-cooldown-test:${crypto.randomUUID()}`
		const makeLimit = () =>
			createRedisConcurrencyLimit({
				key,
				max: 2,
				slotTtlMs: 1000,
				send: (command, args) => redis.send(command, args)
			})
		const first = makeLimit()
		const second = makeLimit()
		try {
			await first.tripCooldown(250)
			let started = false
			const running = second(async () => {
				started = true
			})
			await Bun.sleep(100)
			expect(started).toBe(false)
			await running
			expect(started).toBe(true)
		} finally {
			first.dispose()
			second.dispose()
			await redis.send('DEL', [
				`{${key}}:inflight`,
				`{${key}}:cooldown`,
				`{${key}}:starts`
			])
			redis.close()
		}
	})
})
