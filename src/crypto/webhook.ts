import { decodeBase64 } from './encoding'
import { hmacSign, safeEqual } from './hash'

export type VerifySvixSignatureOptions = {
	/** Signing secret, `whsec_<base64>` (the prefix is optional). */
	secret: string
	/** The raw request body, exactly as received. */
	payload: string
	headers: Headers | Record<string, string | undefined>
	/** Max age/skew of the timestamp header, in seconds. Default: 300 */
	toleranceSec?: number
	/** Current time in milliseconds. Default: `Date.now()` */
	now?: number
}

const TIMESTAMP = /^\d+$/

/**
 * Verifies a Svix / Standard Webhooks signature (Resend, Clerk, …): base64
 * HMAC-SHA256 over `${id}.${timestamp}.${payload}`, keyed by the base64 body
 * of the `whsec_` secret. Reads `svix-*` headers, falling back to `webhook-*`.
 * Every `v1,` entry in the space-separated signature header is checked, so
 * secret rotation works. Returns `false` for missing/stale headers or a bad
 * signature; throws on an invalid secret.
 */
export async function verifySvixSignature(
	options: VerifySvixSignatureOptions
): Promise<boolean> {
	const {
		secret,
		payload,
		headers,
		toleranceSec = 300,
		now = Date.now()
	} = options

	let key: Uint8Array
	try {
		key = decodeBase64(secret.startsWith('whsec_') ? secret.slice(6) : secret)
	} catch (_error) {
		throw new TypeError('Invalid webhook secret: expected whsec_<base64>')
	}
	if (key.length === 0) throw new TypeError('Webhook secret must not be empty')

	const id = getHeader(headers, 'id')
	const timestamp = getHeader(headers, 'timestamp')
	const signatureHeader = getHeader(headers, 'signature')
	if (!id || !timestamp || !signatureHeader) return false

	if (!TIMESTAMP.test(timestamp)) return false
	if (Math.abs(now / 1000 - Number(timestamp)) > toleranceSec) return false

	const expected = await hmacSign(key, `${id}.${timestamp}.${payload}`, {
		encoding: 'base64'
	})

	return signatureHeader.split(' ').some((entry) => {
		const comma = entry.indexOf(',')
		if (comma === -1 || entry.slice(0, comma) !== 'v1') return false
		return safeEqual(entry.slice(comma + 1), expected)
	})
}

function getHeader(
	headers: VerifySvixSignatureOptions['headers'],
	name: 'id' | 'timestamp' | 'signature'
): string | undefined {
	for (const prefix of ['svix-', 'webhook-']) {
		const value = readHeader(headers, prefix + name)
		if (value) return value
	}
	return undefined
}

function readHeader(
	headers: VerifySvixSignatureOptions['headers'],
	name: string
): string | undefined {
	if (typeof headers.get === 'function') {
		return (headers as Headers).get(name) ?? undefined
	}
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === name) return value
	}
	return undefined
}
