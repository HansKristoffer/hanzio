import { expect, test } from 'bun:test'
import { ConnectionAuthCache } from './connection-auth.js'

function bind(
	cache: ConnectionAuthCache,
	connectionId: string,
	secret = 'secret'
) {
	return cache.bind({
		connectionId,
		authInputs: [secret],
		refreshMarginMs: 10,
		exchange: async () => ({ token: secret, expiresAt: Date.now() + 10_000 })
	})
}

test('rotation retains one identity per connection, and connection growth is bounded', async () => {
	const cache = new ConnectionAuthCache(3)
	for (let generation = 0; generation < 50; generation += 1) {
		await bind(cache, 'same', String(generation)).get()
	}
	expect(cache.size).toBe(1)

	for (let connection = 0; connection < 50; connection += 1) {
		await bind(cache, String(connection)).get()
	}
	expect(cache.size).toBe(3)
})

test('clearing during a pending exchange cannot repopulate the cache', async () => {
	const cache = new ConnectionAuthCache()
	const exchange = Promise.withResolvers<{ token: string; expiresAt: number }>()
	const old = cache
		.bind({
			connectionId: 'same',
			authInputs: ['old'],
			refreshMarginMs: 10,
			exchange: () => exchange.promise
		})
		.get()
	cache.clear()
	const current = bind(cache, 'same', 'new')
	await current.get()

	exchange.resolve({ token: 'old', expiresAt: Date.now() + 10_000 })
	await old
	expect((await current.get()).token).toBe('new')
	expect(cache.size).toBe(1)
})

test('cache pressure retains pending ownership and prunes after settlement', async () => {
	const cache = new ConnectionAuthCache(1)
	const first = Promise.withResolvers<{ token: string; expiresAt: number }>()
	let exchanges = 0
	const connect = () =>
		cache.bind({
			connectionId: 'first',
			authInputs: ['first'],
			refreshMarginMs: 10,
			exchange: () => {
				exchanges += 1
				return first.promise
			}
		})
	const one = connect().get()
	await bind(cache, 'second').get()
	const two = connect().get()
	expect(exchanges).toBe(1)

	first.resolve({ token: 'first', expiresAt: Date.now() + 10_000 })
	await Promise.all([one, two])
	expect(cache.size).toBe(1)
})
