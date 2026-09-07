export type SecretErrorCode =
	| 'CONFIGURATION'
	| 'AUTHENTICATION'
	| 'HTTP'
	| 'CLI'
	| 'VALIDATION'
	| 'MISSING_SECRETS'
	| 'TIMEOUT'
	| 'ABORTED'
	| 'LOADER'

/** Contains only safe diagnostic metadata; never attach underlying errors. */
export class SecretLoadError extends Error {
	readonly code: SecretErrorCode
	readonly operation?: string
	readonly status?: number

	constructor(
		code: SecretErrorCode,
		message: string,
		details: { operation?: string; status?: number } = {}
	) {
		super(message)
		this.name = 'SecretLoadError'
		this.code = code
		this.operation = details.operation
		this.status = details.status
	}
}
