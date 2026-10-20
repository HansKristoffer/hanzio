/**
 * Byte-level SSE keep-alives. Empty `:` comments keep proxy and load-balancer
 * idle timers (Railway, nginx) from resetting a stream that goes quiet, such
 * as an LLM thinking or a slow tool call.
 */
const SSE_KEEPALIVE_INTERVAL_MS = 15_000
export const SSE_KEEPALIVE_COMMENT = new TextEncoder().encode(':\n\n')

function defaultClearTimeout(id: unknown) {
	clearTimeout(id as ReturnType<typeof setTimeout>)
}

/** Passes bytes through, writing a comment first and after every `intervalMs` of silence. */
export function createSseKeepAliveTransform(
	intervalMs = SSE_KEEPALIVE_INTERVAL_MS,
	timers: {
		setTimeout: (fn: () => void, ms: number) => unknown
		clearTimeout: (id: unknown) => void
	} = { setTimeout, clearTimeout: defaultClearTimeout }
) {
	let timer: unknown
	let closed = false
	let enqueueKeepAlive: (() => void) | undefined

	const clear = () => {
		if (timer === undefined) return
		timers.clearTimeout(timer)
		timer = undefined
	}

	const arm = () => {
		clear()
		timer = timers.setTimeout(() => {
			enqueueKeepAlive?.()
		}, intervalMs)
	}

	return new TransformStream<Uint8Array, Uint8Array>(
		{
			start(controller) {
				enqueueKeepAlive = () => {
					if (closed) return
					try {
						controller.enqueue(SSE_KEEPALIVE_COMMENT)
					} catch {
						closed = true
						clear()
						return
					}
					arm()
				}
				// Immediate comment so the edge sees body bytes before the first
				// event, which can take a long time to arrive.
				enqueueKeepAlive()
			},
			transform(chunk, controller) {
				if (closed) return
				controller.enqueue(chunk)
				arm()
			},
			flush() {
				closed = true
				clear()
			}
		},
		{ highWaterMark: 16 },
		{ highWaterMark: 16 }
	)
}

/**
 * Copies an SSE response with keep-alive comments in its body and headers that
 * stop proxies from buffering it.
 *
 * @example
 * return withSseKeepAlive(createUIMessageStreamResponse({ stream }))
 */
export function withSseKeepAlive(
	response: Response,
	intervalMs = SSE_KEEPALIVE_INTERVAL_MS
) {
	const headers = new Headers(response.headers)
	headers.set('Cache-Control', 'no-cache')
	headers.set('X-Accel-Buffering', 'no')
	headers.set('Connection', 'keep-alive')
	const body = response.body
		? response.body.pipeThrough(createSseKeepAliveTransform(intervalMs))
		: response.body
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers
	})
}
