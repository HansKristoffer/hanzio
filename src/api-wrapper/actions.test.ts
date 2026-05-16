import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import type { ActionsFactoryHelpers, ApiAction, ApiEndpoint } from '.'
import {
	ActionError,
	ConfigError,
	createApiClient,
	defineAction,
	HttpResponseError,
	RequestAbortedError
} from '.'
import { createMockResponse, mockFetch, originalFetch } from './test-helpers'

describe('createApiClient — actions', () => {
	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	test('actions compose multiple endpoint calls and return handler output', async () => {
		let callCount = 0
		mockFetch((url) => {
			callCount++
			if (url.includes('/login')) {
				return Promise.resolve(
					createMockResponse({ userId: 42, token: 'tok-abc' })
				)
			}
			if (url.includes('/users/42')) {
				return Promise.resolve(createMockResponse({ id: 42, name: 'Ada' }))
			}
			return Promise.reject(new Error(`unexpected ${url}`))
		})

		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			endpoints: {
				login: {
					method: 'POST',
					path: '/login',
					reqBodyFormat: 'json',
					reqBodySchema: z.object({
						email: z.string(),
						password: z.string()
					}),
					resSchema: z.object({ userId: z.number(), token: z.string() })
				},
				usersGet: {
					method: 'GET',
					path: '/users/:userId',
					reqParamsSchema: z.object({ userId: z.number() }),
					resSchema: z.object({ id: z.number(), name: z.string() })
				}
			},
			actions: (
				helpers: ActionsFactoryHelpers<
					Record<string, ApiEndpoint>,
					Record<string, ApiAction>
				>
			) => {
				const { defineAction } = helpers
				return {
					loginAndGetMe: defineAction<{
						email: string
						password: string
					}>()({
						handler: async ({ input, api }) => {
							// biome-ignore lint/suspicious/noExplicitAny: factory uses generic Record<> endpoints; narrow for test
							const client = api as any
							const auth = await client.login({ reqBody: input })
							const me = await client.usersGet({
								reqParams: { userId: auth.data.userId },
								reqHeaders: { Authorization: `Bearer ${auth.data.token}` }
							})
							return { id: me.data.id, displayName: me.data.name.toUpperCase() }
						}
					})
				}
			}
		})

		const result = await api.loginAndGetMe({
			email: 'a@b.c',
			password: 'pw'
		})
		const typed: { id: number; displayName: string } = result
		expect(typed).toEqual({ id: 42, displayName: 'ADA' })
		expect(callCount).toBe(2)
	})

	test('actions can be invoked via api.request as well', async () => {
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			endpoints: {},
			actions: (
				helpers: ActionsFactoryHelpers<
					Record<string, ApiEndpoint>,
					Record<string, ApiAction>
				>
			) => {
				const { defineAction } = helpers
				return {
					greet: defineAction<{ name: string }>()({
						handler: ({ input }) => `hello ${input.name}`
					})
				}
			}
		})

		const greeting = await api.request('greet', { name: 'Ada' })
		expect(greeting).toBe('hello Ada')
	})

	test('action input is TS-only — no runtime validation', async () => {
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			endpoints: {},
			actions: (
				helpers: ActionsFactoryHelpers<
					Record<string, ApiEndpoint>,
					Record<string, ApiAction>
				>
			) => {
				const { defineAction } = helpers
				return {
					greet: defineAction<{ name: string }>()({
						handler: ({ input }) => `hello ${input.name}`
					})
				}
			}
		})

		const _typeCheck = () => {
			// @ts-expect-error name must be a string
			void api.greet({ name: 123 })
		}
		expect(_typeCheck).toBeInstanceOf(Function)

		// Runtime: no validation, so bad input still reaches the handler.
		const out = await api.greet({ name: 123 as unknown as string })
		expect(out).toBe('hello 123')
	})

	test("action's signal propagates and cancels inner endpoint calls", async () => {
		mockFetch(
			(_url, options) =>
				new Promise((_resolve, reject) => {
					options?.signal?.addEventListener('abort', () => {
						const e = new Error('aborted')
						e.name = 'AbortError'
						reject(e)
					})
				})
		)

		const controller = new AbortController()
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			retries: 0,
			endpoints: {
				get: {
					method: 'GET',
					path: '/x',
					resSchema: z.object({}).passthrough()
				}
			},
			actions: {
				run: defineAction({
					handler: ({ api, signal }) => api.get({ signal })
				})
			}
		})

		const promise = api.run({ signal: controller.signal })
		setTimeout(() => controller.abort(), 5)
		await expect(promise).rejects.toBeInstanceOf(RequestAbortedError)
	})

	test('action name colliding with endpoint name throws ConfigError', () => {
		expect(() =>
			createApiClient({
				baseApiUrls: { default: 'https://api.example.com' },
				endpoints: {
					same: {
						method: 'GET',
						path: '/x',
						resSchema: z.object({}).passthrough()
					}
				},
				actions: {
					same: defineAction({ handler: () => 'oops' })
				}
			})
		).toThrow(ConfigError)
	})

	test('non-ApiError thrown by handler is wrapped in ActionError; ApiError passes through', async () => {
		mockFetch(() =>
			Promise.resolve(createMockResponse({ error: 'no' }, { status: 404 }))
		)

		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			retries: 0,
			endpoints: {
				thing: {
					method: 'GET',
					path: '/thing',
					resSchema: z.object({}).passthrough()
				}
			},
			actions: {
				boom: defineAction({
					handler: () => {
						throw new Error('plain error')
					}
				}),
				fwd: defineAction({
					handler: ({ api }) => api.thing()
				})
			}
		})

		await expect(api.boom()).rejects.toBeInstanceOf(ActionError)
		await expect(api.fwd()).rejects.toBeInstanceOf(HttpResponseError)
	})
})
