import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
	mkdtemp,
	mkdir,
	writeFile,
	readFile,
	copyFile,
	rm,
	chmod,
	symlink
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import { Miniflare } from 'miniflare'

// Exercise the publishable tarball, not the source checkout. No real CLI/account is used.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtures = join(root, 'scripts/fixtures')
const temporary = await mkdtemp(join(tmpdir(), 'hanzio-secrets-'))
let worker

try {
	// Install the exact tarball layout into an isolated temporary project.
	const packed = JSON.parse(
		execFileSync(
			'npm',
			['pack', '--json', '--ignore-scripts', '--pack-destination', temporary],
			{ cwd: root, encoding: 'utf8' }
		)
	)[0]
	const modules = join(temporary, 'node_modules')

	await mkdir(modules)
	execFileSync('tar', [
		'-xzf',
		join(temporary, packed.filename),
		'-C',
		temporary
	])
	await symlink(join(temporary, 'package'), join(modules, 'hanzio'), 'dir')
	await symlink(join(root, 'node_modules/zod'), join(modules, 'zod'), 'dir')

	// The fake CLI covers success, safe failures, and cancellation without an account.
	const cli = join(temporary, 'infisical')
	const cliSource = await readFile(join(fixtures, 'infisical-cli.cjs'), 'utf8')

	await writeFile(cli, `#!${process.execPath}\n${cliSource}`)
	await chmod(cli, 0o755)

	const runner = join(temporary, 'runtime.mjs')

	await copyFile(join(fixtures, 'secrets-runtime.mjs'), runner)

	const env = {
		...process.env,
		PATH: temporary,
		HANZIO_RUNTIME_PID_FILE: join(temporary, 'child.pid'),
		INFISICAL_TOKEN: 'fixture-token',
		INFISICAL_UNIVERSAL_AUTH_ACCESS_TOKEN: 'fixture-token',
		TOKEN: 'fixture-token'
	}

	for (const key of [
		'HANZIO_RUNTIME_SECRET',
		'HANZIO_RUNTIME_CLI_MODE',
		'INFISICAL_CLIENT_ID',
		'INFISICAL_CLIENT_SECRET',
		'SECRETS_ENV'
	]) {
		delete env[key]
	}

	const bun = execFileSync('which', ['bun'], { encoding: 'utf8' }).trim()

	for (const runtime of [process.execPath, bun]) {
		await rm(join(temporary, 'child.pid'), { force: true })
		execFileSync(runtime, [runner], { env, timeout: 20_000, stdio: 'pipe' })
		console.log(
			`${runtime === bun ? 'Bun' : 'Node'}: packaged API, multi-organization sessions over HTTP, fake CLI, cancellation, reload, and missing CLI passed`
		)
	}

	// Build a real browser bundle and verify that only the public fixture appears.
	const secretModule = await import(
		pathToFileURL(join(temporary, 'package/dist/src/secrets/index.js'))
	)
	const viteModule = await import(
		pathToFileURL(join(temporary, 'package/dist/src/secrets/vite.js'))
	)
	const secrets = await secretModule.defineSecretSet(
		['VITE_PUBLIC_FIXTURE', 'PRIVATE_FIXTURE'],
		{
			writeToProcessEnv: false,
			logger: false,
			loader: async () => ({
				VITE_PUBLIC_FIXTURE: 'public-fixture-value',
				PRIVATE_FIXTURE: 'private-must-never-ship'
			})
		}
	)

	await writeFile(
		join(temporary, 'index.html'),
		'<script type="module" src="/client.js"></script>'
	)
	await writeFile(
		join(temporary, 'client.js'),
		'document.body.textContent = import.meta.env.VITE_PUBLIC_FIXTURE; console.log(import.meta.env.PRIVATE_FIXTURE)'
	)

	const browser = await build({
		root: temporary,
		configFile: false,
		envFile: false,
		logLevel: 'silent',
		plugins: [
			viteModule.viteSecretSetPlugin(secrets, {
				publicKeys: ['VITE_PUBLIC_FIXTURE']
			})
		],
		build: { write: false, minify: false }
	})
	const browserCode = browser.output
		.filter((item) => item.type === 'chunk')
		.map((item) => item.code)
		.join('\n')

	assert.ok(browserCode.includes('public-fixture-value'))
	assert.ok(!browserCode.includes('private-must-never-ship'))
	assert.throws(() => viteModule.getViteDefine(secrets), /VITE_/)

	console.log('Vite: private fixture excluded from browser build')

	// Exercise the Worker entry point in workerd with Node compatibility disabled.
	const workerEntry = join(temporary, 'worker.js')

	await copyFile(join(fixtures, 'secrets-worker.mjs'), workerEntry)

	const bundledWorker = await build({
		root: temporary,
		configFile: false,
		envFile: false,
		logLevel: 'silent',
		build: {
			write: false,
			minify: false,
			lib: { entry: workerEntry, formats: ['es'], fileName: 'worker' }
		}
	})
	const workerOutput = Array.isArray(bundledWorker)
		? bundledWorker[0]
		: bundledWorker
	const workerCode = workerOutput.output.find(
		(item) => item.type === 'chunk'
	).code

	assert.ok(!workerCode.includes('node:child_process'))

	worker = new Miniflare({
		modules: true,
		script: workerCode,
		compatibilityDate: '2025-01-01',
		bindings: { WORKER_FIXTURE: 'worker-value' }
	})

	const response = await worker.dispatchFetch('https://fixture.invalid')

	assert.equal(response.status, 200)
	assert.deepEqual(await response.json(), {
		value: 'refreshed-worker',
		sources: { WORKER_FIXTURE: 'Cloudflare Worker bindings' }
	})

	console.log(
		'Worker: packaged entry point built and executed in workerd without Node compatibility'
	)
} finally {
	await worker?.dispose()
	await rm(temporary, { recursive: true, force: true })
}
