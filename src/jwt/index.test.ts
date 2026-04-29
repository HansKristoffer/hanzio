import { describe, expect, test } from 'bun:test'
import { jwtSign, jwtVerify } from '.'

describe('jwt', () => {
	test('sign and verify roundtrip', async () => {
		const secret = 'test-secret-at-least-32-chars-long!!'
		const token = await jwtSign({ sub: 'user-1' }, secret)
		expect(typeof token).toBe('string')

		const payload = await jwtVerify<{ sub: string }>(token, secret)
		expect(payload?.sub).toBe('user-1')

		const bad = await jwtVerify(token, 'wrong-secret')
		expect(bad).toBeNull()
	})
})
