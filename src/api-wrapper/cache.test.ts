import { afterEach, describe, expect, test } from 'bun:test'
import { createApiClient, defineAction, ActionError } from '.'
import { originalFetch } from './test-helpers'

describe('createApiClient — action cache', () => {
	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	test('ctx.cache de-dupes concurrent callers and memoizes the value', async () => {
		let fnCalls = 0
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			endpoints: {},
			actions: {
				get: defineAction({
					handler: ({ cache }) =>
						cache('k', async () => {
							fnCalls++
							await new Promise((r) => setTimeout(r, 10))
							return 'value'
						})
				})
			}
		})

		const [a, b, c] = await Promise.all([api.get(), api.get(), api.get()])
		expect([a, b, c]).toEqual(['value', 'value', 'value'])
		expect(fnCalls).toBe(1)

		const d = await api.get()
		expect(d).toBe('value')
		expect(fnCalls).toBe(1)
	})

	test('ctx.cache.invalidate forces re-fetch and rejection is not cached', async () => {
		let attempt = 0
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			endpoints: {},
			actions: {
				get: defineAction({
					handler: ({ cache }) =>
						cache('k', () => {
							attempt++
							if (attempt === 1) throw new Error('boom')
							return `ok-${attempt}`
						})
				}),
				bust: defineAction({
					handler: ({ cache }) => {
						cache.invalidate('k')
						return true
					}
				})
			}
		})

		await expect(api.get()).rejects.toThrow(ActionError)
		const v1 = await api.get()
		expect(v1).toBe('ok-2')
		const v2 = await api.get()
		expect(v2).toBe('ok-2')
		expect(attempt).toBe(2)

		await api.bust()
		const v3 = await api.get()
		expect(v3).toBe('ok-3')
		expect(attempt).toBe(3)
	})

	test('ctx.cache ttlMs evicts entries lazily', async () => {
		let fnCalls = 0
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			endpoints: {},
			actions: {
				get: defineAction({
					handler: ({ cache }) =>
						cache(
							'k',
							() => {
								fnCalls++
								return fnCalls
							},
							{ ttlMs: 5 }
						)
				})
			}
		})

		expect(await api.get()).toBe(1)
		expect(await api.get()).toBe(1)
		await new Promise((r) => setTimeout(r, 15))
		expect(await api.get()).toBe(2)
	})

	test('the same cache is shared between two different actions', async () => {
		let writes = 0
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			endpoints: {},
			actions: {
				write: defineAction({
					handler: ({ cache }) =>
						cache('shared', () => {
							writes++
							return 'v'
						})
				}),
				read: defineAction({
					handler: ({ cache }) =>
						cache('shared', () => {
							writes++
							return 'should-not-run'
						})
				})
			}
		})

		await api.write()
		const read = await api.read()
		expect(read).toBe('v')
		expect(writes).toBe(1)
	})
})
