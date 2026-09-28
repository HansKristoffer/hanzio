---
description: JWT sign/verify/decode using built-in Web Crypto HMAC (HS256/HS384/HS512).
---

# hanzio/jwt

```ts
import { jwtDecode, jwtSign, jwtVerify, jwtVerifyResult } from 'hanzio/jwt'

const token = await jwtSign({ sub: 'user-1' }, secret, {
	expiresIn: 60 * 60, // seconds
	issuer: 'api',
	audience: 'web'
})

// Payload or null
const payload = await jwtVerify<{ sub: string }>(token, secret)

// Result with a reason
const result = await jwtVerifyResult(token, secret, {
	issuer: 'api',
	audience: 'web',
	leewaySec: 30
})
if (!result.ok) console.log(result.error.code) // 'expired', 'invalid_signature', …

// Unverified: for reading claims client-side, never for auth
const decoded = jwtDecode(token) // { header, payload } | null
```

## Signing

`jwtSign(payload, secret, options?)`

| Option       | Claim | Notes                               |
| ------------ | ----- | ----------------------------------- |
| `expiresIn`  | `exp` | seconds from now                    |
| `notBefore`  | `nbf` | seconds from now                    |
| `issuer`     | `iss` |                                     |
| `audience`   | `aud` | `string \| string[]`                |
| `algorithm`  | —     | `'HS256'` (default), `'HS384'`, `'HS512'` |

- `iat` is always set to the current time.
- Options win: a claim set through an option replaces the same claim in `payload`.
  Payload claims are kept when the option is omitted.
- Non-finite `expiresIn`/`notBefore` throw a `TypeError`.
- The header is `{ alg, typ: 'JWT' }`.

## Verifying

`jwtVerifyResult(token, secret, options?)` returns
`Result<Payload, JwtVerifyError>` (see `hanzio` promise helpers). `error.code` is one of
`'malformed' | 'unsupported_alg' | 'invalid_signature' | 'expired' | 'not_yet_valid' | 'invalid_issuer' | 'invalid_audience'`.

| Option       | Default                 | Notes                                      |
| ------------ | ----------------------- | ------------------------------------------ |
| `leewaySec`  | `0`                     | clock skew tolerance for `exp` / `nbf`     |
| `issuer`     | —                       | required `iss`                             |
| `audience`   | —                       | must equal `aud` or be one of its entries  |
| `algorithms` | `['HS256','HS384','HS512']` | the header `alg` must be in this list |

- The signature is checked before any claim, so unsigned claims never decide the error code.
- `alg: 'none'` and anything outside `algorithms` is rejected as `unsupported_alg`.
- Configuration errors (no Web Crypto, empty secret) throw. `jwtVerify` swallows them
  and returns `null`, like any other failure.

Imported `CryptoKey`s are cached per secret, algorithm and usage (up to 100 entries).

The base64url and UTF-8 helpers this module uses are public in
[`hanzio/crypto`](../crypto/README.md) (`encodeBase64Url`, `decodeBase64Url`, …).
