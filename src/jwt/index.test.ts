import { describe, expect, test } from 'bun:test'
import { jwtDecode, jwtSign, jwtVerify, jwtVerifyResult } from '.'

const secret = 'test-secret-at-least-32-chars-long!!'
const now = () => Math.floor(Date.now() / 1000)
const b64url = (value: object) =>
	btoa(JSON.stringify(value))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '')

async function errorCode(
	token: string,
	options?: Parameters<typeof jwtVerifyResult>[2]
) {
	const result = await jwtVerifyResult(token, secret, options)
	return result.ok ? null : result.error.code
}

describe('jwt', () => {
	test('sign and verify roundtrip', async () => {
		const token = await jwtSign({ sub: 'user-1' }, secret)
		expect(typeof token).toBe('string')

		const payload = await jwtVerify<{ sub: string }>(token, secret)
		expect(payload?.sub).toBe('user-1')

		const bad = await jwtVerify(token, 'wrong-secret')
		expect(bad).toBeNull()
	})

	test('rejects expired tokens', async () => {
		const token = await jwtSign({ sub: 'user-1', exp: 1 }, secret)

		expect(await jwtVerify(token, secret)).toBeNull()
		expect(await errorCode(token)).toBe('expired')
	})

	test('rejects malformed tokens', async () => {
		expect(await jwtVerify('not-a-token', secret)).toBeNull()
		expect(await errorCode('not-a-token')).toBe('malformed')
		expect(await errorCode('a.b.c')).toBe('malformed')
		expect(await errorCode(`${b64url({ alg: 'HS256' })}.${b64url([])}.x`)).toBe(
			'malformed'
		)
	})

	test('header has typ JWT and chosen alg', async () => {
		const token = await jwtSign({}, secret, { algorithm: 'HS512' })
		expect(jwtDecode(token)?.header).toEqual({ alg: 'HS512', typ: 'JWT' })
		expect((await jwtVerify(token, secret))?.iat).toBeNumber()
	})

	test('options set claims and win over payload claims', async () => {
		const token = await jwtSign(
			{ sub: 'u', exp: 1, iss: 'payload', aud: 'payload' },
			secret,
			{ expiresIn: 60, notBefore: 0, issuer: 'me', audience: ['a', 'b'] }
		)
		const payload = jwtDecode(token)?.payload
		const iat = payload?.iat as number

		expect(payload).toMatchObject({
			sub: 'u',
			exp: iat + 60,
			nbf: iat,
			iss: 'me',
			aud: ['a', 'b']
		})
		expect(await errorCode(token, { issuer: 'me', audience: 'b' })).toBeNull()
	})

	test('rejects non-finite durations', async () => {
		await expect(
			jwtSign({}, secret, { expiresIn: Number.NaN })
		).rejects.toThrow(TypeError)
	})

	test('reports signature, time, issuer and audience failures', async () => {
		const token = await jwtSign({}, secret, { issuer: 'me', audience: 'app' })
		expect(await jwtVerifyResult(token, 'wrong-secret')).toMatchObject({
			ok: false,
			error: { code: 'invalid_signature' }
		})
		expect(await errorCode(token, { issuer: 'other' })).toBe('invalid_issuer')
		expect(await errorCode(token, { audience: 'other' })).toBe(
			'invalid_audience'
		)

		const future = await jwtSign({}, secret, { notBefore: 60 })
		expect(await errorCode(future)).toBe('not_yet_valid')
		expect(await errorCode(future, { leewaySec: 120 })).toBeNull()

		const expired = await jwtSign({ exp: now() - 5 }, secret)
		expect(await errorCode(expired, { leewaySec: 60 })).toBeNull()
	})

	test('tampered payload fails the signature check', async () => {
		const [header, , signature] = (
			await jwtSign({ admin: false }, secret)
		).split('.')
		const forged = `${header}.${b64url({ admin: true })}.${signature}`

		expect(await errorCode(forged)).toBe('invalid_signature')
	})

	test('only accepts allowed algorithms, never none', async () => {
		const unsigned = `${b64url({ alg: 'none' })}.${b64url({ sub: 'x' })}.`
		expect(await errorCode(unsigned)).toBe('unsupported_alg')

		const hs512 = await jwtSign({}, secret, { algorithm: 'HS512' })
		expect(await errorCode(hs512, { algorithms: ['HS256'] })).toBe(
			'unsupported_alg'
		)
		expect(await errorCode(hs512, { algorithms: ['HS512'] })).toBeNull()
	})

	test('jwtDecode reads claims without verifying', async () => {
		const token = await jwtSign({ sub: 'user-1' }, secret)

		expect(jwtDecode<{ sub: string }>(token)?.payload.sub).toBe('user-1')
		expect(jwtDecode('garbage')).toBeNull()
	})
})
