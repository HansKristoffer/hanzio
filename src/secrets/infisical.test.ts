import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test
} from 'bun:test'
import * as childProcess from 'node:child_process'
import { inspect } from 'node:util'
import {
	cloudflareWorkerEnvLoader,
	defineSecretSet,
	fetchInfisicalSecrets,
	infisicalLoader,
	loadInfisicalSecrets,
	processEnvLoader
} from '.'

const envKeys = [
	'INFISICAL_CLIENT_ID',
	'INFISICAL_CLIENT_SECRET',
	'INFISICAL_TOKEN',
	'INFISICAL_UNIVERSAL_AUTH_ACCESS_TOKEN',
	'TOKEN',
	'TEST_INFISICAL_ID',
	'TEST_INFISICAL_SECRET',
	'TEST_CLI_SECRET',
	'TEST_CLI_OTHER',
	'TEST_CLI_IGNORED'
] as const
const originalEnv = Object.fromEntries(
	envKeys.map((key) => [key, process.env[key]])
)
const originalFetch = globalThis.fetch
const options = {
	keys: ['TEST_CLI_SECRET'] as const,
	organizationId: 'org-a',
	projectId: 'project-id',
	environment: 'staging' as const,
	siteUrl: 'https://eu.infisical.com',
	clientIdEnvKey: 'INFISICAL_CLIENT_ID',
	clientSecretEnvKey: 'INFISICAL_CLIENT_SECRET'
}

const cliSource =
	'Infisical CLI session (organization=org-a project=project-id environment=staging)'

let remoteSecrets: { secretKey: string; secretValue: string }[]
let output: string
let failure: Error | null
const endInput = mock(() => {})
const execute = mock(
	(
		_file: string,
		_args: readonly string[],
		_options: childProcess.ExecFileOptions,
		callback: (error: Error | null, stdout: string, stderr: string) => void
	) => {
		callback(failure, output, 'private stderr')

		return { stdin: { end: endInput } } as unknown as childProcess.ChildProcess
	}
)
let execSpy: ReturnType<typeof spyOn<typeof childProcess, 'execFile'>>
let logSpy: ReturnType<typeof spyOn<typeof console, 'log'>>

beforeEach(() => {
	for (const key of envKeys) {
		delete process.env[key]
	}

	output = sessionToken('org-a')
	remoteSecrets = [
		{ secretKey: 'TEST_CLI_SECRET', secretValue: 'remote-value' },
		{ secretKey: 'TEST_CLI_IGNORED', secretValue: 'ignored-value' }
	]
	failure = null
	execute.mockClear()
	endInput.mockClear()
	execSpy = spyOn(childProcess, 'execFile').mockImplementation(
		execute as unknown as typeof childProcess.execFile
	)
	logSpy = spyOn(console, 'log').mockImplementation(() => {})
	globalThis.fetch = mock(async (url: string | URL | Request) => {
		if (new URL(String(url)).pathname === '/api/v4/secrets') {
			return Response.json({ secrets: remoteSecrets })
		}

		throw new Error('Unexpected HTTP request')
	}) as unknown as typeof fetch
})

afterEach(() => {
	execSpy.mockRestore()
	logSpy.mockRestore()
	globalThis.fetch = originalFetch

	for (const key of envKeys) {
		const value = originalEnv[key]

		if (value === undefined) {
			delete process.env[key]
		} else {
			process.env[key] = value
		}
	}
})

