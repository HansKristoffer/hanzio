import {
	type BytesLike,
	decodeBase64Url,
	encodeBase64Url,
	toBytes,
	utf8Decode,
	utf8Encode
} from './encoding.js'
import { getSubtleCrypto, randomBytes } from './hash.js'

export type SealerOptions = {
	/** High-entropy secret (e.g. `APP_SECRET`). The AES key is derived from it with HKDF-SHA-256. */
	secret: string | BytesLike
	/** HKDF salt. Default: empty */
	salt?: string
	/** HKDF info; use a distinct value per purpose. Default: `'hanzio.sealer.aes-256-gcm.v1'` */
	info?: string
	/**
	 * Older `{ salt, info }` pairs that `open` also tries, so values sealed before
	 * a rename stay readable. `seal` always uses `salt` and `info`.
	 */
	fallbacks?: readonly { salt?: string; info?: string }[]
	/**
	 * `open` and `openJson` return a value that was never sealed unchanged
	 * (`{}`, a legacy plaintext) instead of throwing. Malformed envelopes and
	 * other envelope versions still throw.
	 */
	passthroughUnsealed?: boolean
}

export type Sealer = {
	seal(plaintext: string): Promise<string>
	open(sealed: string): Promise<string>
	sealJson(value: unknown): Promise<string>
	openJson<T = unknown>(sealed: unknown): Promise<T>
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

// The helpers below are shared with the `node:crypto` sealer in `./node`.

/** The secret's bytes and every HKDF context `open` tries, primary first. */
export function sealerKeyInputs(options: SealerOptions) {
	const secret = toBytes(options.secret)
	if (secret.length === 0) {
		throw new TypeError('Sealer secret must not be empty')
	}
	const contexts = [options, ...(options.fallbacks ?? [])].map(
		({ salt = '', info = DEFAULT_INFO }) => ({ salt, info })
	)
	return { secret, contexts }
}

export function formatEnvelope(
	iv: Uint8Array,
	tag: Uint8Array,
	ciphertext: Uint8Array
): string {
	return `${PREFIX}${encodeBase64Url(iv)}.${encodeBase64Url(tag)}.${encodeBase64Url(ciphertext)}`
}

export type Envelope = {
	iv: Uint8Array<ArrayBuffer>
	tag: Uint8Array<ArrayBuffer>
	ciphertext: Uint8Array<ArrayBuffer>
}

/** `null` means `sealed` was never sealed and `passthroughUnsealed` allows it. */
export function parseEnvelope(
	sealed: unknown,
	passthroughUnsealed = false
): Envelope | null {
	if (typeof sealed !== 'string' || !sealed.startsWith(PREFIX)) {
		const isEnvelope = typeof sealed === 'string' && /^enc:v\d+:/.test(sealed)
		if (isEnvelope) throw new SealerError('unsupported_version')
		if (passthroughUnsealed) return null
		throw new SealerError('malformed')
	}

	const parts = sealed.slice(PREFIX.length).split('.')
	let envelope: Envelope
	try {
		if (parts.length !== 3) throw new Error()
		envelope = {
			iv: decodeBase64Url(parts[0] as string),
			tag: decodeBase64Url(parts[1] as string),
			ciphertext: decodeBase64Url(parts[2] as string)
		}
	} catch (_error) {
		throw new SealerError('malformed')
	}
	if (envelope.iv.length !== IV_BYTES || envelope.tag.length !== TAG_BYTES) {
		throw new SealerError('malformed')
	}
	return envelope
}

export function jsonToSeal(value: unknown): string {
	const json = JSON.stringify(value)
	if (json === undefined) {
		throw new TypeError('sealJson value is not JSON-serializable')
	}
	return json
}

/**
 * AES-256-GCM sealing with a random 96-bit IV per value. Envelope:
 * `enc:v1:<b64url(iv)>.<b64url(tag)>.<b64url(ciphertext)>`. Async, on Web
 * Crypto; `hanzio/crypto/node` has a synchronous twin with the same envelope.
 */
export function createSealer(options: SealerOptions): Sealer {
	const { secret, contexts } = sealerKeyInputs(options)

	const keys: (Promise<CryptoKey> | undefined)[] = []
	const getKey = (index: number) => {
		let key = keys[index]
		if (!key) {
			const context = contexts[index] as (typeof contexts)[number]
			key = deriveKey(secret, context.salt, context.info)
			keys[index] = key
			key.catch(() => {
				keys[index] = undefined
			})
		}
		return key
	}

	const seal = async (plaintext: string): Promise<string> => {
		const iv = randomBytes(IV_BYTES)
		const encrypted = new Uint8Array(
			await getSubtleCrypto().encrypt(
				{ name: 'AES-GCM', iv },
				await getKey(0),
				utf8Encode(plaintext)
			)
		)
		const tagStart = encrypted.length - TAG_BYTES
		return formatEnvelope(
			iv,
			encrypted.subarray(tagStart),
			encrypted.subarray(0, tagStart)
		)
	}

	const openEnvelope = async ({ iv, tag, ciphertext }: Envelope) => {
		const encrypted = new Uint8Array(ciphertext.length + TAG_BYTES)
		encrypted.set(ciphertext)
		encrypted.set(tag, ciphertext.length)

		for (let index = 0; index < contexts.length; index++) {
			const key = await getKey(index)
			try {
				return utf8Decode(
					await getSubtleCrypto().decrypt(
						{ name: 'AES-GCM', iv },
						key,
						encrypted
					)
				)
			} catch (_error) {}
		}
		throw new SealerError('decrypt_failed')
	}

	const open = async (sealed: string): Promise<string> => {
		const envelope = parseEnvelope(sealed, options.passthroughUnsealed)
		return envelope ? openEnvelope(envelope) : sealed
	}

	return {
		seal,
		open,
		sealJson: async (value) => seal(jsonToSeal(value)),
		async openJson<T = unknown>(sealed: unknown) {
			const envelope = parseEnvelope(sealed, options.passthroughUnsealed)
			return (envelope ? JSON.parse(await openEnvelope(envelope)) : sealed) as T
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
