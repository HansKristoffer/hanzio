import {
	type BytesLike,
	bytesToHex,
	decodeBase64,
	decodeBase64Url,
	encodeBase64,
	encodeBase64Url,
	hexToBytes,
	toBytes,
	utf8Encode
} from './encoding'

export type HmacAlgorithm = 'SHA-256' | 'SHA-384' | 'SHA-512'
export type SignatureEncoding = 'hex' | 'base64' | 'base64url'

export type HmacSignOptions = {
	/** Default: `'SHA-256'` */
	algorithm?: HmacAlgorithm
	/** Default: `'hex'` */
	encoding?: SignatureEncoding
}

export type HmacVerifyOptions = HmacSignOptions & {
	/** Required prefix stripped before decoding, e.g. `'sha256='`. Missing prefix → `false`. */
	prefix?: string
}

const HMAC_ALGORITHMS: readonly string[] = ['SHA-256', 'SHA-384', 'SHA-512']
const RANDOM_CHUNK_SIZE = 0x10000
const ENCODERS: Record<SignatureEncoding, (bytes: Uint8Array) => string> = {
	hex: bytesToHex,
	base64: encodeBase64,
	base64url: encodeBase64Url
}
const DECODERS: Record<
	SignatureEncoding,
	(value: string) => Uint8Array<ArrayBuffer>
> = { hex: hexToBytes, base64: decodeBase64, base64url: decodeBase64Url }

/**
 * Constant-time equality for strings (compared as UTF-8) or bytes. Runs over the
 * longer input, so timing reveals at most the lengths, never where they differ.
 */
export function safeEqual(
	a: string | Uint8Array,
	b: string | Uint8Array
): boolean {
	const left = typeof a === 'string' ? utf8Encode(a) : a
	const right = typeof b === 'string' ? utf8Encode(b) : b
	const length = Math.max(left.length, right.length)
	let diff = left.length ^ right.length
	for (let index = 0; index < length; index += 1) {
		diff |= (left[index] ?? 0) ^ (right[index] ?? 0)
	}
	return diff === 0
}

/** Cryptographically secure random bytes. */
export function randomBytes(byteLength: number): Uint8Array<ArrayBuffer> {
	if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
		throw new RangeError('byteLength must be a non-negative integer')
	}
	const cryptoApi = globalThis.crypto
	if (!cryptoApi?.getRandomValues) {
		throw new Error('Web Crypto is not available in this runtime')
	}
	const bytes = new Uint8Array(byteLength)
	// getRandomValues rejects more than 65536 bytes per call.
	for (let offset = 0; offset < byteLength; offset += RANDOM_CHUNK_SIZE) {
		cryptoApi.getRandomValues(
			bytes.subarray(offset, offset + RANDOM_CHUNK_SIZE)
		)
	}
	return bytes
}

/** Random base64url token. 32 bytes → 43 characters, 256 bits of entropy. */
export function randomToken(byteLength = 32): string {
	if (!Number.isSafeInteger(byteLength) || byteLength < 1) {
		throw new RangeError('byteLength must be a positive integer')
	}
	return encodeBase64Url(randomBytes(byteLength))
}

export async function sha256(data: string | BytesLike): Promise<Uint8Array> {
	return new Uint8Array(
		await getSubtleCrypto().digest('SHA-256', toBytes(data))
	)
}

export async function sha256Hex(data: string | BytesLike): Promise<string> {
	return bytesToHex(await sha256(data))
}

export async function hmacSign(
	secret: string | BytesLike,
	data: string | BytesLike,
	options: HmacSignOptions = {}
): Promise<string> {
	const { algorithm = 'SHA-256', encoding = 'hex' } = options
	assertEncoding(encoding)
	const key = await importHmacKey(secret, algorithm, 'sign')
	const signature = await getSubtleCrypto().sign('HMAC', key, toBytes(data))
	return ENCODERS[encoding](new Uint8Array(signature))
}

/**
 * Checks `signature` against the HMAC of `data` using Web Crypto's `verify`
 * (constant-time). Malformed or wrongly-prefixed signatures return `false`;
 * configuration problems (empty secret, unknown algorithm) throw.
 */
export async function verifyHmacSignature(
	secret: string | BytesLike,
	data: string | BytesLike,
	signature: string,
	options: HmacVerifyOptions = {}
): Promise<boolean> {
	const { algorithm = 'SHA-256', encoding = 'hex', prefix } = options
	assertEncoding(encoding)
	const key = await importHmacKey(secret, algorithm, 'verify')

	let encoded = signature
	if (prefix !== undefined) {
		if (!signature.startsWith(prefix)) return false
		encoded = signature.slice(prefix.length)
	}

	let received: Uint8Array<ArrayBuffer>
	try {
		received = DECODERS[encoding](encoded)
	} catch (_error) {
		return false
	}
	return getSubtleCrypto().verify('HMAC', key, received, toBytes(data))
}

function importHmacKey(
	secret: string | BytesLike,
	algorithm: HmacAlgorithm,
	usage: 'sign' | 'verify'
): Promise<CryptoKey> {
	if (!HMAC_ALGORITHMS.includes(algorithm)) {
		throw new TypeError(`Unsupported HMAC algorithm: ${algorithm}`)
	}
	const keyBytes = toBytes(secret)
	if (keyBytes.length === 0)
		throw new TypeError('HMAC secret must not be empty')
	return getSubtleCrypto().importKey(
		'raw',
		keyBytes,
		{ name: 'HMAC', hash: algorithm },
		false,
		[usage]
	)
}

function assertEncoding(encoding: SignatureEncoding): void {
	if (!Object.hasOwn(ENCODERS, encoding)) {
		throw new TypeError(`Unsupported signature encoding: ${encoding}`)
	}
}

/** @internal */
export function getSubtleCrypto(): SubtleCrypto {
	const subtle = globalThis.crypto?.subtle
	if (!subtle) {
		throw new Error('Web Crypto is not available in this runtime')
	}
	return subtle
}
