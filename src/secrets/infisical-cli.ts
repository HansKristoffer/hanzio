import { acquireCliLock } from './cli-lock'
import { getProcessEnvironment } from './environment'
import { SecretLoadError } from './errors'

/** A logged-in CLI prints its token at once; longer means it waits for a login. */
const CLI_TIMEOUT_MS = 5_000
const MAX_OUTPUT = 10 * 1024 * 1024

// A token is one line without spaces; a sentence like this is a login prompt.
const LOGIN_PROMPT = /login|log in|email|browser|expired/i

type SharedRead = {
	readonly promise: Promise<string>
	readonly controller: AbortController
	waiting: number
}

// One token read per siteUrl at a time in this process; callers share it.
const reads = new Map<string, SharedRead>()

/**
 * Read the active CLI session without a shell or credential-bearing errors.
 * `cliTimeoutMs` exists for tests; the CLI gets 5 s whatever the load deadline.
 */
export async function readInfisicalCliToken(
	options: { readonly siteUrl: string; readonly signal: AbortSignal },
	cliTimeoutMs = CLI_TIMEOUT_MS
): Promise<string> {
	// Import subprocess support only when the CLI is actually selected.
	const { spawn } = await import('node:child_process').catch(() => {
		throw new SecretLoadError(
			'CLI',
			'Infisical CLI fallback requires a runtime with subprocess support. Provide Infisical client credentials or a custom secret loader.'
		)
	})
	const { siteUrl, signal } = options

	signal.throwIfAborted()

	let read = reads.get(siteUrl)

	if (!read) {
		const controller = new AbortController()
		const promise = (async () => {
			// Other processes queue here; the wait counts against callers' deadlines.
			const release = await acquireCliLock(controller.signal)

			try {
				return await runCli(spawn, siteUrl, controller.signal, cliTimeoutMs)
			} finally {
				await release()
			}
		})().finally(() => {
			if (reads.get(siteUrl) === read) {
				reads.delete(siteUrl)
			}
		})

		// Callers observe the result; a read nobody waits for must not crash.
		promise.catch(() => {})
		read = { promise, controller, waiting: 0 }
		reads.set(siteUrl, read)
	}

	const shared = read

	shared.waiting++

	try {
		return await raceAbort(shared.promise, signal)
	} finally {
		// Stop the CLI only when every caller has given up on it.
		if (--shared.waiting === 0 && signal.aborted) {
			if (reads.get(siteUrl) === shared) {
				reads.delete(siteUrl)
			}

			shared.controller.abort()
		}
	}
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(signal.reason)

		signal.addEventListener('abort', abort, { once: true })
		promise
			.then(resolve, reject)
			.finally(() => signal.removeEventListener('abort', abort))
	})
}

function runCli(
	spawn: typeof import('node:child_process').spawn,
	siteUrl: string,
	signal: AbortSignal,
	timeoutMs: number
): Promise<string> {
	const env: Record<string, string | undefined> = {
		...getProcessEnvironment(),
		INFISICAL_DISABLE_UPDATE_CHECK: 'true'
	}

	// Inherited machine tokens would override the CLI's signed-in user session.
	// Remove them from the child copy without changing the parent's environment.
	delete env.INFISICAL_TOKEN
	delete env.INFISICAL_UNIVERSAL_AUTH_ACCESS_TOKEN
	delete env.TOKEN

	const login = `Run infisical login --domain=${siteUrl}.`
	const needsLogin = `The Infisical CLI session for ${siteUrl} has expired or needs a login. ${login}`

	return new Promise<string>((resolve, reject) => {
		const child = spawn(
			'infisical',
			['user', 'get', 'token', '--plain', `--domain=${siteUrl}`, '--silent'],
			{ env, shell: false, stdio: 'pipe', windowsHide: true }
		)
		let stopped: 'login' | 'timeout' | 'output' | undefined
		let settled = false
		let stdout = ''

		const stop = (reason: typeof stopped) => {
			stopped ??= reason
			child.kill('SIGKILL')
		}
		const abort = () => child.kill('SIGKILL')
		const timer = setTimeout(() => stop('timeout'), timeoutMs)
		// CLI output can hold the token or other secrets: never put it in errors.
		const settle = (error: unknown, token?: string) => {
			if (settled) {
				return
			}

			settled = true
			clearTimeout(timer)
			signal.removeEventListener('abort', abort)

			if (error) {
				reject(error)
			} else {
				resolve(token ?? '')
			}
		}

		signal.addEventListener('abort', abort, { once: true })

		for (const stream of [child.stdout, child.stderr]) {
			let line = ''
			let size = 0

			stream?.setEncoding('utf8')
			stream?.on('data', (chunk: string) => {
				size += chunk.length

				if (size > MAX_OUTPUT) {
					stop('output')

					return
				}

				if (stream === child.stdout) {
					stdout += chunk
				}

				// Check the unfinished last line too: a prompt waits without a newline.
				const lines = (line + chunk).split(/\r?\n/)

				line = lines.at(-1) ?? ''

				if (
					lines.some((text) => text.includes(' ') && LOGIN_PROMPT.test(text))
				) {
					stop('login')
				}
			})
		}

		child.on('error', (error: { code?: string }) => {
			settle(
				error.code === 'ENOENT'
					? new SecretLoadError(
							'CLI',
							'Infisical CLI not found. Install infisical and ensure it is on PATH, or provide Infisical client credentials.'
						)
					: new SecretLoadError(
							'CLI',
							`Infisical CLI session token failed. ${login} Then verify access to the configured organization, project, and environment.`
						)
			)
		})
		child.on('close', (code: number | null) => {
			if (signal.aborted) {
				settle(signal.reason)
			} else if (stopped === 'login') {
				settle(new SecretLoadError('AUTHENTICATION', needsLogin))
			} else if (stopped === 'timeout') {
				settle(
					new SecretLoadError(
						'AUTHENTICATION',
						`${needsLogin} If you are logged in, the CLI was only slow to answer within ${timeoutMs / 1000} seconds; retry.`
					)
				)
			} else if (stopped === 'output') {
				settle(
					new SecretLoadError(
						'CLI',
						'Infisical CLI output exceeded the 10 MiB limit.'
					)
				)
			} else if (code !== 0) {
				settle(
					new SecretLoadError(
						'CLI',
						`Infisical CLI session token failed. ${login} Then verify access to the configured organization, project, and environment.`
					)
				)
			} else {
				settle(undefined, stdout.trim())
			}
		})

		// Startup cannot wait for interactive input.
		child.stdin?.end()
	})
}
