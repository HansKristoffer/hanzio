import {
	decodeBase64Url,
	encodeBase64Url,
	utf8Decode,
	utf8Encode
} from '../crypto/encoding'
import { getSubtleCrypto } from '../crypto/hash'
import type { Result } from '../promise'
import { isRecord } from '../guard'

export type JWTPayload = Record<string, unknown>

export type JwtAlgorithm = 'HS256' | 'HS384' | 'HS512'

export type JwtHeader = { alg: string; typ?: string } & Record<string, unknown>

export type JwtSignOptions = {
	/** Seconds from now until `exp`. */
	expiresIn?: number
	/** Seconds from now until `nbf`. */
	notBefore?: number
	issuer?: string
	audience?: string | string[]
	/** Default: `'HS256'` */
	algorithm?: JwtAlgorithm
}

export type JwtVerifyOptions = {
	/** Clock skew tolerance for `exp`/`nbf`, in seconds. Default: 0 */
	leewaySec?: number
	/** Required `iss` value. */
	issuer?: string
	/** Required `aud` value (matches a string `aud` or an entry of an array `aud`). */
	audience?: string
	/** Accepted header `alg` values. Default: all of HS256/HS384/HS512. */
	algorithms?: JwtAlgorithm[]
}

export type JwtVerifyErrorCode =
	| 'malformed'
	| 'unsupported_alg'
	| 'invalid_signature'
	| 'expired'
	| 'not_yet_valid'
	| 'invalid_issuer'
	| 'invalid_audience'

export class JwtVerifyError extends Error {
	readonly code: JwtVerifyErrorCode

	constructor(code: JwtVerifyErrorCode) {
		super(`JWT verification failed: ${code}`)
		this.name = 'JwtVerifyError'
		this.code = code
	}
}

const HASHES: Record<JwtAlgorithm, string> = {
	HS256: 'SHA-256',
	HS384: 'SHA-384',
	HS512: 'SHA-512'
}
const ALGORITHMS = Object.keys(HASHES) as JwtAlgorithm[]
const BASE64URL = /^[A-Za-z0-9_-]*$/
const KEY_CACHE_LIMIT = 100

/**
 * Signs `payload` as a compact JWS. `iat` is always set to now.
 * Claims derived from `options` (`exp`, `nbf`, `iss`, `aud`) override the same
 * claims in `payload`; payload claims are kept when the option is not given.
 */
export async function jwtSign<Payload extends JWTPayload>(
	payload: Payload,
	secret: string,
	options: JwtSignOptions = {}
): Promise<string> {
	const {
		expiresIn,
		notBefore,
		issuer,
		audience,
		algorithm = 'HS256'
	} = options
	if (!Object.hasOwn(HASHES, algorithm)) {
		throw new TypeError(`Unsupported JWT algorithm: ${algorithm}`)
	}

	const now = Math.floor(Date.now() / 1000)
	const claims: JWTPayload = { ...payload, iat: now }
	if (expiresIn !== undefined) claims.exp = now + toSeconds(expiresIn)
	if (notBefore !== undefined) claims.nbf = now + toSeconds(notBefore)
	if (issuer !== undefined) claims.iss = issuer
	if (audience !== undefined) claims.aud = audience

	const data = `${encodeJson({ alg: algorithm, typ: 'JWT' })}.${encodeJson(claims)}`
	const key = await getKey(secret, algorithm, 'sign')
	const signature = await getSubtleCrypto().sign('HMAC', key, utf8Encode(data))

	return `${data}.${encodeBase64Url(signature)}`
}

/** Verifies a token. Returns `null` for any failure; use `jwtVerifyResult` for the reason. */
export async function jwtVerify<Payload extends JWTPayload>(
	token: string,
	secret: string,
	options?: JwtVerifyOptions
): Promise<Payload | null> {
	try {
		const result = await jwtVerifyResult<Payload>(token, secret, options)
		return result.ok ? result.data : null
	} catch (_error) {
		return null
	}
}

/**
 * Verifies signature, `exp`/`nbf` and optional `iss`/`aud`.
 * Token problems are returned as a failed `Result`; configuration problems
 * (no Web Crypto, empty secret) throw.
 */
