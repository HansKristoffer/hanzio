import { mock } from 'bun:test'

export const originalFetch = globalThis.fetch

export const createMockResponse = (
	body: unknown,
	options: { status?: number; contentType?: string } = {}
) => {
	const { status = 200, contentType = 'application/json' } = options
	return new Response(
		contentType.includes('application/json')
			? JSON.stringify(body)
			: String(body),
		{
			status,
			headers: { 'content-type': contentType }
		}
	)
}

export const mockFetch = (
	fn: (url: string, options?: RequestInit) => Promise<Response>
) => {
	globalThis.fetch = mock(fn) as unknown as typeof fetch
}