describe('Infisical CLI fallback', () => {
	test('uses the signed-in CLI session with explicit scope and filters secrets', async () => {
		process.env.INFISICAL_TOKEN = 'machine-token'
		process.env.INFISICAL_UNIVERSAL_AUTH_ACCESS_TOKEN = 'universal-token'
		process.env.TOKEN = 'legacy-token'

		const secrets = await loadInfisicalSecrets(options)

		expect(secrets).toEqual({ TEST_CLI_SECRET: 'remote-value' })
		expect(execute).toHaveBeenCalledTimes(1)

		const [file, args, settings] = execute.mock.calls[0]!

		expect(file).toBe('infisical')
		expect(args).toEqual([
			'user',
			'get',
			'token',
			'--plain',
			'--domain=https://eu.infisical.com',
			'--silent'
		])
		expect(settings).toMatchObject({
			shell: false,
			encoding: 'utf8',
			timeout: 30_000,
			killSignal: 'SIGKILL',
			maxBuffer: 10 * 1024 * 1024
		})
		expect(settings.env?.PATH).toBe(process.env.PATH)
		expect(settings.env?.INFISICAL_DISABLE_UPDATE_CHECK).toBe('true')

		for (const key of [
			'INFISICAL_TOKEN',
			'INFISICAL_UNIVERSAL_AUTH_ACCESS_TOKEN',
			'TOKEN'
		]) {
			expect(settings.env).not.toHaveProperty(key)
			expect(process.env[key]).toBeDefined()
		}

		expect(endInput).toHaveBeenCalledTimes(1)
		expect(globalThis.fetch).toHaveBeenCalledTimes(1)
	})

	test.each([
		['client-id', undefined],
		[undefined, 'client-secret'],
		['', 'client-secret'],
		['client-id', '']
	])('falls back with incomplete credentials (%s, %s)', async (id, secret) => {
		if (id !== undefined) {
			process.env.INFISICAL_CLIENT_ID = id
		}

		if (secret !== undefined) {
			process.env.INFISICAL_CLIENT_SECRET = secret
		}

		await loadInfisicalSecrets(options)

		expect(execute).toHaveBeenCalledTimes(1)
	})

	test('uses custom credential names when choosing the fallback', async () => {
		process.env.INFISICAL_CLIENT_ID = 'unused-id'
		process.env.INFISICAL_CLIENT_SECRET = 'unused-secret'
		await loadInfisicalSecrets({
			...options,
			clientIdEnvKey: 'TEST_INFISICAL_ID',
			clientSecretEnvKey: 'TEST_INFISICAL_SECRET'
		})

		expect(execute).toHaveBeenCalledTimes(1)
	})

	test.each([
		false,
		true
	])('complete credentials keep HTTP authentication (custom: %s)', async (custom) => {
		const clientIdEnvKey = custom ? 'TEST_INFISICAL_ID' : 'INFISICAL_CLIENT_ID'
		const clientSecretEnvKey = custom
			? 'TEST_INFISICAL_SECRET'
			: 'INFISICAL_CLIENT_SECRET'

		process.env[clientIdEnvKey] = 'http-id'
		process.env[clientSecretEnvKey] = 'http-secret'
		globalThis.fetch = mock(
			async (url: string | URL | Request, init?: RequestInit) => {
				if (String(url).endsWith('/login')) {
					expect(JSON.parse(String(init?.body))).toEqual({
						clientId: 'http-id',
						clientSecret: 'http-secret'
					})

					return Response.json({ accessToken: 'access-token' })
				}

				return Response.json({
					secrets: [{ secretKey: 'TEST_CLI_SECRET', secretValue: 'http-value' }]
				})
			}
		) as unknown as typeof fetch

		expect(
			await loadInfisicalSecrets({
				...options,
				clientIdEnvKey,
				clientSecretEnvKey
			})
		).toEqual({ TEST_CLI_SECRET: 'http-value' })
		expect(execute).not.toHaveBeenCalled()
	})

	test('does not fall back after HTTP authentication fails', async () => {
		process.env.INFISICAL_CLIENT_ID = 'invalid-id'
		process.env.INFISICAL_CLIENT_SECRET = 'invalid-secret'
		globalThis.fetch = mock(async () =>
			Response.json({ message: 'Unauthorized' }, { status: 401 })
		) as unknown as typeof fetch
		await expect(loadInfisicalSecrets(options)).rejects.toThrow()

		expect(execute).not.toHaveBeenCalled()
	})

	test('preserves local precedence, reload, and multiline values', async () => {
		process.env.TEST_CLI_OTHER = 'local-value'

		const secretSet = await defineSecretSet(
			['TEST_CLI_SECRET', 'TEST_CLI_OTHER'],
			options
		)

		expect(secretSet.secrets()).toEqual({
			TEST_CLI_SECRET: 'remote-value',
			TEST_CLI_OTHER: 'local-value'
		})
		expect(process.env.TEST_CLI_SECRET).toBe('remote-value')
		expect(process.env.TEST_CLI_IGNORED).toBeUndefined()
		expect(logSpy.mock.calls.join(' ')).toContain(`${cliSource} + process.env`)
		expect(logSpy.mock.calls.join(' ')).not.toContain('remote-value')

		process.env.TEST_CLI_OTHER = 'new-local-value'
		remoteSecrets = [
			{
				secretKey: 'TEST_CLI_SECRET',
				secretValue: 'line one\n"line two"\\end'
			},
			{ secretKey: 'TEST_CLI_OTHER', secretValue: 'remote-other' }
		]
		await secretSet.reload()

		expect(secretSet.secret('TEST_CLI_SECRET')).toBe(
			'line one\n"line two"\\end'
		)
		expect(secretSet.secret('TEST_CLI_OTHER')).toBe('new-local-value')
		expect(execute).toHaveBeenCalledTimes(2)
	})

	test('skips the CLI when all required values are already in the environment', async () => {
		process.env.TEST_CLI_SECRET = 'local-value'
		await defineSecretSet(options.keys, options)

		expect(execute).not.toHaveBeenCalled()
		expect(logSpy.mock.calls.join(' ')).toContain('process.env')
		expect(logSpy.mock.calls.join(' ')).not.toContain('Infisical CLI')
	})

	test('keeps missing-secret validation and does not write partial results', async () => {
		await expect(
			defineSecretSet(['TEST_CLI_SECRET', 'TEST_CLI_OTHER'], options)
		).rejects.toThrow('Missing secrets: TEST_CLI_OTHER')

		expect(process.env.TEST_CLI_SECRET).toBeUndefined()
	})

	test.each([
		'[]',
		'[{"secretKey":"TEST_CLI_SECRET","secretValue":""}]'
	])('rejects missing or empty required secrets: %s', async (json) => {
		remoteSecrets = JSON.parse(json)
		await expect(defineSecretSet(options.keys, options)).rejects.toThrow(
			'Missing secrets: TEST_CLI_SECRET'
		)
	})

	test.each([
		'private invalid JSON',
		'{}',
		'null',
		'[{"key":"TEST_CLI_SECRET","value":123}]'
	])('sanitizes invalid JSON errors: %s', async (json) => {
		globalThis.fetch = mock(
			async () =>
				new Response(json, {
					headers: { 'content-type': 'application/json' }
				})
		) as unknown as typeof fetch

		await expect(loadInfisicalSecrets(options)).rejects.toMatchObject({
			code: 'HTTP',
			operation: 'listSecrets'
		})
	})

	test.each([
		[{ code: 'ENOENT' }, 'Infisical CLI not found'],
		[{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, '10 MiB limit'],
		[{ killed: true }, 'timed out after 30 seconds'],
		[{ code: 1 }, 'infisical login --domain=https://eu.infisical.com'],
		[{ code: 'EACCES' }, 'Infisical CLI session token failed']
	])('sanitizes subprocess errors (%j)', async (details, message) => {
		failure = Object.assign(new Error('private error'), details, {
			stdout: 'private stdout',
			stderr: 'private stderr'
		})

		try {
			await loadInfisicalSecrets(options)

			throw new Error('Expected CLI failure')
		} catch (error) {
			expect(error).toBeInstanceOf(Error)
			expect((error as Error).message).toContain(message)
			expect(String(error)).not.toContain('private')
			expect((error as Error).cause).toBeUndefined()
		}
	})

	test('custom loaders do not invoke the CLI', async () => {
		await defineSecretSet(options.keys, {
			loader: cloudflareWorkerEnvLoader({ TEST_CLI_SECRET: 'worker-value' })
		})
		process.env.TEST_CLI_SECRET = 'explicit-process-value'
		await defineSecretSet(options.keys, { loader: processEnvLoader })
		delete process.env.TEST_CLI_SECRET
		await expect(
			defineSecretSet(options.keys, {
				loader: infisicalLoader({
					organizationId: 'org-a',
					projectId: 'project-id',
					clientId: 'id',
					clientSecret: 'secret'
				})
			})
		).rejects.toThrow()

		expect(execute).not.toHaveBeenCalled()
	})
})

describe('Infisical controls and safe HTTP failures', () => {
	test('HTTP-only mode rejects missing credentials without invoking CLI', async () => {
		await expect(
			loadInfisicalSecrets({ ...options, auth: 'http' })
		).rejects.toMatchObject({ code: 'AUTHENTICATION' })

		expect(execute).not.toHaveBeenCalled()
	})

	test('CLI-only mode ignores available client credentials and passes folder and timeout', async () => {
		process.env.INFISICAL_CLIENT_ID = 'unused-id'
		process.env.INFISICAL_CLIENT_SECRET = 'unused-secret'

		const logger = { info: mock(() => {}), error: mock(() => {}) }
		const set = await defineSecretSet(options.keys, {
			...options,
			auth: 'cli',
			secretPath: '/backend',
			timeoutMs: 5000,
			logger
		})

		expect(globalThis.fetch).toHaveBeenCalledWith(
			expect.stringContaining('secretPath=%2Fbackend'),
			expect.anything()
		)
		expect(execute.mock.calls[0]?.[2]).toMatchObject({ timeout: 5000 })
		expect(globalThis.fetch).toHaveBeenCalledTimes(1)
		expect(logger.info.mock.calls[0]).toMatchObject([
			'Loaded secrets',
			{ sources: { [cliSource]: 1 } }
		])

		await set.reload({ timeoutMs: 20_000 })

		expect(execute.mock.calls[1]?.[2]).toMatchObject({ timeout: 20_000 })
	})

	test('passes folder and custom environment through HTTP', async () => {
		process.env.INFISICAL_CLIENT_ID = 'id'
		process.env.INFISICAL_CLIENT_SECRET = 'secret'
		globalThis.fetch = mock(async (url: string | URL | Request) => {
			if (String(url).endsWith('/login')) {
				return Response.json({ accessToken: 'token' })
			}

			const query = new URL(String(url)).searchParams

			expect(query.get('secretPath')).toBe('/backend')
			expect(query.get('environment')).toBe('preview-123')

			return Response.json({
				secrets: [{ secretKey: 'TEST_CLI_SECRET', secretValue: 'value' }]
			})
		}) as unknown as typeof fetch
		await defineSecretSet(options.keys, {
			...options,
			auth: 'http',
			secretPath: '/backend',
			environment: { slug: 'preview-123' },
			logger: false
		})
	})

	test.each([
		'login',
		'listSecrets',
		'validation'
	])('HTTP %s failures do not expose credentials or responses', async (stage) => {
		globalThis.fetch = mock(async (url: string | URL | Request) => {
			if (String(url).endsWith('/login') && stage !== 'login') {
				return Response.json({ accessToken: 'private-token' })
			}

			if (stage === 'validation') {
				return Response.json({
					secrets: [
						{ secretKey: 'A', secretValue: 123, extra: 'private-response' }
					]
				})
			}

			return Response.json({ message: 'private-response' }, { status: 401 })
		}) as unknown as typeof fetch

		try {
			await fetchInfisicalSecrets({
				...options,
				clientId: 'private-id',
				clientSecret: 'private-credential'
			})

			throw new Error('Expected HTTP failure')
		} catch (error) {
			expect(error).toMatchObject({
				code: 'HTTP',
				operation: stage === 'login' ? 'login' : 'listSecrets'
			})

			if (stage !== 'validation') {
				expect(error).toMatchObject({ status: 401 })
			}

			for (const rendered of [
				String(error),
				JSON.stringify(error),
				inspect(error)
			]) {
				expect(rendered).not.toContain('private-')
			}

			expect((error as Error).cause).toBeUndefined()
		}
	})

	test('HTTP deadline covers body reads and does not leak abort reasons', async () => {
		let calls = 0

		globalThis.fetch = mock(async () => {
			calls++

			if (calls === 1) {
				return Response.json({ accessToken: 'private-token' })
			}

			return new Response(new ReadableStream({ start() {} }), {
				headers: { 'content-type': 'application/json' }
			})
		}) as unknown as typeof fetch
		await expect(
			fetchInfisicalSecrets({
				...options,
				clientId: 'id',
				clientSecret: 'secret',
				timeoutMs: 10
			})
		).rejects.toMatchObject({ code: 'TIMEOUT' })

		expect(calls).toBe(2)
	})

	test('cancels during authentication and never starts a secrets request', async () => {
		const controller = new AbortController()

		globalThis.fetch = mock(
			async (_url: string | URL | Request, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						'abort',
						() => reject(init.signal?.reason),
						{ once: true }
					)
				})
		) as unknown as typeof fetch

		const result = fetchInfisicalSecrets({
			...options,
			clientId: 'id',
			clientSecret: 'secret',
			signal: controller.signal
		})

		controller.abort('private cancellation reason')
		await expect(result).rejects.toMatchObject({
			code: 'ABORTED',
			message: 'Secret loading was cancelled.'
		})

		expect(globalThis.fetch).toHaveBeenCalledTimes(1)
	})

	test('does not start CLI work for an already aborted request', async () => {
		const controller = new AbortController()

		controller.abort()
		await expect(
			loadInfisicalSecrets({ ...options, signal: controller.signal })
		).rejects.toMatchObject({ code: 'ABORTED' })

		expect(execute).not.toHaveBeenCalled()
	})
})