export async function jwtVerifyResult<Payload extends JWTPayload>(
	token: string,
	secret: string,
	options: JwtVerifyOptions = {}
): Promise<Result<Payload, JwtVerifyError>> {
	const { leewaySec = 0, issuer, audience, algorithms = ALGORITHMS } = options

	const decoded = jwtDecode<Payload>(token)
	if (!decoded) return fail('malformed')

	const { alg } = decoded.header
	// Only header algs that are both known HMAC algs and explicitly allowed; never 'none'.
	if (
		!Object.hasOwn(HASHES, alg) ||
		!algorithms.includes(alg as JwtAlgorithm)
	) {
		return fail('unsupported_alg')
	}

	const lastDot = token.lastIndexOf('.')
	let signature: Uint8Array<ArrayBuffer>
	try {
		signature = decodeBase64Url(token.slice(lastDot + 1))
	} catch (_error) {
		return fail('malformed')
	}

	const key = await getKey(secret, alg as JwtAlgorithm, 'verify')
	const isValid = await getSubtleCrypto().verify(
		'HMAC',
		key,
		signature,
		utf8Encode(token.slice(0, lastDot))
	)
	if (!isValid) return fail('invalid_signature')

	const { payload } = decoded
	const { exp, nbf } = payload
	if (exp !== undefined && typeof exp !== 'number') return fail('malformed')
	if (nbf !== undefined && typeof nbf !== 'number') return fail('malformed')

	const now = Math.floor(Date.now() / 1000)
	if (exp !== undefined && now >= exp + leewaySec) return fail('expired')
	if (nbf !== undefined && now + leewaySec < nbf) return fail('not_yet_valid')
	if (issuer !== undefined && payload.iss !== issuer) {
		return fail('invalid_issuer')
	}
	if (audience !== undefined) {
		const { aud } = payload
		const matches = Array.isArray(aud)
			? aud.includes(audience)
			: aud === audience
		if (!matches) return fail('invalid_audience')
	}

	return { ok: true, data: payload, error: null }
}

/** Decodes header and payload WITHOUT verifying the signature. Never trust the result for auth. */
export function jwtDecode<Payload extends JWTPayload = JWTPayload>(
	token: string
): { header: JwtHeader; payload: Payload } | null {
	const parts = token.split('.')
	if (parts.length !== 3 || !parts.every((part) => BASE64URL.test(part))) {
		return null
	}

	try {
		const header = decodeJson(parts[0] as string)
		const payload = decodeJson(parts[1] as string)
		if (!isRecord(header) || typeof header.alg !== 'string') return null
		if (!isRecord(payload)) return null

		return { header: header as JwtHeader, payload: payload as Payload }
	} catch (_error) {
		return null
	}
}

function fail(code: JwtVerifyErrorCode): Result<never, JwtVerifyError> {
	return { ok: false, data: null, error: new JwtVerifyError(code) }
}

function toSeconds(value: number): number {
	// NaN/Infinity would serialize to `null` and silently drop the claim.
	if (!Number.isFinite(value)) {
		throw new TypeError(`Expected a finite number of seconds, got ${value}`)
	}
	return Math.floor(value)
}

// ponytail: cleared wholesale at KEY_CACHE_LIMIT entries; swap for an LRU if
// an app rotates through more than ~100 secrets.
const keyCache = new Map<string, Promise<CryptoKey>>()

function getKey(
	secret: string,
	algorithm: JwtAlgorithm,
	usage: 'sign' | 'verify'
): Promise<CryptoKey> {
	const cacheKey = `${algorithm}:${usage}:${secret}`
	const cached = keyCache.get(cacheKey)
	if (cached) return cached

	if (keyCache.size >= KEY_CACHE_LIMIT) keyCache.clear()
	const key = getSubtleCrypto().importKey(
		'raw',
		utf8Encode(secret),
		{ name: 'HMAC', hash: HASHES[algorithm] },
		false,
		[usage]
	)
	keyCache.set(cacheKey, key)
	key.catch(() => keyCache.delete(cacheKey))

	return key
}

function encodeJson(value: JWTPayload): string {
	return encodeBase64Url(utf8Encode(JSON.stringify(value)))
}

function decodeJson(value: string): unknown {
	return JSON.parse(utf8Decode(decodeBase64Url(value)))
}
