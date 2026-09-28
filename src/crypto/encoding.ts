const BYTE_CHUNK_SIZE = 0x8000
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const BASE64URL = /^[A-Za-z0-9_-]*={0,2}$/
const HEX = /^(?:[0-9a-fA-F]{2})*$/
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export type BytesLike = Uint8Array | ArrayBuffer

export function utf8Encode(value: string): Uint8Array<ArrayBuffer> {
	return textEncoder.encode(value)
}

/** Invalid UTF-8 sequences become U+FFFD (same as `TextDecoder` / `Buffer#toString`). */
export function utf8Decode(bytes: BytesLike): string {
	return textDecoder.decode(bytes)
}

/** Standard base64 with `=` padding. */
export function encodeBase64(bytes: BytesLike): string {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
	let binary = ''
	for (let offset = 0; offset < view.length; offset += BYTE_CHUNK_SIZE) {
		binary += String.fromCharCode(
			...view.subarray(offset, offset + BYTE_CHUNK_SIZE)
		)
	}
	return btoa(binary)
}

/** Decodes standard base64 (padding optional). Throws `TypeError` on invalid input. */
export function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
	if (!BASE64.test(value)) throw new TypeError('Invalid base64 string')
	const unpadded = value.replace(/=+$/, '')
	if (unpadded.length % 4 === 1) throw new TypeError('Invalid base64 string')

	const binary = atob(unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, '='))
	const bytes = new Uint8Array(binary.length)
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index)
	}
	return bytes
}

/** URL-safe base64 without padding (RFC 4648 §5). */
export function encodeBase64Url(bytes: BytesLike): string {
	return encodeBase64(bytes)
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '')
}

/** Decodes URL-safe base64 (padding optional). Throws `TypeError` on invalid input. */
export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
	if (!BASE64URL.test(value)) throw new TypeError('Invalid base64url string')
	return decodeBase64(value.replaceAll('-', '+').replaceAll('_', '/'))
}

/** Lowercase hex. */
export function bytesToHex(bytes: BytesLike): string {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
	let hex = ''
	for (const byte of view) hex += byte.toString(16).padStart(2, '0')
	return hex
}

/** Decodes hex (either case). Throws `TypeError` on odd length or non-hex characters. */
export function hexToBytes(value: string): Uint8Array<ArrayBuffer> {
	if (!HEX.test(value)) throw new TypeError('Invalid hex string')
	const bytes = new Uint8Array(value.length / 2)
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
	}
	return bytes
}

/** UTF-8 for strings; a copy for bytes, so Web Crypto always gets an `ArrayBuffer`-backed view. */
export function toBytes(data: string | BytesLike): Uint8Array<ArrayBuffer> {
	if (typeof data === 'string') return utf8Encode(data)
	return data instanceof Uint8Array
		? new Uint8Array(data)
		: new Uint8Array(data.slice(0))
}