// Fixtures resemble the CLI's JWT output but contain no real credentials.
function sessionToken(organizationId: string, exp = Date.now() / 1000 + 3600) {
	const payload = Buffer.from(JSON.stringify({ organizationId, exp })).toString(
		'base64url'
	)

	return `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture-signature`
}

describe('Infisical organization-scoped CLI sessions', () => {
	const scopedOptions = {
		...options,
		organizationId: 'org-b',
		secretPath: '/backend',
		auth: 'cli' as const,
		writeToProcessEnv: false
	}

	beforeEach(() => {
		output = sessionToken('org-a')
	})

	test('scopes CLI authentication and reports the actual organization and project', async () => {
		process.env.INFISICAL_CLIENT_ID = 'unused-id'
		process.env.INFISICAL_CLIENT_SECRET = 'unused-secret'
		process.env.INFISICAL_TOKEN = 'unused-machine-token'
		process.env.TEST_CLI_OTHER = 'local-value'

		const userToken = output
		const scopedToken = sessionToken('org-b')
		const logger = { info: mock(() => {}), error: mock(() => {}) }

		globalThis.fetch = mock(
			async (url: string | URL | Request, init?: RequestInit) => {
				const headers = new Headers(init?.headers)

				if (String(url).endsWith('/api/v3/auth/select-organization')) {
					expect(init?.method).toBe('POST')
					expect(headers.get('Authorization')).toBe(`Bearer ${userToken}`)
					expect(headers.get('User-Agent')).toBe('hanzio/secrets')
					expect(JSON.parse(String(init?.body))).toEqual({
						organizationId: 'org-b'
					})

					return Response.json({ token: scopedToken, isMfaEnabled: false })
				}

				const request = new URL(String(url))

				expect(request.origin).toBe(options.siteUrl)
				expect(request.pathname).toBe('/api/v4/secrets')
				expect(headers.get('Authorization')).toBe(`Bearer ${scopedToken}`)
				expect(Object.fromEntries(request.searchParams)).toEqual({
					projectId: 'project-id',
					environment: 'staging',
					secretPath: '/backend',
					viewSecretValue: 'true',
					expandSecretReferences: 'true',
					includeImports: 'true'
				})

				return Response.json({
					secrets: [
						{
							secretKey: 'TEST_CLI_SECRET',
							secretValue: 'private-value\nsecond line'
						},
						{ secretKey: 'TEST_CLI_OTHER', secretValue: 'remote-other' },
						{ secretKey: 'TEST_CLI_IGNORED', secretValue: 'ignored-value' }
					]
				})
			}
		) as unknown as typeof fetch

		const set = await defineSecretSet(['TEST_CLI_SECRET', 'TEST_CLI_OTHER'], {
			...scopedOptions,
			logger
		})
		const source =
			'Infisical CLI session (organization=org-b project=project-id environment=staging)'

		expect(set.secrets()).toEqual({
			TEST_CLI_SECRET: 'private-value\nsecond line',
			TEST_CLI_OTHER: 'local-value'
		})
		expect(set.sources()).toEqual({
			TEST_CLI_SECRET: source,
			TEST_CLI_OTHER: 'process.env'
		})
		expect(logger.info.mock.calls[0]).toMatchObject([
			'Loaded secrets',
			{ sources: { [source]: 1, 'process.env': 1 } }
		])
		expect(execute.mock.calls[0]?.[1]).toEqual([
			'user',
			'get',
			'token',
			'--plain',
			'--domain=https://eu.infisical.com',
			'--silent'
		])
		expect(execute.mock.calls[0]?.[2].env?.INFISICAL_TOKEN).toBeUndefined()
		expect(execute).toHaveBeenCalledTimes(1)
		expect(endInput).toHaveBeenCalledTimes(1)
		expect(globalThis.fetch).toHaveBeenCalledTimes(2)
		expect(process.env.TEST_CLI_SECRET).toBeUndefined()
		expect(process.env.INFISICAL_TOKEN).toBe('unused-machine-token')

		const logs = inspect(logger.info.mock.calls)

		for (const privateValue of [userToken, scopedToken, 'private-value']) {
			expect(logs).not.toContain(privateValue)
		}
	})

	test('uses auto fallback and skips exchange when the session already matches', async () => {
		output = sessionToken('org-b')
		globalThis.fetch = mock(
			async (url: string | URL | Request, init?: RequestInit) => {
				expect(new URL(String(url)).pathname).toBe('/api/v4/secrets')
				expect(new Headers(init?.headers).get('Authorization')).toBe(
					`Bearer ${output}`
				)

				return Response.json({ secrets: [] })
			}
		) as unknown as typeof fetch

		await loadInfisicalSecrets({ ...scopedOptions, auth: 'auto' })

		expect(globalThis.fetch).toHaveBeenCalledTimes(1)
	})

	test('keeps complete machine credentials on the HTTP path when organizationId is supplied', async () => {
		process.env.INFISICAL_CLIENT_ID = 'machine-id'
		process.env.INFISICAL_CLIENT_SECRET = 'machine-secret'
		globalThis.fetch = mock(async (url: string | URL | Request) => {
			if (String(url).endsWith('/universal-auth/login')) {
				return Response.json({ accessToken: 'machine-token' })
			}

			expect(new URL(String(url)).pathname).toBe('/api/v4/secrets')

			return Response.json({ secrets: [] })
		}) as unknown as typeof fetch

		await loadInfisicalSecrets({ ...scopedOptions, auth: 'auto' })

		expect(execute).not.toHaveBeenCalled()
		expect(globalThis.fetch).toHaveBeenCalledTimes(2)
	})

	test('keeps simultaneous organizations and projects isolated, including reloads', async () => {
		let exchanges = 0
		let releaseExchanges: () => void = () => {}
		const bothExchangesStarted = new Promise<void>((resolve) => {
			releaseExchanges = resolve
		})

		globalThis.fetch = mock(
			async (url: string | URL | Request, init?: RequestInit) => {
				const request = new URL(String(url))

				if (request.pathname.endsWith('/select-organization')) {
					const { organizationId } = JSON.parse(String(init?.body))

					expect(new Headers(init?.headers).get('Authorization')).toBe(
						`Bearer ${output}`
					)
					exchanges++

					if (exchanges === 2) {
						releaseExchanges()
					}

					await bothExchangesStarted

					return Response.json({ token: sessionToken(organizationId) })
				}

				const project = request.searchParams.get('projectId')!
				const bearer = new Headers(init?.headers).get('Authorization')!.slice(7)
				const claims = JSON.parse(
					Buffer.from(bearer.split('.')[1]!, 'base64url').toString()
				)

				expect(claims.organizationId).toBe(project.replace('project-', 'org-'))

				return Response.json({
					secrets: [{ secretKey: 'TEST_CLI_SECRET', secretValue: project }]
				})
			}
		) as unknown as typeof fetch

		const [first, second] = await Promise.all(
			['b', 'c'].map((suffix) =>
				defineSecretSet(options.keys, {
					...scopedOptions,
					organizationId: `org-${suffix}`,
					projectId: `project-${suffix}`,
					logger: false
				})
			)
		)

		await Promise.all([first!.reload(), second!.reload()])

		expect(first!.secret('TEST_CLI_SECRET')).toBe('project-b')
		expect(second!.secret('TEST_CLI_SECRET')).toBe('project-c')
		expect(process.env.TEST_CLI_SECRET).toBeUndefined()
		expect(execute).toHaveBeenCalledTimes(4)
		expect(exchanges).toBe(4)
	})

	test.each([
		'',
		'  ',
		' org-b',
		'org\nb'
	])('rejects invalid organization IDs before authentication: %j', async (organizationId) => {
		await expect(
			loadInfisicalSecrets({ ...scopedOptions, organizationId })
		).rejects.toMatchObject({ code: 'CONFIGURATION' })

		expect(execute).not.toHaveBeenCalled()
		expect(globalThis.fetch).not.toHaveBeenCalled()
	})

	test.each([
		'',
		'private-token-output',
		'a.e30.b\nprivate-output',
		sessionToken('org-a', 1)
	])('rejects malformed or expired sessions without fetching: %s', async (token) => {
		output = token

		await expect(loadInfisicalSecrets(scopedOptions)).rejects.toMatchObject({
			code: 'AUTHENTICATION'
		})

		expect(globalThis.fetch).not.toHaveBeenCalled()
	})

	test.each([
		401, 403
	])('reports denied organization access safely (status %s)', async (status) => {
		globalThis.fetch = mock(async () =>
			Response.json({ message: `private-response ${output}` }, { status })
		) as unknown as typeof fetch

		const error = await loadInfisicalSecrets(scopedOptions).catch(
			(error: unknown) => error
		)

		expect(error).toMatchObject({
			code: 'HTTP',
			operation: 'selectOrganization',
			status
		})
		expect(String(error)).toContain('infisical login')
		expect(inspect(error)).not.toContain('private-response')
		expect(inspect(error)).not.toContain(output)
		expect((error as Error).cause).toBeUndefined()
		expect(execute).toHaveBeenCalledTimes(1)
		expect(globalThis.fetch).toHaveBeenCalledTimes(1)
	})

	test.each([
		{ token: 'private-mfa-token', isMfaEnabled: true },
		{ token: sessionToken('wrong-org') },
		{ token: sessionToken('org-b', 1) },
		{ token: 'private-malformed-token' }
	])('never fetches secrets with an unusable organization token: %j', async (response) => {
		globalThis.fetch = mock(async () =>
			Response.json(response)
		) as unknown as typeof fetch

		const error = await loadInfisicalSecrets(scopedOptions).catch(
			(error: unknown) => error
		)

		expect(error).toMatchObject({ code: 'AUTHENTICATION' })
		expect(inspect(error)).not.toContain(response.token)
		expect(globalThis.fetch).toHaveBeenCalledTimes(1)
	})

	test('retains the previous snapshot when a fresh CLI session expires on reload', async () => {
		output = sessionToken('org-b')
		globalThis.fetch = mock(async () =>
			Response.json({
				secrets: [
					{ secretKey: 'TEST_CLI_SECRET', secretValue: 'previous-value' }
				]
			})
		) as unknown as typeof fetch

		const set = await defineSecretSet(options.keys, {
			...scopedOptions,
			logger: false
		})

		output = sessionToken('org-b', 1)
		await expect(set.reload()).rejects.toMatchObject({ code: 'AUTHENTICATION' })

		expect(set.secret('TEST_CLI_SECRET')).toBe('previous-value')
		expect(execute).toHaveBeenCalledTimes(2)
		expect(globalThis.fetch).toHaveBeenCalledTimes(1)
	})

	test.each([
		'selectOrganization',
		'listSecrets'
	])('deadline includes HTTP %s body reads after CLI authentication', async (stage) => {
		const signals: (AbortSignal | null | undefined)[] = []

		globalThis.fetch = mock(
			async (url: string | URL | Request, init?: RequestInit) => {
				signals.push(init?.signal)

				if (
					String(url).endsWith('/select-organization') &&
					stage === 'listSecrets'
				) {
					return Response.json({ token: sessionToken('org-b') })
				}

				return new Response(new ReadableStream({ start() {} }), {
					headers: { 'content-type': 'application/json' }
				})
			}
		) as unknown as typeof fetch

		await expect(
			loadInfisicalSecrets({ ...scopedOptions, timeoutMs: 10 })
		).rejects.toMatchObject({ code: 'TIMEOUT' })

		expect(signals).toHaveLength(stage === 'selectOrganization' ? 1 : 2)

		for (const signal of signals) {
			expect(signal?.aborted).toBe(true)
		}

		expect(execute.mock.calls[0]?.[2].signal?.aborted).toBe(true)
	})

	test('cancels organization selection without listing secrets or leaking the reason', async () => {
		const controller = new AbortController()

		globalThis.fetch = mock(async () => {
			controller.abort('private-abort-reason')

			return Response.json({ token: sessionToken('org-b') })
		}) as unknown as typeof fetch

		await expect(
			loadInfisicalSecrets({ ...scopedOptions, signal: controller.signal })
		).rejects.toMatchObject({
			code: 'ABORTED',
			message: 'Secret loading was cancelled.'
		})

		expect(globalThis.fetch).toHaveBeenCalledTimes(1)
	})
})

