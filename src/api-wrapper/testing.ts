import type { FetchLike } from './types'

export type MockFetch = FetchLike & {
	/** Every request received, in order. Bodies are still readable. */
	readonly calls: Request[]
	/** No-op, so a `MockFetch` is assignable to Bun's `typeof fetch`. */
	preconnect: () => void
}

export type MockFetchHandler = (
	request: Request,
	callIndex: number
) => Response | Promise<Response>

/**
 * A fetch stand-in for tests: pass it as the client's `fetch` option instead
 * of replacing `globalThis.fetch`. Test-runner agnostic.
 *
 * Pass a handler, or an array of responses served in order. A `Response` body
 * reads once, so an array entry that is a plain `Response` serves one call; use
 * `() => Response` to build it per call. A request past the end of the array
 * throws.
 *
 * @example
 * const fetch = createMockFetch((request) =>
 *   request.url.endsWith('/users/1')
 *     ? jsonResponse({ id: 1 })
 *     : jsonResponse({ error: 'not found' }, { status: 404 })
 * )
 * const api = createApiClient({ ...config, fetch })
 *
 * @example
 * const fetch = createMockFetch([
 *   jsonResponse({}, { status: 503 }),
 *   jsonResponse({ id: 1 })
 * ])
 */
export function createMockFetch(
	handler: MockFetchHandler | readonly (Response | (() => Response))[]
): MockFetch {
	const calls: Request[] = []
	const respond: MockFetchHandler =
		typeof handler === 'function'
			? handler
			: (request, callIndex) => {
					const next = handler[callIndex]
					if (next === undefined) {
						throw new Error(
							`createMockFetch: unexpected request ${request.method} ${request.url} (call ${callIndex}; ${handler.length} response(s) configured)`
						)
					}
					return typeof next === 'function' ? next() : next
				}
	const mockFetch = async (
		input: string | URL | Request,
		init?: RequestInit
	): Promise<Response> => {
		const request: Request =
			input instanceof Request
				? new Request(input, init)
				: new Request(input.toString(), init)
		// Bun types clone() as the undici Request; it is the same runtime object.
		calls.push(request.clone() as Request)
		return respond(request, calls.length - 1)
	}
	return Object.assign(mockFetch, { calls, preconnect: () => {} })
}

/** A JSON `Response` with `content-type: application/json`. */
export function jsonResponse(
	body: unknown,
	init: { status?: number; headers?: Record<string, string> } = {}
): Response {
	return new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: { 'content-type': 'application/json', ...init.headers }
	})
}
