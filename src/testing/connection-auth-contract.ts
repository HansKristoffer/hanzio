// Bun types `clone()` as the undici Response; it is the same runtime object.
const cloneResponse = (response: Response) => response.clone() as Response

export type ConnectionAuthContractInput = {
	reset: () => void
	create: (
		fetchImpl: typeof fetch,
		variant?: string
	) => {
		read: () => Promise<unknown>
		login: (options?: { signal?: AbortSignal }) => Promise<string>
	}
	identityChanges: string[]
	isLogin: (url: string) => boolean
	loginResponse: (token: string) => Response
	readResponse: () => Response
	tokenHeader: string
}

/**
 * Registers the races every client built on `ConnectionAuthCache`
 * (`hanzio/api-wrapper/connection-auth`) must survive, run through the real
 * client and its transport: shared refreshes, rotated credentials, late 401s,
 * aborted waiters and failed fresh logins. Await it at the top level of a
 * `bun:test` file.
 *
 * - `create(fetch, variant)` builds a client on the given fetch. `variant` is
 *   one of `identityChanges` (a credential change that must force a new login),
 *   `'settings'` (a non-auth setting that must reuse the login), `'connection'`
 *   (another connection) or `'secret'` (a rotated secret).
 * - `read()` makes one authenticated request; on a 401 it calls `reject` and
 *   retries once. `login()` forces a fresh login and resolves its token.
 * - `reset()` clears the cache between tests.
 * - `tokenHeader` is where requests carry the token; `'authorization'` means
 *   `Bearer <token>`.
 *
 * @example
 * await connectionAuthContract({
 *   reset: () => authCache.clear(),
 *   create: (fetch, variant) => new ShopApi(credentialsFor(variant), fetch),
 *   identityChanges: ['apiKey', 'secret'],
 *   isLogin: (url) => url.endsWith('/oauth/token'),
 *   loginResponse: (token) => Response.json({ access_token: token, expires_in: 3600 }),
 *   readResponse: () => Response.json({ items: [] }),
 *   tokenHeader: 'authorization'
 * })
 */
