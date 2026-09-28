---
description: Web Crypto helpers - base64/hex encoding, constant-time compare, random tokens, SHA-256, HMAC and webhook signatures, AES-GCM sealing.
---

# hanzio/crypto

Built only on `globalThis.crypto` (Web Crypto), so it runs in browsers, Workers,
Bun and Node ≥ 19. On Node 18, `globalThis.crypto` may be missing; fix that with
`globalThis.crypto ??= (await import('node:crypto')).webcrypto`. Nothing here
imports `node:crypto`. Hashing and HMAC are async because Web Crypto is; keep
synchronous Node hashing (`createHash`) in apps that need it.

```ts
import {
	createSealer,
	randomToken,
	safeEqual,
	sha256Hex,
	verifyHmacSignature,
	verifySvixSignature
} from 'hanzio/crypto'
```

## Encoding

| Function | Notes |
| --- | --- |
| `encodeBase64(bytes)` / `decodeBase64(value)` | standard alphabet, padded output; decoding accepts missing padding |
| `encodeBase64Url(bytes)` / `decodeBase64Url(value)` | URL-safe, unpadded output; decoding accepts padding |
| `bytesToHex(bytes)` / `hexToBytes(value)` | lowercase output; decoding accepts either case |
| `utf8Encode(string)` / `utf8Decode(bytes)` | invalid UTF-8 decodes to U+FFFD |

`bytes` may be a `Uint8Array` or an `ArrayBuffer`. Decoders throw a `TypeError` on
invalid input, and the message never contains the input.

## Compare and random

```ts
safeEqual(providedToken, expectedToken) // string | Uint8Array, strings compared as UTF-8
randomToken() // 32 random bytes as base64url (43 chars)
randomToken(16) // 22 chars
randomBytes(12) // Uint8Array
```

`safeEqual` always loops over the longer input and never exits early, so timing
can reveal the **lengths** of the inputs but not where they differ. That is fine
for comparing against fixed-length secrets or digests. If the length itself is
sensitive, hash both sides first (`safeEqual(await sha256(a), await sha256(b))`).

## Hashing and HMAC

```ts
await sha256('abc') // Uint8Array
await sha256Hex('abc') // 'ba7816bf…'

await hmacSign(secret, body) // hex HMAC-SHA-256
await hmacSign(secret, body, { algorithm: 'SHA-512', encoding: 'base64url' })

// Meta / GitHub style: `x-hub-signature-256: sha256=<hex>`
await verifyHmacSignature(appSecret, rawBody, request.headers.get('x-hub-signature-256') ?? '', {
	prefix: 'sha256='
})
```

| Option | Default | Values |
| --- | --- | --- |
| `algorithm` | `'SHA-256'` | `'SHA-256' \| 'SHA-384' \| 'SHA-512'` |
| `encoding` | `'hex'` | `'hex' \| 'base64' \| 'base64url'` |
| `prefix` (verify only) | none | stripped before decoding; if it is missing, the result is `false` |

`verifyHmacSignature` decodes the signature and checks it with
`crypto.subtle.verify`, which compares in constant time. A malformed, truncated
or wrongly prefixed signature returns `false`. Configuration errors throw: an
empty secret, or an unknown algorithm or encoding.

## Svix / Standard Webhooks

Resend, Clerk and other Svix-based providers sign
`${id}.${timestamp}.${body}` with HMAC-SHA-256, using the base64 key inside the
`whsec_` secret.

```ts
const ok = await verifySvixSignature({
	secret: env.RESEND_WEBHOOK_SECRET, // 'whsec_…'
	payload: rawBody, // the exact raw body, not re-serialized JSON
	headers: request.headers, // Headers or a plain record
	toleranceSec: 300, // default
	now: Date.now() // default, in milliseconds
})
```

- Reads the `svix-id`, `svix-timestamp` and `svix-signature` headers. If they are
  missing, it reads `webhook-id`, `webhook-timestamp` and `webhook-signature`.
  Header lookup ignores case, also for plain records.
- The signature header is a space-separated list. Every `v1,<base64>` entry is
  checked, so verification keeps working while the provider rotates the secret.
- Returns `false` for missing headers, a non-integer timestamp, a timestamp more
  than `toleranceSec` from `now` in either direction, or no matching signature.
  An invalid secret throws a `TypeError`.

## Sealing (AES-256-GCM)

```ts
const sealer = createSealer({
	secret: env.APP_SECRET,
	info: 'myapp.oauth-tokens.v1' // use a different value for each purpose
})

const sealed = await sealer.sealJson({ accessToken }) // 'enc:v1:…'
const tokens = await sealer.openJson<{ accessToken: string }>(sealed)

await sealer.seal('plain text')
await sealer.open(sealed)
```

- The key is derived from `secret` with HKDF-SHA-256 (`salt`, default empty;
  `info`, default `'hanzio.sealer.aes-256-gcm.v1'`). Derivation runs once per
  sealer, and the resulting `CryptoKey` cannot be exported.
- Each value gets a random 96-bit IV.
- The envelope is `enc:v1:<b64url(iv)>.<b64url(tag)>.<b64url(ciphertext)>`.
- `open` throws a `SealerError` with one of these codes:
  - `'malformed'`
  - `'unsupported_version'`, for `enc:vN:` values other than v1
  - `'decrypt_failed'`, for a wrong key, salt or info, or tampered data

  Error messages never contain the secret or the plaintext.
- `sealJson` stores `JSON.stringify(value)`. It throws for `undefined` and for
  functions.

### Migrating lullu `secret-json.ts`

The envelope and key derivation match `apps/backend/src/lib/crypto/secret-json.ts`,
so values already stored keep opening and don't need to be re-encrypted:

```ts
const sealer = createSealer({
	secret: getSecret('APP_SECRET'),
	salt: 'lullu.secret-json.salt.v1',
	info: 'lullu.secret-json.aes-256-gcm.v1'
})
```

lullu's `openSecretJson` returns non-sealed values unchanged. `open` throws on
them instead, so keep the `value.startsWith('enc:')` check in the app.
