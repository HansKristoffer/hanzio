import { describe, expect, test } from 'bun:test'
import { createSealer, SealerError } from './index.js'
import { createSealerSync } from './node.js'

const secret = 'app-secret-with-enough-entropy-0123456789'

describe('createSealerSync', () => {
	test('round-trips strings and JSON with a fresh IV each time', () => {
		const sealer = createSealerSync({ secret })
		const a = sealer.seal('hello æøå')

		expect(a).toMatch(/^enc:v1:[\w-]{16}\.[\w-]{22}\.[\w-]+$/)
		expect(a).not.toBe(sealer.seal('hello æøå'))
		expect(sealer.open(a)).toBe('hello æøå')

		const value = { token: 'abc', nested: [1, null, true] }
		expect(sealer.openJson<typeof value>(sealer.sealJson(value))).toEqual(value)
		expect(() => sealer.sealJson(undefined)).toThrow(TypeError)
	})

	test('opens what the async sealer sealed, and the other way round', async () => {
		const options = { secret, salt: 's', info: 'i' }
		const sync = createSealerSync(options)
		const async = createSealer(options)

		expect(sync.openJson<object>(await async.sealJson({ a: 1 }))).toEqual({
			a: 1
		})
		expect(await async.openJson<object>(sync.sealJson({ b: 2 }))).toEqual({
			b: 2
		})
	})

	test('opens values sealed under a fallback context, seals under the primary', async () => {
		const old = { salt: 'old.salt', info: 'old.info' }
		const renamed = { salt: 'new.salt', info: 'new.info' }
		const sealedBefore = createSealerSync({ secret, ...old }).sealJson('x')

		const sealer = createSealerSync({ secret, ...renamed, fallbacks: [old] })
		expect(sealer.openJson<string>(sealedBefore)).toBe('x')

		const sealedNow = sealer.sealJson('y')
		expect(
			createSealerSync({ secret, ...renamed }).openJson<string>(sealedNow)
		).toBe('y')
		expect(() => createSealerSync({ secret, ...old }).open(sealedNow)).toThrow(
			SealerError
		)

		const asyncSealer = createSealer({ secret, ...renamed, fallbacks: [old] })
		expect(await asyncSealer.openJson<string>(sealedBefore)).toBe('x')
	})

	test('passthroughUnsealed returns values that were never sealed', async () => {
		const sealer = createSealerSync({ secret, passthroughUnsealed: true })
		expect(sealer.openJson<object>({})).toEqual({})
		expect(sealer.openJson<string>('plain')).toBe('plain')
		expect(sealer.open('plain')).toBe('plain')
		expect(() => sealer.open('enc:v2:a.b.c')).toThrow(SealerError)
		expect(() => sealer.open('enc:v1:a.b')).toThrow(SealerError)

		const asyncSealer = createSealer({ secret, passthroughUnsealed: true })
		expect(await asyncSealer.openJson<object>({ a: 1 })).toEqual({ a: 1 })
	})

	test('throws the same error codes as the async sealer', () => {
		const sealed = createSealerSync({ secret }).seal('x')

		const wrongKey = () =>
			createSealerSync({ secret: `${secret}!` }).open(sealed)
		expect(wrongKey).toThrow(SealerError)
		try {
			wrongKey()
		} catch (error) {
			expect((error as SealerError).code).toBe('decrypt_failed')
			expect((error as Error).message).not.toContain(secret)
		}

		const sealer = createSealerSync({ secret })
		for (const [bad, code] of [
			['plain', 'malformed'],
			['enc:v1:a.b', 'malformed'],
			['enc:v2:a.b.c', 'unsupported_version']
		] as const) {
			expect(() => sealer.open(bad)).toThrow(expect.objectContaining({ code }))
		}
		expect(() => createSealerSync({ secret: '' })).toThrow(TypeError)
	})
})
