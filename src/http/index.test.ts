import { describe, expect, test } from 'bun:test'
import {
	createSseKeepAliveTransform,
	SSE_KEEPALIVE_COMMENT,
	withSseKeepAlive
} from './index.js'

type Scheduled = { at: number; fn: () => void; id: number }

function createFakeTimers() {
	let now = 0
	let nextId = 1
	const timers: Scheduled[] = []

	return {
		now: () => now,
		setTimeout(fn: () => void, ms: number) {
			const id = nextId++
			timers.push({ at: now + ms, fn, id })
			return id
		},
		clearTimeout(id: unknown) {
			const index = timers.findIndex((timer) => timer.id === id)
			if (index >= 0) timers.splice(index, 1)
		},
		advance(ms: number) {
			now += ms
			const due = timers
				.filter((timer) => timer.at <= now)
				.sort((a, b) => a.at - b.at)
			for (const timer of due) {
				const index = timers.indexOf(timer)
				if (index >= 0) {
					timers.splice(index, 1)
					timer.fn()
				}
			}
		}
	}
}

describe('createSseKeepAliveTransform', () => {
	test('emits a comment immediately and again after silence', async () => {
		const clock = createFakeTimers()
		const transform = createSseKeepAliveTransform(1_000, clock)
		const writer = transform.writable.getWriter()
		const reader = transform.readable.getReader()

		const first = await reader.read()
		expect(first.value).toEqual(SSE_KEEPALIVE_COMMENT)

		clock.advance(1_000)
		const second = await reader.read()
		expect(second.value).toEqual(SSE_KEEPALIVE_COMMENT)

		await writer.close()
		await reader.cancel()
	})

	test('does not emit comments while data keeps flowing', async () => {
		const clock = createFakeTimers()
		const transform = createSseKeepAliveTransform(1_000, clock)
		const writer = transform.writable.getWriter()
		const reader = transform.readable.getReader()

		await reader.read()
		const payload = new TextEncoder().encode('data: hello\n\n')
		const dataRead = reader.read()
		await writer.write(payload)
		const data = await dataRead
		expect(data.value).toEqual(payload)

		let resolvedEarly = false
		const next = reader.read().then((result) => {
			resolvedEarly = true
			return result
		})
		clock.advance(999)
		await Promise.resolve()
		expect(resolvedEarly).toBe(false)
		clock.advance(1)
		const afterSilence = await next
		expect(afterSilence.value).toEqual(SSE_KEEPALIVE_COMMENT)

		await writer.close()
		await reader.cancel()
	})
})

describe('withSseKeepAlive', () => {
	test('sets anti-buffer headers on the wrapped response', () => {
		const response = withSseKeepAlive(
			new Response('ok', { headers: { 'Content-Type': 'text/event-stream' } })
		)
		expect(response.headers.get('Cache-Control')).toBe('no-cache')
		expect(response.headers.get('X-Accel-Buffering')).toBe('no')
		expect(response.headers.get('Connection')).toBe('keep-alive')
		expect(response.headers.get('Content-Type')).toBe('text/event-stream')
	})
})
