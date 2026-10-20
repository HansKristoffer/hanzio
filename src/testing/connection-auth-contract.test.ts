import { ConnectionAuthCache } from '../api-wrapper/connection-auth'
import { connectionAuthContract } from './connection-auth-contract'

// The smallest client the contract accepts: login on demand, one retry on 401.
const cache = new ConnectionAuthCache()

function createClient(fetchImpl: typeof fetch, variant?: string) {
	const connectionId = variant === 'connection' ? 'other' : 'shop'
	const secret = variant === 'secret' || variant === 'password' ? variant : 'pw'
	const auth = cache.bind({
		connectionId,
		authInputs: [secret],
		refreshMarginMs: 1_000,
		exchange: async () => {
			const response = await fetchImpl('https://shop.test/login', {
				method: 'POST'
			})
			const body = (await response.json()) as { token: string }
			return { token: body.token, expiresAt: Date.now() + 60_000 }
		}
	})

	const send = (token: string) =>
		fetchImpl('https://shop.test/items', {
			headers: { authorization: `Bearer ${token}` }
		})

	return {
		async login(options?: { signal?: AbortSignal }) {
			return (await auth.get({ fresh: true, signal: options?.signal })).token
		},
		async read() {
			const current = await auth.get()
			let response = await send(current.token)
			if (response.status === 401) {
				auth.reject(current)
				response = await send((await auth.get()).token)
			}
			if (!response.ok)
				throw Object.assign(new Error('request failed'), {
					status: response.status
				})
			return response.json()
		}
	}
}

await connectionAuthContract({
	reset: () => cache.clear(),
	create: createClient,
	identityChanges: ['password'],
	isLogin: (url) => url.endsWith('/login'),
	loginResponse: (token) => Response.json({ token }),
	readResponse: () => Response.json({ items: [] }),
	tokenHeader: 'authorization'
})
