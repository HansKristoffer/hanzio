import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { defineSecretSet, processEnvLoader } from 'hanzio/secrets'

// Use real HTTP requests to verify the packaged session adapter in both runtimes.
const requests = []
const server = createServer(async (request, response) => {
	try {
		const url = new URL(request.url, 'http://localhost')
		const token = request.headers.authorization.slice(7)
		const claims = JSON.parse(
			Buffer.from(token.split('.')[1], 'base64url').toString()
		)
		let result

		requests.push(url.pathname)

		if (url.pathname === '/api/v3/auth/select-organization') {
			assert.equal(request.method, 'POST')
			assert.equal(request.headers['user-agent'], 'hanzio/secrets')
			assert.equal(claims.organizationId, 'login-org')
			let body = ''

			for await (const chunk of request) {
				body += chunk
			}

			const { organizationId } = JSON.parse(body)
			const scoped = Buffer.from(
				JSON.stringify({ organizationId, exp: 4102444800 })
			).toString('base64url')

			result = {
				token: 'eyJhbGciOiJIUzI1NiJ9.' + scoped + '.fixture-signature',
				isMfaEnabled: false
			}
		} else {
			assert.equal(url.pathname, '/api/v4/secrets')
			const project = url.searchParams.get('projectId')

			assert.equal(claims.organizationId, project.replace('project-', 'org-'))
			assert.equal(url.searchParams.get('secretPath'), '/backend')
			result = {
				secrets: [{ secretKey: 'HANZIO_RUNTIME_SECRET', secretValue: project }]
			}
		}

		response.setHeader('content-type', 'application/json')
		response.end(JSON.stringify(result))
	} catch {
		response.statusCode = 400
		response.end('Invalid fixture request')
	}
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

const options = {
	organizationId: 'org-a',
	projectId: 'project-a',
	siteUrl: 'http://127.0.0.1:' + server.address().port,
	writeToProcessEnv: false,
	auth: 'cli',
	secretPath: '/backend',
	logger: false
}

try {
	process.env.HANZIO_RUNTIME_CLI_MODE = 'fail'

	await assert.rejects(
		defineSecretSet(['HANZIO_RUNTIME_SECRET'], options),
		(error) =>
			error.code === 'CLI' && !String(error).includes('private-error-fixture')
	)

	process.env.HANZIO_RUNTIME_CLI_MODE = 'hang'

	const controller = new AbortController()
	const cancelled = defineSecretSet(['HANZIO_RUNTIME_SECRET'], {
		...options,
		signal: controller.signal
	})

	// Wait for the fake process to start before cancelling it.
	let pid

	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			pid = Number(await readFile(process.env.HANZIO_RUNTIME_PID_FILE, 'utf8'))
			break
		} catch {}

		await new Promise((resolve) => setTimeout(resolve, 10))
	}

	assert.ok(pid)
	controller.abort('private-abort-reason')
	await assert.rejects(
		cancelled,
		(error) => error.code === 'ABORTED' && !String(error).includes('private')
	)

	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			process.kill(pid, 0)
		} catch {
			pid = undefined
			break
		}

		await new Promise((resolve) => setTimeout(resolve, 10))
	}

	assert.equal(pid, undefined, 'cancelled CLI process must exit')
	delete process.env.HANZIO_RUNTIME_CLI_MODE

	const sets = await Promise.all(
		['a', 'b'].map((suffix) =>
			defineSecretSet(['HANZIO_RUNTIME_SECRET'], {
				...options,
				organizationId: 'org-' + suffix,
				projectId: 'project-' + suffix
			})
		)
	)

	await Promise.all(sets.map((set) => set.reload()))

	assert.equal(sets[0].secret('HANZIO_RUNTIME_SECRET'), 'project-a')
	assert.equal(sets[1].secret('HANZIO_RUNTIME_SECRET'), 'project-b')
	assert.ok(
		sets[0]
			.sources()
			.HANZIO_RUNTIME_SECRET.includes('organization=org-a project=project-a')
	)
	assert.equal(process.env.HANZIO_RUNTIME_SECRET, undefined)
	assert.equal(
		requests.filter((path) => path.endsWith('/select-organization')).length,
		4
	)
	assert.equal(requests.filter((path) => path.endsWith('/secrets')).length, 4)
} finally {
	server.closeAllConnections()
	await new Promise((resolve) => server.close(resolve))
}

process.env.PATH = ''
await assert.rejects(
	defineSecretSet(['HANZIO_RUNTIME_SECRET'], options),
	/Infisical CLI not found/
)
process.env.HANZIO_RUNTIME_SECRET = 'explicit local'
await assert.rejects(
	defineSecretSet(['HANZIO_RUNTIME_SECRET'], { projectId: 'project-a' }),
	(error) =>
		error.code === 'CONFIGURATION' && /organizationId/.test(error.message)
)

const local = await defineSecretSet(['HANZIO_RUNTIME_SECRET'], {
	loader: processEnvLoader,
	logger: false
})

await local.reload()
assert.equal(local.secret('HANZIO_RUNTIME_SECRET'), 'explicit local')
