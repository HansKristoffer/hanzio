import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Import every documented subpath from the packed tarball in plain Node, so
// the exports map, the built files and the README can't drift apart.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = await mkdtemp(join(tmpdir(), 'hanzio-exports-'))

const expectedExports = {
	hanzio: [
		'chunkArray',
		'typedSwitch',
		'tryCatch',
		'cacheFunction',
		'buildUrl',
		'getErrorMessage',
		'must',
		'isRecord',
		'typedKeys',
		'debounce',
		'createEmitter',
		'truncate',
		'anySignal',
		'contrastText'
	],
	'hanzio/zod': ['createZId', 'zodToTypeString'],
	'hanzio/api-wrapper': ['createApiClient', 'isHttpResponseError'],
	'hanzio/api-wrapper/testing': ['createMockFetch', 'jsonResponse'],
	'hanzio/jwt': ['jwtSign', 'jwtVerify'],
	'hanzio/sitemap': ['getDomainSitemap'],
	'hanzio/p-queue': ['default', 'PQueue'],
	'hanzio/cool-console-log': ['createCoolLogger', 'colorize'],
	'hanzio/format': ['formatDuration', 'formatBytes', 'formatCappedCount'],
	'hanzio/crypto': ['safeEqual', 'hmacSign', 'createSealer', 'randomToken'],
	'hanzio/storage': ['createStorageItem', 'createAsyncStorageItem'],
	'hanzio/i18n': ['interpolate', 'extractPlaceholders', 'createTranslator'],
	'hanzio/secrets': ['defineSecretSet', 'createSecretSet', 'readPublicConfig'],
	'hanzio/secrets/vite': ['viteSecretSetPlugin', 'readPublicConfig'],
	'hanzio/secrets/worker': ['defineSecretSet', 'createSecretSet', 'readPublicConfig', 'cloudflareWorkerEnvLoader']
}

// Runs an ESM snippet from inside the temporary project and returns stdout.
const run = (code) =>
	execFileSync(process.execPath, ['--input-type=module', '-e', code], {
		cwd: temporary,
		encoding: 'utf8'
	})

try {
	const packed = JSON.parse(
		execFileSync(
			'npm',
			['pack', '--json', '--ignore-scripts', '--pack-destination', temporary],
			{ cwd: root, encoding: 'utf8' }
		)
	)[0]
	const modules = join(temporary, 'node_modules')
	await mkdir(modules)
	execFileSync('tar', ['-xzf', join(temporary, packed.filename), '-C', temporary])
	await symlink(join(temporary, 'package'), join(modules, 'hanzio'), 'dir')

	const pkg = JSON.parse(
		await readFile(join(temporary, 'package/package.json'), 'utf8')
	)
	const documented = Object.keys(expectedExports).map((name) =>
		name === 'hanzio' ? '.' : `.${name.slice('hanzio'.length)}`
	)
	assert.deepEqual(Object.keys(pkg.exports).sort(), documented.sort())

	for (const [subpath, conditions] of Object.entries(pkg.exports)) {
		for (const file of new Set(Object.values(conditions))) {
			await access(join(temporary, 'package', file)).catch(() => {
				throw new Error(`${subpath} points at missing file ${file}`)
			})
		}
	}

	// The root entry must load without the zod peer dependency installed.
	const rootKeys = JSON.parse(
		run(`console.log(JSON.stringify(Object.keys(await import('hanzio'))))`)
	)
	for (const name of expectedExports.hanzio) {
		assert.ok(rootKeys.includes(name), `hanzio is missing ${name}`)
	}
	assert.ok(
		!rootKeys.includes('createApiClient'),
		'hanzio root must not re-export subpath-only modules'
	)

	await symlink(join(root, 'node_modules/zod'), join(modules, 'zod'), 'dir')
	for (const [specifier, names] of Object.entries(expectedExports)) {
		const keys = JSON.parse(
			run(
				`console.log(JSON.stringify(Object.keys(await import(${JSON.stringify(specifier)}))))`
			)
		)
		for (const name of names) {
			assert.ok(keys.includes(name), `${specifier} is missing ${name}`)
		}
	}

	console.log(`Verified ${documented.length} package exports`)
} finally {
	await rm(temporary, { recursive: true, force: true })
}
