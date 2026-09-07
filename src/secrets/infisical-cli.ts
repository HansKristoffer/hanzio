import type { SecretRequestOptions } from './deadline'
import { getProcessEnvironment } from './environment'
import { SecretLoadError } from './errors'

/** Read the active CLI session without a shell or credential-bearing errors. */
export async function readInfisicalCliToken(
	options: SecretRequestOptions & { siteUrl: string; signal: AbortSignal }
): Promise<string> {
	// Import subprocess support only when the CLI is actually selected.
	const { execFile } = await import('node:child_process').catch(() => {
		throw new SecretLoadError(
			'CLI',
			'Infisical CLI fallback requires a runtime with subprocess support. Provide Infisical client credentials or a custom secret loader.'
		)
	})

	options.signal.throwIfAborted()

	const env: Record<string, string | undefined> = {
		...getProcessEnvironment(),
		INFISICAL_DISABLE_UPDATE_CHECK: 'true'
	}

	// Inherited machine tokens would override the CLI's signed-in user session.
	// Remove them from the child copy without changing the parent's environment.
	delete env.INFISICAL_TOKEN
	delete env.INFISICAL_UNIVERSAL_AUTH_ACCESS_TOKEN
	delete env.TOKEN

	try {
		const stdout = await new Promise<string>((resolve, reject) => {
			const child = execFile(
				'infisical',
				[
					'user',
					'get',
					'token',
					'--plain',
					`--domain=${options.siteUrl}`,
					'--silent'
				],
				{
					env,
					encoding: 'utf8',
					shell: false,
					timeout: options.timeoutMs ?? 30_000,
					signal: options.signal,
					killSignal: 'SIGKILL',
					maxBuffer: 10 * 1024 * 1024,
					windowsHide: true
				},
				(error, output) => {
					if (error) {
						reject(error)
					} else {
						resolve(output)
					}
				}
			)

			// Startup cannot wait for interactive input.
			child.stdin?.end()
		})
		return stdout.trim()
	} catch (error) {
		if (options.signal.aborted) {
			throw options.signal.reason
		}

		// Subprocess errors can contain secret stdout/stderr, so rebuild the error.
		const failure = error as { code?: string | number; killed?: boolean } | null

		if (failure?.code === 'ENOENT') {
			throw new SecretLoadError(
				'CLI',
				'Infisical CLI not found. Install infisical and ensure it is on PATH, or provide Infisical client credentials.'
			)
		}

		if (failure?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
			throw new SecretLoadError(
				'CLI',
				'Infisical CLI output exceeded the 10 MiB limit.'
			)
		}

		if (failure?.killed) {
			throw new SecretLoadError(
				'TIMEOUT',
				`Infisical CLI timed out after ${(options.timeoutMs ?? 30_000) / 1000} seconds or was terminated.`
			)
		}

		throw new SecretLoadError(
			'CLI',
			`Infisical CLI session token failed. Run infisical login --domain=${options.siteUrl} and verify access to the configured organization, project, and environment.`
		)
	}
}
