export type JWTPayload = Record<string, unknown>

const BYTE_CHUNK_SIZE = 0x8000
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export async function jwtSign<Payload extends JWTPayload>(
	payload: Payload,
	secret: string
): Promise<string> {
	const header = encodeJson({ alg: 'HS256' })
	const body = encodeJson({
		...payload,
		iat: Math.floor(Date.now() / 1000)
	})
	const data = `${header}.${body}`
	const signature = await sign(data, secret)

	return `${data}.${encodeBase64Url(signature)}`
}

export async function jwtVerify<Payload extends JWTPayload>(
	token: string,
	secret: string
): Promise<Payload | null> {
	try {
		const parts = token.split('.')
		if (parts.length !== 3) return null

		const [encodedHeader, encodedPayload, encodedSignature] = parts as [
			string,
			string,
			string
		]
		const header = decodeJson(encodedHeader)
		if (!isJwtHeader(header)) return null

		const data = `${encodedHeader}.${encodedPayload}`
		const signature = decodeBase64Url(encodedSignature)
		const isValid = await verify(data, signature, secret)
		if (!isValid) return null

		const payload = decodeJson(encodedPayload)
		if (!isJwtPayload(payload) || !isTimeValid(payload)) return null

		return payload as Payload
	} catch (_error) {
		return null
	}
}

async function sign(data: string, secret: string): Promise<ArrayBuffer> {
	const key = await getKey(secret, ['sign'])
	return await getSubtleCrypto().sign('HMAC', key, encodeText(data))
}

async function verify(
	data: string,
	signature: ArrayBuffer,
	secret: string
): Promise<boolean> {
	const key = await getKey(secret, ['verify'])
	return await getSubtleCrypto().verify(
		'HMAC',
		key,
		signature,
		encodeText(data)
	)
}

async function getKey(
	secret: string,
	usages: Array<'sign' | 'verify'>
): Promise<CryptoKey> {
	return await getSubtleCrypto().importKey(
		'raw',
		encodeText(secret),
		{
			name: 'HMAC',
			hash: 'SHA-256'
		},
		false,
		usages
	)
}

function encodeJson(value: JWTPayload): string {
	return encodeBase64Url(encodeText(JSON.stringify(value)))
}

function decodeJson(value: string): unknown {
	return JSON.parse(textDecoder.decode(decodeBase64Url(value)))
}

function encodeBase64Url(value: Uint8Array | ArrayBuffer): string {
	const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value
	return btoa(bytesToBinaryString(bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '')
}

function decodeBase64Url(value: string): ArrayBuffer {
	const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
	const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
	return binaryStringToBytes(atob(padded)).buffer
}

function encodeText(value: string): ArrayBuffer {
	return toArrayBuffer(textEncoder.encode(value))
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength
	) as ArrayBuffer
}

function bytesToBinaryString(bytes: Uint8Array): string {
	let binary = ''

	for (let offset = 0; offset < bytes.length; offset += BYTE_CHUNK_SIZE) {
		binary += String.fromCharCode(
			...bytes.subarray(offset, offset + BYTE_CHUNK_SIZE)
		)
	}

	return binary
}

function binaryStringToBytes(binary: string): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(binary.length)

	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index)
	}

	return bytes
}

function getSubtleCrypto(): SubtleCrypto {
	const subtle = globalThis.crypto?.subtle
	if (!subtle) {
		throw new Error('Web Crypto is not available in this runtime')
	}

	return subtle
}

function isJwtHeader(value: unknown): value is { alg: 'HS256' } {
	return (
		typeof value === 'object' &&
		value !== null &&
		'alg' in value &&
		value.alg === 'HS256'
	)
}

function isJwtPayload(value: unknown): value is JWTPayload {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTimeValid(payload: JWTPayload): boolean {
	const now = Math.floor(Date.now() / 1000)

	if (typeof payload.exp === 'number' && now >= payload.exp) return false
	if (typeof payload.nbf === 'number' && now < payload.nbf) return false

	return true
}
