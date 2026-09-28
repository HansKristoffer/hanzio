import { describe, expect, test } from 'bun:test'
import { createEmitter } from '.'

type Events = { message: string; ready: void; count: number | undefined }

describe('createEmitter', () => {
	test('on, off, unsubscribe and listenerCount', () => {
		const emitter = createEmitter<Events>()
		const seen: string[] = []
		const listener = (text: string) => seen.push(text)
		const unsubscribe = emitter.on('message', listener)
		emitter.on('message', listener)
		expect(emitter.listenerCount('message')).toBe(1)

		emitter.emit('message', 'a')
		unsubscribe()
		emitter.emit('message', 'b')
		emitter.on('message', listener)
		emitter.off('message', listener)
		emitter.emit('message', 'c')

		expect(seen).toEqual(['a'])
		expect(emitter.listenerCount('message')).toBe(0)
	})

	test('void and undefined payloads can be omitted', () => {
		const emitter = createEmitter<Events>()
		let calls = 0
		emitter.on('ready', () => calls++)
		emitter.on('count', (value) => expect(value).toBeUndefined())
		emitter.emit('ready')
		emitter.emit('count')
		// @ts-expect-error payload required
		emitter.emit('message')
		expect(calls).toBe(1)
	})

	test('once fires a single time, also when emitted re-entrantly', () => {
		const emitter = createEmitter<Events>()
		const seen: string[] = []
		emitter.once('message', (text) => {
			seen.push(text)
			emitter.emit('message', 'nested')
		})
		emitter.emit('message', 'a')
		emitter.emit('message', 'b')
		expect(seen).toEqual(['a'])
		expect(emitter.listenerCount('message')).toBe(0)

		const off = emitter.once('message', (text) => seen.push(text))
		off()
		emitter.emit('message', 'c')
		expect(seen).toEqual(['a'])
	})

	test('listeners added during emit wait; removed ones are skipped', () => {
		const emitter = createEmitter<Events>()
		const seen: string[] = []
		const second = () => seen.push('second')
		emitter.on('ready', () => {
			seen.push('first')
			emitter.off('ready', second)
			emitter.on('ready', () => seen.push('late'))
		})
		emitter.on('ready', second)
		emitter.emit('ready')
		expect(seen).toEqual(['first'])
	})

	test('calls every listener, then rethrows one error or an AggregateError', () => {
		const emitter = createEmitter<Events>()
		let reached = false
		emitter.on('ready', () => {
			throw new Error('one')
		})
		emitter.on('ready', () => {
			reached = true
		})
		expect(() => emitter.emit('ready')).toThrow('one')
		expect(reached).toBe(true)

		emitter.on('ready', () => {
			throw new Error('two')
		})
		try {
			emitter.emit('ready')
			throw new Error('expected throw')
		} catch (error) {
			expect(error).toBeInstanceOf(AggregateError)
			expect((error as AggregateError).errors).toHaveLength(2)
		}
	})

	test('clear removes one event or all', () => {
		const emitter = createEmitter<Events>()
		emitter.on('ready', () => {})
		emitter.on('message', () => {})
		emitter.clear('ready')
		expect(emitter.listenerCount('ready')).toBe(0)
		expect(emitter.listenerCount('message')).toBe(1)
		emitter.clear()
		expect(emitter.listenerCount('message')).toBe(0)
	})
})
