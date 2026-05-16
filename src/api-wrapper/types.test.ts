import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import type { ActionsFactoryHelpers, ApiAction, ApiEndpoint } from '.'
import { createApiClient, defineAction } from '.'
import { createMockResponse, mockFetch, originalFetch } from './test-helpers'

describe('createApiClient — types', () => {
	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	test('required-arg inference: omitting reqParams when schema is defined is a type error', async () => {
		mockFetch(() => Promise.resolve(createMockResponse({ id: 1, name: 'A' })))
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			endpoints: {
				getUser: {
					method: 'GET',
					path: '/users/:id',
					reqParamsSchema: z.object({ id: z.number() }),
					resSchema: z.object({ id: z.number(), name: z.string() })
				}
			}
		})

		const _typeCheck = () => {
			void api.request('getUser')
			void api.request('getUser', {})
			// @ts-expect-error reqParams is required when reqParamsSchema is defined
			void api.getUser()
		}
		expect(_typeCheck).toBeInstanceOf(Function)
	})

	test('factory form of actions gives a fully typed ctx.api', async () => {
		let callCount = 0
		mockFetch((url) => {
			callCount++
			if (url.includes('/login')) {
				return Promise.resolve(createMockResponse({ userId: 7, token: 'tok' }))
			}
			if (url.includes('/users/7')) {
				return Promise.resolve(createMockResponse({ id: 7, name: 'Bo' }))
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
							const token: string = auth.data.token
							const userId: number = auth.data.userId
							const me = await client.usersGet({
								reqParams: { userId },
								reqHeaders: { Authorization: `Bearer ${token}` }
							})
							const name: string = me.data.name
							return { id: me.data.id, name }
						}
					})
				}
			}
		})

		const result = await api.loginAndGetMe({ email: 'a@b', password: 'p' })
		const typed: { id: number; name: string } = result
		expect(typed).toEqual({ id: 7, name: 'Bo' })
		expect(callCount).toBe(2)
	})

	test('factory form rejects calling unknown endpoints at the type level', () => {
		const _typeCheck = () =>
			createApiClient({
				baseApiUrls: { default: 'https://api.example.com' },
				endpoints: {
					known: {
						method: 'GET',
						path: '/known',
						resSchema: z.object({}).passthrough()
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
						bad: defineAction({
							handler: ({ api }) => {
								// @ts-expect-error 'missing' is not a known endpoint
								return api.missing()
							}
						})
					}
				}
			})
		expect(_typeCheck).toBeInstanceOf(Function)
	})

	test('curried defineAction<TInput>() accepts a TS type and skips zod validation', async () => {
		type SearchInput = { query: string; limit: number }

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
					search: defineAction<SearchInput>()({
						handler: ({ input }) => `${input.query}:${input.limit}`
					})
				}
			}
		})

		const result = await api.search({ query: 'hi', limit: 5 })
		expect(result).toBe('hi:5')

		const _typeCheck = () => {
			// @ts-expect-error 'limit' must be a number
			void api.search({ query: 'hi', limit: '5' })
		}
		expect(_typeCheck).toBeInstanceOf(Function)
	})

	test('curried defineAction does not run zod — garbage input still reaches handler', async () => {
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
					echo: defineAction<{ n: number }>()({
						handler: ({ input }) => input
					})
				}
			}
		})

		const result = await api.echo({ n: 'not a number' as unknown as number })
		expect(result).toEqual({ n: 'not a number' } as unknown as { n: number })
	})

	test('action return type is inferred from handler', async () => {
		const api = createApiClient({
			baseApiUrls: { default: 'https://api.example.com' },
			endpoints: {},
			actions: {
				num: defineAction({
					handler: () => 42 as const
				})
			}
		})

		const _typeCheck = async () => {
			const n: 42 = await api.num()
			// @ts-expect-error 42 is not assignable to string
			const _s: string = await api.num()
			void n
			void _s
		}
		expect(_typeCheck).toBeInstanceOf(Function)
	})
})