export async function connectionAuthContract(
	input: ConnectionAuthContractInput
): Promise<void> {
	const { beforeEach, describe, expect, test } = await import('bun:test')
	describe('shared authentication contract', () => {
		beforeEach(input.reset)

		function provider(
			respond: (
				login: boolean,
				init: RequestInit
			) => Promise<Response> | Response
		) {
			let exchanges = 0
			const usedTokens: (string | null)[] = []
			const fetchImpl = (async (url, init) => {
				const login = input.isLogin(String(url))
				if (login) exchanges += 1
				else usedTokens.push(new Headers(init?.headers).get(input.tokenHeader))
				return respond(login, init ?? {})
			}) as typeof fetch

			return { fetchImpl, usedTokens, exchanges: () => exchanges }
		}

		test.each(
			input.identityChanges
		)('%s changes authentication identity', async (variant) => {
			const fake = provider((login) =>
				login
					? input.loginResponse(`token-${fake.exchanges()}`)
					: input.readResponse()
			)
			await input.create(fake.fetchImpl).read()
			await input.create(fake.fetchImpl, variant).read()

			expect(fake.exchanges()).toBe(2)
			expect(fake.usedTokens[1]).not.toBe(fake.usedTokens[0])
		})

		test('non-auth settings reuse completed authentication across instances', async () => {
			const fake = provider((login) =>
				login ? input.loginResponse('same') : input.readResponse()
			)
			await input.create(fake.fetchImpl).read()
			await input.create(fake.fetchImpl, 'settings').read()

			expect(fake.exchanges()).toBe(1)
		})

		test('unrelated connections proceed while another login is blocked', async () => {
			const pending = Promise.withResolvers<Response>()
			const fake = provider((login) => {
				if (!login) return input.readResponse()
				return fake.exchanges() === 1
					? pending.promise
					: input.loginResponse('independent')
			})
			const blocked = input.create(fake.fetchImpl).read()
			await input.create(fake.fetchImpl, 'connection').read()
			expect(fake.exchanges()).toBe(2)

			pending.resolve(input.loginResponse('blocked'))
			await blocked
		})

		test('failed shared refresh is evicted and a later attempt recovers', async () => {
			const pending = Promise.withResolvers<Response>()
			const fake = provider((login) =>
				login ? pending.promise.then(cloneResponse) : input.readResponse()
			)
			const results = Promise.allSettled(
				Array.from({ length: 3 }, () => input.create(fake.fetchImpl).read())
			)
			pending.reject(new Error('provider unavailable'))
			expect((await results).map((result) => result.status)).toEqual([
				'rejected',
				'rejected',
				'rejected'
			])
			expect(fake.exchanges()).toBe(1)

			const recovered = provider((login) =>
				login ? input.loginResponse('recovered') : input.readResponse()
			)
			await input.create(recovered.fetchImpl).read()
			expect(recovered.exchanges()).toBe(1)
		})

		test('simultaneous 401s share one refresh, and a delayed 401 cannot evict it', async () => {
			const rejected = Array.from({ length: 3 }, () =>
				Promise.withResolvers<Response>()
			)
			const requestsStarted = Promise.withResolvers<void>()
			const refresh = Promise.withResolvers<Response>()
			let oldRequests = 0
			const fake = provider((login, init) => {
				if (login)
					return fake.exchanges() === 1
						? input.loginResponse('A')
						: refresh.promise.then(cloneResponse)
				const header = new Headers(init.headers).get(input.tokenHeader)
				if (
					header === (input.tokenHeader === 'authorization' ? 'Bearer A' : 'A')
				) {
					const response = rejected[oldRequests++]!
					if (oldRequests === 3) requestsStarted.resolve()
					return response.promise
				}
				return input.readResponse()
			})
			await input.create(fake.fetchImpl).login()
			const reads = Array.from({ length: 3 }, () =>
				input.create(fake.fetchImpl).read()
			)
			await requestsStarted.promise

			rejected[0]!.resolve(new Response('', { status: 401 }))
			rejected[1]!.resolve(new Response('', { status: 401 }))
			refresh.resolve(input.loginResponse('B'))
			await Promise.all(reads.slice(0, 2))
			rejected[2]!.resolve(new Response('', { status: 401 }))
			await reads[2]

			expect(fake.exchanges()).toBe(2)
			expect(fake.usedTokens).toHaveLength(6)
			expect(fake.usedTokens.slice(3)).toEqual(
				Array(3).fill(input.tokenHeader === 'authorization' ? 'Bearer B' : 'B')
			)
		})

		test('a delayed 401 cannot evict a new generation with identical token bytes', async () => {
			const rejected = Promise.withResolvers<Response>()
			const started = Promise.withResolvers<void>()
			let reads = 0
			const fake = provider((login) => {
				if (login) return input.loginResponse('same')
				reads += 1
				if (reads === 1) {
					started.resolve()
					return rejected.promise
				}
				return input.readResponse()
			})
			await input.create(fake.fetchImpl).login()
			const oldRead = input.create(fake.fetchImpl).read()
			await started.promise
			await input.create(fake.fetchImpl).login()
			rejected.resolve(new Response('', { status: 401 }))
			await oldRead

			expect(fake.exchanges()).toBe(2)
			expect(reads).toBe(2)
		})

		test('failed fresh authentication cannot fall back to the previous completed token', async () => {
			const fake = provider((login) => {
				if (!login) return input.readResponse()
				if (fake.exchanges() === 2) throw new Error('credentials rejected')
				return input.loginResponse('valid')
			})
			await input.create(fake.fetchImpl).read()
			await expect(input.create(fake.fetchImpl).login()).rejects.toThrow(
				'credentials rejected'
			)
			await input.create(fake.fetchImpl).read()

			expect(fake.exchanges()).toBe(3)
		})

		test('a late old login cannot replace rotated authentication', async () => {
			const pending = Promise.withResolvers<Response>()
			const fake = provider((login) => {
				if (!login) return input.readResponse()
				return fake.exchanges() === 1
					? pending.promise
					: input.loginResponse('new')
			})
			const old = input.create(fake.fetchImpl).read()
			await input.create(fake.fetchImpl, 'secret').read()
			pending.resolve(input.loginResponse('old'))
			await old
			await input.create(fake.fetchImpl, 'secret').read()

			expect(fake.exchanges()).toBe(2)
			expect(fake.usedTokens.at(-1)).toBe(
				input.tokenHeader === 'authorization' ? 'Bearer new' : 'new'
			)
		})

		test('fresh logins bypass completed tokens and coalesce identical pending checks', async () => {
			const pending = Promise.withResolvers<Response>()
			const fake = provider((login) => {
				if (!login) return input.readResponse()
				return fake.exchanges() === 1
					? input.loginResponse('warm')
					: pending.promise.then(cloneResponse)
			})
			await input.create(fake.fetchImpl).read()
			const checks = Array.from({ length: 3 }, () =>
				input.create(fake.fetchImpl).login()
			)
			expect(fake.exchanges()).toBe(2)
			pending.resolve(input.loginResponse('fresh'))
			expect(await Promise.all(checks)).toEqual(['fresh', 'fresh', 'fresh'])
		})

		test('aborting the initiating waiter leaves the shared refresh running', async () => {
			const pending = Promise.withResolvers<Response>()
			const fake = provider((login, init) => {
				if (!login) return input.readResponse()
				expect(init.signal).toBeUndefined()
				return pending.promise
			})
			const controller = new AbortController()
			const cancelled = input
				.create(fake.fetchImpl)
				.login({ signal: controller.signal })
			const survivor = input.create(fake.fetchImpl).read()
			controller.abort(new Error('wait cancelled'))
			await expect(cancelled).rejects.toThrow('wait cancelled')

			pending.resolve(input.loginResponse('survived'))
			await survivor
			await input.create(fake.fetchImpl).read()
			expect(fake.exchanges()).toBe(1)
		})

		test('a pre-aborted waiter starts no exchange', async () => {
			const fake = provider(() => {
				throw new Error('unexpected fetch')
			})
			const controller = new AbortController()
			controller.abort(new Error('already cancelled'))

			await expect(
				input.create(fake.fetchImpl).login({ signal: controller.signal })
			).rejects.toThrow('already cancelled')
			expect(fake.exchanges()).toBe(0)
		})

		test('a second 401 is surfaced without expanding the retry budget', async () => {
			const fake = provider((login) =>
				login
					? input.loginResponse('rejected')
					: new Response('', { status: 401 })
			)
			await expect(input.create(fake.fetchImpl).read()).rejects.toMatchObject({
				status: 401
			})

			expect(fake.exchanges()).toBe(2)
			expect(fake.usedTokens).toHaveLength(2)
		})
	})
}
