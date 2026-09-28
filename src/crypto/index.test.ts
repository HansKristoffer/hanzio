import { describe, expect, test } from 'bun:test'
// Test-only: node:crypto reproduces lullu's Node implementation for compat checks.
import {
	createCipheriv,
	createDecipheriv,
	createHmac,
	hkdfSync,
	randomBytes as nodeRandomBytes
} from 'node:crypto'
import {
	bytesToHex,
	createSealer,
	decodeBase64,
	decodeBase64Url,
	encodeBase64,
	encodeBase64Url,
	hexToBytes,
	hmacSign,
	randomBytes,
	randomToken,
	SealerError,
	safeEqual,
	sha256,
	sha256Hex,
	utf8Decode,
	utf8Encode,
	verifyHmacSignature,
	verifySvixSignature
} from '.'

describe('encoding', () => {
	test('base64 / base64url / hex round-trip all byte values', () => {
		const bytes = new Uint8Array(256).map((_, index) => index)
		expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes)
		expect(decodeBase64Url(encodeBase64Url(bytes))).toEqual(bytes)
		expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes)
		expect(encodeBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'))
		expect(encodeBase64Url(bytes)).toBe(
			Buffer.from(bytes).toString('base64url')
		)
		expect(encodeBase64Url(bytes.buffer)).toBe(encodeBase64Url(bytes))
	})

	test('base64url is unpadded and URL-safe; decoding accepts padding', () => {
		expect(encodeBase64Url(new Uint8Array([0xfb, 0xff]))).toBe('-_8')
		expect(decodeBase64Url('-_8=')).toEqual(new Uint8Array([0xfb, 0xff]))
		expect(encodeBase64(new Uint8Array([0xfb, 0xff]))).toBe('+/8=')
		expect(decodeBase64('+/8')).toEqual(new Uint8Array([0xfb, 0xff]))
	})

	test('rejects invalid input without echoing it', () => {
		for (const bad of ['a', 'ab+c', 'a b', 'ab==c']) {
			expect(() => decodeBase64Url(bad)).toThrow(TypeError)
		}
		expect(() => decodeBase64('ab-c')).toThrow(TypeError)
		expect(() => decodeBase64('abcde')).toThrow(TypeError)
		expect(() => hexToBytes('abc')).toThrow('Invalid hex string')
		expect(() => hexToBytes('zz')).toThrow(TypeError)
		expect(hexToBytes('ABff')).toEqual(new Uint8Array([0xab, 0xff]))
	})

	test('utf8', () => {
		expect(utf8Decode(utf8Encode('æøå 🙂'))).toBe('æøå 🙂')
		expect(utf8Encode('æ')).toEqual(new Uint8Array([0xc3, 0xa6]))
	})
})

describe('safeEqual', () => {
	test('compares strings and bytes', () => {
		expect(safeEqual('secret', 'secret')).toBe(true)
		expect(safeEqual('secret', 'secreT')).toBe(false)
		expect(safeEqual('secret', 'secret1')).toBe(false)
		expect(safeEqual('', '')).toBe(true)
		expect(safeEqual('', 'a')).toBe(false)
		expect(safeEqual('æ', new Uint8Array([0xc3, 0xa6]))).toBe(true)
		// Prefix + zero padding must not match the shorter input.
		expect(safeEqual(new Uint8Array([1]), new Uint8Array([1, 0]))).toBe(false)
	})
})

describe('random', () => {
	test('randomBytes and randomToken', () => {
		expect(randomBytes(0)).toHaveLength(0)
		expect(randomBytes(100_000)).toHaveLength(100_000)
		expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/)
		expect(randomToken(16)).toHaveLength(22)
		expect(randomToken()).not.toBe(randomToken())
		expect(() => randomBytes(-1)).toThrow(RangeError)
		expect(() => randomBytes(1.5)).toThrow(RangeError)
		expect(() => randomToken(0)).toThrow(RangeError)
	})
})

