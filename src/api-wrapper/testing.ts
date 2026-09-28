import type { FetchLike } from './types'

export type MockFetch = FetchLike & {
	/** Every request received, in order. Bodies are still readable. */
	readonly calls: Request[]
}

/**
 * A fetch stand-in for tests: pass it as the client's `fetch` option instead
 * of replacing `globalThis.fetch`. Test-runner agnostic.
 *
 * @example
 * const fetch = createMockFetch((request) =>
 *   request.url.endsWith('/users/1')
 *     ? jsonResponse({ id: 1 })
 *     : jsonResponse({ error: 'not found' }, { status: 404 })
 * )
 * const api = createApiClient({ ...config, fetch })
 */
export function createMockFetch(
	handler: (request: Request, callIndex: number) => Response | Promise<Response>
): MockFetch {
	const calls: Request[] = []
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
		return handler(request, calls.length - 1)
	}
	return Object.assign(mockFetch, { calls })
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
