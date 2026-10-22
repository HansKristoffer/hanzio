// Synchronous twin of `createSealer`, on `node:crypto`, for code that cannot
// await: formatters, getters, Prisma result extensions. Same options, same
// envelope, so either sealer opens what the other sealed.

import {
	createCipheriv,
	createDecipheriv,
	hkdfSync,
	randomBytes
} from 'node:crypto'
import {
	type Envelope,
	formatEnvelope,
	jsonToSeal,
	parseEnvelope,
	type SealerOptions,
	SealerError,
	sealerKeyInputs
} from './sealer.js'

export {
	SealerError,
	type SealerErrorCode,
	type SealerOptions
} from './sealer.js'

export type SealerSync = {
	seal(plaintext: string): string
	open(sealed: string): string
	sealJson(value: unknown): string
	openJson<T = unknown>(sealed: unknown): T
}

const ALGORITHM = 'aes-256-gcm'

/**
 * AES-256-GCM sealing with a random 96-bit IV per value, synchronously.
 *
 * @example
 * const secrets = createSealerSync({ secret: process.env.APP_SECRET!, info: 'app.credentials.v1' })
 * const stored = secrets.sealJson({ accessToken })
 * const { accessToken } = secrets.openJson<{ accessToken: string }>(stored)
 */
export function createSealerSync(options: SealerOptions): SealerSync {
	const { secret, contexts } = sealerKeyInputs(options)

	const keys: Buffer[] = []
	const getKey = (index: number) => {
		let key = keys[index]
		if (!key) {
			const { salt, info } = contexts[index] as (typeof contexts)[number]
			key = Buffer.from(hkdfSync('sha256', secret, salt, info, 32))
			keys[index] = key
		}
		return key
	}

	const seal = (plaintext: string) => {
		const iv = randomBytes(12)
		const cipher = createCipheriv(ALGORITHM, getKey(0), iv)
		const ciphertext = Buffer.concat([
			cipher.update(plaintext, 'utf8'),
			cipher.final()
		])
		return formatEnvelope(iv, cipher.getAuthTag(), ciphertext)
	}

	const openEnvelope = ({ iv, tag, ciphertext }: Envelope) => {
		for (let index = 0; index < contexts.length; index++) {
			try {
				const decipher = createDecipheriv(ALGORITHM, getKey(index), iv)
				decipher.setAuthTag(tag)
				return Buffer.concat([
					decipher.update(ciphertext),
					decipher.final()
				]).toString('utf8')
			} catch (_error) {}
		}
		throw new SealerError('decrypt_failed')
	}

	return {
		seal,
		open(sealed) {
			const envelope = parseEnvelope(sealed, options.passthroughUnsealed)
			return envelope ? openEnvelope(envelope) : sealed
		},
		sealJson: (value) => seal(jsonToSeal(value)),
		openJson<T = unknown>(sealed: unknown) {
			const envelope = parseEnvelope(sealed, options.passthroughUnsealed)
			return (envelope ? JSON.parse(openEnvelope(envelope)) : sealed) as T
		}
	}
}
