import * as jose from 'jose'

export async function jwtSign<_Payload extends object>(
	payload: jose.JWTPayload,
	secret: string
) {
	const secretKey = new TextEncoder().encode(secret)
	return await new jose.SignJWT(payload)
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.sign(secretKey)
}

export async function jwtVerify<Payload extends object>(
	token: string,
	secret: string
): Promise<Payload | null> {
	try {
		const secretKey = new TextEncoder().encode(secret)
		const { payload } = await jose.jwtVerify(token, secretKey)
		return payload as Payload
	} catch (_error) {
		return null
	}
}
