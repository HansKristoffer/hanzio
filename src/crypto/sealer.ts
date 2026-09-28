import {
	type BytesLike,
	decodeBase64Url,
	encodeBase64Url,
	toBytes,
	utf8Decode,
	utf8Encode
} from './encoding'
import { getSubtleCrypto, randomBytes } from './hash'

export type SealerOptions = {
	/** High-entropy secret (e.g. `APP_SECRET`). The AES key is derived from it with HKDF-SHA-256. */
	secret: string | BytesLike
	/** HKDF salt. Default: empty */
	salt?: string
	/** HKDF info; use a distinct value per purpose. Default: `'hanzio.sealer.aes-256-gcm.v1'` */
	info?: string
}

export type Sealer = {
	seal(plaintext: string): Promise<string>
	open(sealed: string): Promise<string>
	sealJson(value: unknown): Promise<string>
	openJson<T = unknown>(sealed: string): Promise<T>
}

export type SealerErrorCode =
	| 'malformed'
	| 'unsupported_version'
	| 'decrypt_failed'

const ERROR_MESSAGES: Record<SealerErrorCode, string> = {
	malformed: 'Malformed sealed value',
	unsupported_version: 'Unsupported sealed value version',
	decrypt_failed: 'Could not open sealed value: wrong key or tampered data'
}

export class SealerError extends Error {
	readonly code: SealerErrorCode

	constructor(code: SealerErrorCode) {
		super(ERROR_MESSAGES[code])
		this.name = 'SealerError'
		this.code = code
	}
}

const PREFIX = 'enc:v1:'
const IV_BYTES = 12
const TAG_BYTES = 16
const DEFAULT_INFO = 'hanzio.sealer.aes-256-gcm.v1'

/**
 * AES-256-GCM sealing with a random 96-bit IV per value. Envelope:
 * `enc:v1:<b64url(iv)>.<b64url(tag)>.<b64url(ciphertext)>`.
 */
export function createSealer(options: SealerOptions): Sealer {
	const { secret, salt = '', info = DEFAULT_INFO } = options
	const secretBytes = toBytes(secret)
	if (secretBytes.length === 0) {
		throw new TypeError('Sealer secret must not be empty')
	}

	let keyPromise: Promise<CryptoKey> | undefined
	const getKey = () => {
		if (!keyPromise) {
			keyPromise = deriveKey(secretBytes, salt, info)
			keyPromise.catch(() => {
				keyPromise = undefined
			})
		}
		return keyPromise
	}

	const seal = async (plaintext: string): Promise<string> => {
		const iv = randomBytes(IV_BYTES)
		const encrypted = new Uint8Array(
			await getSubtleCrypto().encrypt(
				{ name: 'AES-GCM', iv },
				await getKey(),
				utf8Encode(plaintext)
			)
		)
		const tagStart = encrypted.length - TAG_BYTES
		return `${PREFIX}${encodeBase64Url(iv)}.${encodeBase64Url(encrypted.subarray(tagStart))}.${encodeBase64Url(encrypted.subarray(0, tagStart))}`
	}

	const open = async (sealed: string): Promise<string> => {
		if (typeof sealed !== 'string' || !sealed.startsWith(PREFIX)) {
			const isOtherVersion =
				typeof sealed === 'string' && /^enc:v\d+:/.test(sealed)
			throw new SealerError(
				isOtherVersion ? 'unsupported_version' : 'malformed'
			)
		}

		const parts = sealed.slice(PREFIX.length).split('.')
		let iv: Uint8Array<ArrayBuffer>
		let tag: Uint8Array
		let ciphertext: Uint8Array
		try {
			if (parts.length !== 3) throw new Error()
			iv = decodeBase64Url(parts[0] as string)
			tag = decodeBase64Url(parts[1] as string)
			ciphertext = decodeBase64Url(parts[2] as string)
		} catch (_error) {
			throw new SealerError('malformed')
		}
		if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
			throw new SealerError('malformed')
		}

		const encrypted = new Uint8Array(ciphertext.length + TAG_BYTES)
		encrypted.set(ciphertext)
		encrypted.set(tag, ciphertext.length)

		const key = await getKey()
		let plaintext: ArrayBuffer
		try {
			plaintext = await getSubtleCrypto().decrypt(
				{ name: 'AES-GCM', iv },
				key,
				encrypted
			)
		} catch (_error) {
			throw new SealerError('decrypt_failed')
		}
		return utf8Decode(plaintext)
	}

	return {
		seal,
		open,
		async sealJson(value) {
			const json = JSON.stringify(value)
			if (json === undefined) {
				throw new TypeError('sealJson value is not JSON-serializable')
			}
			return seal(json)
		},
		async openJson<T = unknown>(sealed: string) {
			return JSON.parse(await open(sealed)) as T
		}
	}
}

async function deriveKey(
	secret: Uint8Array<ArrayBuffer>,
	salt: string,
	info: string
): Promise<CryptoKey> {
	const subtle = getSubtleCrypto()
	const baseKey = await subtle.importKey('raw', secret, 'HKDF', false, [
		'deriveKey'
	])
	return subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: utf8Encode(salt),
			info: utf8Encode(info)
		},
		baseKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	)
}
