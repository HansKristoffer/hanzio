import { z } from 'zod'
import { SecretLoadError } from './errors'

const sessionClaimsSchema = z.object({
	organizationId: z.string().optional(),
	subOrganizationId: z.string().optional(),
	exp: z.number().finite().optional()
})

/** Read routing metadata only. JWT signature and permissions are verified by Infisical. */
export function parseInfisicalSessionToken(token: string): {
	organizationId?: string
} {
	let claims: z.infer<typeof sessionClaimsSchema>

	try {
		// Reject empty, formatted, or multiline CLI output before making an HTTP request.
		if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
			throw new Error('Invalid token format')
		}

		const payload = token.split('.')[1]!
		const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))

		claims = sessionClaimsSchema.parse(JSON.parse(json))
	} catch {
		throw new SecretLoadError(
			'AUTHENTICATION',
			'Infisical returned an invalid user session token. Run infisical login for the configured domain.'
		)
	}

	if (claims.exp !== undefined && claims.exp <= Date.now() / 1000) {
		throw new SecretLoadError(
			'AUTHENTICATION',
			'Infisical user session has expired. Run infisical login for the configured domain.'
		)
	}

	// For sub-organizations, the root organization claim does not identify the scope.
	return { organizationId: claims.subOrganizationId ?? claims.organizationId }
}
