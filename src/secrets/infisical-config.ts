import type { SecretRequestOptions } from './deadline'
import { SecretLoadError } from './errors'

/** Project scope shared by the public Infisical loaders. */
export type InfisicalProjectOptions = {
	readonly projectId: string

	/** Scope CLI user authentication; machine identities already have an organization. */
	readonly organizationId: string
	readonly siteUrl?: string
	readonly secretPath?: string
}

export type InfisicalScope<K extends string> = InfisicalProjectOptions &
	SecretRequestOptions & {
		readonly keys: readonly K[]
		readonly environment: string
		readonly siteUrl: string
	}

export function validateInfisicalScope(options: InfisicalScope<string>): void {
	validateInfisicalOrganizationId(options.organizationId)

	let url: URL

	try {
		url = new URL(options.siteUrl)
	} catch {
		throw new SecretLoadError('CONFIGURATION', 'Invalid Infisical siteUrl.')
	}

	// Keep credentials and other sensitive URL components out of diagnostics.
	if (
		!['http:', 'https:'].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new SecretLoadError(
			'CONFIGURATION',
			'Infisical siteUrl must be an HTTP(S) URL without credentials, query, or fragment.'
		)
	}

	validateInfisicalProjectId(options.projectId)

	if (typeof options.environment !== 'string' || !options.environment.trim()) {
		throw new SecretLoadError(
			'CONFIGURATION',
			'Infisical environment is required and must be a nonempty slug.'
		)
	}

	const secretPath = options.secretPath ?? '/'

	if (typeof secretPath !== 'string' || !secretPath.startsWith('/')) {
		throw new SecretLoadError(
			'CONFIGURATION',
			`Infisical secretPath must start with /, got ${JSON.stringify(secretPath)}.`
		)
	}
}

export function validateInfisicalProjectId(projectId: unknown): void {
	if (typeof projectId !== 'string' || !projectId.trim()) {
		throw new SecretLoadError(
			'CONFIGURATION',
			'Infisical projectId is required and must be a nonempty ID.'
		)
	}
}

/** Validate at configuration time, including for JavaScript callers and local-only loads. */
export function validateInfisicalOrganizationId(organizationId: unknown): void {
	if (
		typeof organizationId !== 'string' ||
		!organizationId.trim() ||
		/\s/.test(organizationId)
	) {
		throw new SecretLoadError(
			'CONFIGURATION',
			'Infisical organizationId is required and must be a nonempty ID without whitespace.'
		)
	}
}