describe('sha256', () => {
	test('known vectors', async () => {
		expect(await sha256Hex('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		)
		expect(await sha256Hex('')).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
		)
		expect(await sha256(new Uint8Array([0x61, 0x62, 0x63]))).toEqual(
			hexToBytes(
				'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
			)
		)
	})
})

describe('hmac', () => {
	// RFC 4231 test case 1 and 2
	const key1 = new Uint8Array(20).fill(0x0b)
	const vectors = [
		{
			key: key1,
			data: 'Hi There',
			algorithm: 'SHA-256',
			hex: 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
		},
		{
			key: key1,
			data: 'Hi There',
			algorithm: 'SHA-384',
			hex: 'afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6'
		},
		{
			key: key1,
			data: 'Hi There',
			algorithm: 'SHA-512',
			hex: '87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854'
		},
		{
			key: 'Jefe',
			data: 'what do ya want for nothing?',
			algorithm: 'SHA-256',
			hex: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'
		}
	] as const

	test('RFC 4231 vectors sign and verify', async () => {
		for (const { key, data, algorithm, hex } of vectors) {
			expect(await hmacSign(key, data, { algorithm })).toBe(hex)
			expect(await verifyHmacSignature(key, data, hex, { algorithm })).toBe(
				true
			)
			expect(
				await verifyHmacSignature(key, data, hex.toUpperCase(), { algorithm })
			).toBe(true)
		}
	})

	test('encodings', async () => {
		const bytes = hexToBytes(vectors[0].hex)
		for (const [encoding, expected] of [
			['base64', encodeBase64(bytes)],
			['base64url', encodeBase64Url(bytes)]
		] as const) {
			expect(await hmacSign(key1, 'Hi There', { encoding })).toBe(expected)
			expect(
				await verifyHmacSignature(key1, 'Hi There', expected, { encoding })
			).toBe(true)
		}
	})

	test('Meta x-hub-signature-256 style prefix', async () => {
		const secret = 'app-secret'
		const body = '{"object":"page"}'
		const header = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
		const options = { prefix: 'sha256=' }
		expect(await verifyHmacSignature(secret, body, header, options)).toBe(true)
		expect(
			await verifyHmacSignature(secret, body, header.slice(7), options)
		).toBe(false)
		expect(await verifyHmacSignature(secret, `${body} `, header, options)).toBe(
			false
		)
		expect(await verifyHmacSignature('other', body, header, options)).toBe(
			false
		)
	})

	test('malformed or truncated signatures are false', async () => {
		const hex = vectors[0].hex
		for (const bad of ['', 'zz', hex.slice(0, -2), `${hex}00`, `${hex}0`]) {
			expect(await verifyHmacSignature(key1, 'Hi There', bad)).toBe(false)
		}
	})

	test('configuration errors throw', async () => {
		await expect(hmacSign('', 'data')).rejects.toThrow('must not be empty')
		await expect(
			hmacSign('k', 'd', { algorithm: 'MD5' as 'SHA-256' })
		).rejects.toThrow(TypeError)
		await expect(
			verifyHmacSignature('k', 'd', 'x', { encoding: 'nope' as 'hex' })
		).rejects.toThrow(TypeError)
	})
})

describe('verifySvixSignature', () => {
	// Published example from the Svix docs.
	const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
	const payload = '{"test": 2432232314}'
	const timestamp = '1614265330'
	const now = 1614265330 * 1000
	const signature = 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE='
	const headers = {
		'svix-id': 'msg_p5jXN8AQM9LWM0D4loKWxJek',
		'svix-timestamp': timestamp,
		'svix-signature': signature
	}

	test('accepts the published example', async () => {
		expect(await verifySvixSignature({ secret, payload, headers, now })).toBe(
			true
		)
		expect(
			await verifySvixSignature({
				secret,
				payload,
				headers: new Headers(headers),
				now
			})
		).toBe(true)
	})

	test('accepts webhook-* headers and mixed case keys', async () => {
		const standard = {
			'Webhook-Id': headers['svix-id'],
			'webhook-timestamp': timestamp,
			'WEBHOOK-SIGNATURE': signature
		}
		expect(
			await verifySvixSignature({ secret, payload, headers: standard, now })
		).toBe(true)
	})

	test('checks every v1 entry (secret rotation)', async () => {
		const rotated = {
			...headers,
			'svix-signature': `v1,bm90LWl0 v2,abc ${signature}`
		}
		expect(
			await verifySvixSignature({ secret, payload, headers: rotated, now })
		).toBe(true)
	})

	test('rejects tampering, staleness and missing headers', async () => {
		const check = (
			overrides: Partial<Parameters<typeof verifySvixSignature>[0]>
		) => verifySvixSignature({ secret, payload, headers, now, ...overrides })

		expect(await check({ payload: '{"test": 2432232315}' })).toBe(false)
		expect(
			await check({ headers: { ...headers, 'svix-id': 'msg_other' } })
		).toBe(false)
		expect(
			await check({
				headers: { ...headers, 'svix-signature': signature.replace('v1', 'v2') }
			})
		).toBe(false)
		expect(
			await check({ headers: { ...headers, 'svix-signature': undefined } })
		).toBe(false)
		expect(
			await check({ headers: { ...headers, 'svix-timestamp': '1614265330.5' } })
		).toBe(false)
		expect(await check({ now: now + 301_000 })).toBe(false)
		expect(await check({ now: now - 301_000 })).toBe(false)
		expect(await check({ now: now + 299_000 })).toBe(true)
		expect(await check({ now: now + 3_600_000, toleranceSec: 3600 })).toBe(true)
		expect(
			await check({ secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSx' })
		).toBe(false)
	})

	test('invalid secret throws without echoing it', async () => {
		const error = await verifySvixSignature({
			secret: 'whsec_not base64!',
			payload,
			headers,
			now
		}).catch((caught: unknown) => caught)
		expect(error).toBeInstanceOf(TypeError)
		expect((error as Error).message).not.toContain('not base64')
	})
})

describe('createSealer', () => {
	const secret = 'app-secret-with-enough-entropy-0123456789'

	test('round-trips strings and JSON with a fresh IV each time', async () => {
		const sealer = createSealer({ secret })
		const a = await sealer.seal('hello æøå')
		const b = await sealer.seal('hello æøå')
		expect(a).toMatch(/^enc:v1:[\w-]{16}\.[\w-]{22}\.[\w-]+$/)
		expect(a).not.toBe(b)
		expect(await sealer.open(a)).toBe('hello æøå')
		expect(await sealer.open(await sealer.seal(''))).toBe('')

		const value = { token: 'abc', nested: [1, null, true] }
		expect(
			await sealer.openJson<typeof value>(await sealer.sealJson(value))
		).toEqual(value)
		await expect(sealer.sealJson(undefined)).rejects.toThrow(TypeError)
	})

	test('wrong key, salt or info fails to open', async () => {
		const sealed = await createSealer({ secret }).seal('x')
		for (const options of [
			{ secret: `${secret}!` },
			{ secret, salt: 'other' },
			{ secret, info: 'other' }
		]) {
			const error = await createSealer(options)
				.open(sealed)
				.catch((caught: unknown) => caught)
			expect(error).toBeInstanceOf(SealerError)
			expect((error as SealerError).code).toBe('decrypt_failed')
			expect((error as Error).message).not.toContain(secret)
		}
	})

	test('tampering is detected', async () => {
		const sealer = createSealer({ secret })
		const sealed = await sealer.seal('amount=100')
		const [iv, tag, ciphertext] = sealed.slice('enc:v1:'.length).split('.') as [
			string,
			string,
			string
		]
		const flip = (part: string) => {
			const bytes = decodeBase64Url(part)
			bytes[0] = (bytes[0] as number) ^ 1
			return encodeBase64Url(bytes)
		}
		for (const tampered of [
			`enc:v1:${flip(iv)}.${tag}.${ciphertext}`,
			`enc:v1:${iv}.${flip(tag)}.${ciphertext}`,
			`enc:v1:${iv}.${tag}.${flip(ciphertext)}`,
			`enc:v1:${iv}.${tag}.${ciphertext.slice(0, -2)}`
		]) {
			await expect(sealer.open(tampered)).rejects.toMatchObject({
				code: 'decrypt_failed'
			})
		}
	})

	test('malformed and unknown versions', async () => {
		const sealer = createSealer({ secret })
		for (const bad of [
			'plain',
			'enc:v1:',
			'enc:v1:a.b',
			'enc:v1:a.b.c.d',
			'enc:v1:!!.aaaa.aaaa',
			'enc:v1:AAAA.AAAAAAAAAAAAAAAAAAAAAA.AA'
		]) {
			await expect(sealer.open(bad)).rejects.toMatchObject({
				code: 'malformed'
			})
		}
		await expect(sealer.open('enc:v2:a.b.c')).rejects.toMatchObject({
			code: 'unsupported_version'
		})
		expect(() => createSealer({ secret: '' })).toThrow(TypeError)
	})

	test('interoperates with lullu secret-json.ts (Node crypto)', async () => {
		const salt = 'lullu.secret-json.salt.v1'
		const info = 'lullu.secret-json.aes-256-gcm.v1'
		const key = Buffer.from(hkdfSync('sha256', secret, salt, info, 32))
		const sealer = createSealer({ secret, salt, info })
		const value = { accessToken: 'tok_æøå', expiresAt: 123 }

		// lullu sealSecretJson → hanzio openJson
		const iv = nodeRandomBytes(12)
		const cipher = createCipheriv('aes-256-gcm', key, iv)
		const ct = Buffer.concat([
			cipher.update(JSON.stringify(value), 'utf8'),
			cipher.final()
		])
		const lulluSealed = `enc:v1:${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`
		expect(await sealer.openJson<typeof value>(lulluSealed)).toEqual(value)

		// hanzio sealJson → lullu openSecretJson
		const [ivPart, tagPart, ctPart] = (await sealer.sealJson(value))
			.slice('enc:v1:'.length)
			.split('.') as [string, string, string]
		const decipher = createDecipheriv(
			'aes-256-gcm',
			key,
			Buffer.from(ivPart, 'base64url')
		)
		decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
		const plain = Buffer.concat([
			decipher.update(Buffer.from(ctPart, 'base64url')),
			decipher.final()
		])
		expect(JSON.parse(plain.toString('utf8'))).toEqual(value)
	})
})