describe('required Infisical organization configuration', () => {
	test('rejects omitted organizationId in the public API even with all-local values', async () => {
		process.env.TEST_CLI_SECRET = 'local-value'

		await expect(
			// @ts-expect-error Infisical configuration requires organizationId.
			defineSecretSet(options.keys, { projectId: 'project-id' })
		).rejects.toMatchObject({
			code: 'CONFIGURATION'
		})

		expect(execute).not.toHaveBeenCalled()
		expect(globalThis.fetch).not.toHaveBeenCalled()
	})

	test('requires organizationId in both low-level loading functions and explicit loaders', async () => {
		const { organizationId: _organizationId, ...unscoped } = options
		const credentials = { clientId: 'id', clientSecret: 'secret' }

		// @ts-expect-error The environment-based loader requires organizationId.
		await expect(loadInfisicalSecrets(unscoped)).rejects.toMatchObject({
			code: 'CONFIGURATION'
		})

		await expect(
			// @ts-expect-error The HTTP loader requires organizationId too.
			fetchInfisicalSecrets({ ...unscoped, ...credentials })
		).rejects.toMatchObject({ code: 'CONFIGURATION' })

		expect(() => {
			// @ts-expect-error Validate explicit loaders before they can be skipped by local overrides.
			infisicalLoader({ ...unscoped, ...credentials })
		}).toThrow('organizationId is required')

		expect(execute).not.toHaveBeenCalled()
		expect(globalThis.fetch).not.toHaveBeenCalled()
	})

	test.each([
		undefined,
		null,
		'',
		'  ',
		123
	])('rejects invalid IDs from JavaScript callers: %j', async (organizationId) => {
		process.env.TEST_CLI_SECRET = 'local-value'

		await expect(
			defineSecretSet(options.keys, {
				...options,
				organizationId: organizationId as unknown as string
			})
		).rejects.toMatchObject({ code: 'CONFIGURATION' })

		expect(execute).not.toHaveBeenCalled()
		expect(globalThis.fetch).not.toHaveBeenCalled()
	})
})
