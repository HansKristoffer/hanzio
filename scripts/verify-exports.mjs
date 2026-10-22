import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises'
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
		'typedSwitchGroup',
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
		'contrastText',
		'createTaskPool',
		'escapeHtml',
		'toJsonValue'
	],
	'hanzio/zod': ['createZId', 'zodToTypeString', 'zOptionalE164'],
	'hanzio/api-wrapper': ['createApiClient', 'isHttpResponseError'],
	'hanzio/api-wrapper/testing': ['createMockFetch', 'jsonResponse'],
	'hanzio/api-wrapper/connection-auth': ['ConnectionAuthCache'],
	'hanzio/jwt': ['jwtSign', 'jwtVerify'],
	'hanzio/sitemap': ['getDomainSitemap'],
	'hanzio/p-queue': ['default', 'PQueue'],
	'hanzio/cool-console-log': ['createCoolLogger', 'colorize'],
	'hanzio/format': ['formatDuration', 'formatBytes', 'formatCappedCount', 'formatPrice', 'EM_DASH'],
	'hanzio/format/phone': ['formatPhone'],
	'hanzio/crypto': ['safeEqual', 'hmacSign', 'createSealer', 'randomToken'],
	'hanzio/crypto/node': ['createSealerSync', 'SealerError'],
	'hanzio/storage': ['createStorageItem', 'createAsyncStorageItem'],
	'hanzio/i18n': ['interpolate', 'extractPlaceholders', 'createTranslator', 'defineLocales', 'typedTranslate'],
	'hanzio/i18n/vue': ['createVueI18n'],
	'hanzio/i18n/i18next': ['initI18next'],
	'hanzio/i18n/vite': ['localeCatalogReloadPlugin'],
	'hanzio/i18n/check': ['defineI18nConfig', 'validateCatalogs', 'writeCatalogTypes'],
	'hanzio/iso': ['countryNames', 'currencyNames', 'languageNames', 'countryFlag'],
	'hanzio/secrets': ['defineSecretSet', 'createSecretSet', 'readPublicConfig'],
	'hanzio/secrets/vite': ['viteSecretSetPlugin', 'readPublicConfig'],
	'hanzio/secrets/worker': ['defineSecretSet', 'createSecretSet', 'readPublicConfig', 'cloudflareWorkerEnvLoader'],
	'hanzio/redis': ['createManagedRedis', 'createRedisConcurrencyLimit', 'createLuaScript'],
	'hanzio/http': ['withSseKeepAlive', 'createSseKeepAliveTransform'],
	'hanzio/cli': ['defineCli', 'defineCommand', 'CliError', 'CliUsageError'],
	'hanzio/testing': ['ModuleMocker', 'createPrismaMock', 'connectionAuthContract', 'installWindowShim', 'noopLogger']
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

	// The README imports table lists every subpath, and nothing else.
	const readme = await readFile(join(root, 'README.md'), 'utf8')
	const tabled = [...readme.matchAll(/^\| `(hanzio\/[^`]+)` \|/gm)].map(
		([, name]) => name
	)
	assert.deepEqual(
		tabled.sort(),
		Object.keys(expectedExports)
			.filter((name) => name !== 'hanzio')
			.sort(),
		'README imports table must list exactly the package subpaths'
	)

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

	// Optional peers, for the subpaths that load them.
	for (const peer of Object.keys(pkg.peerDependencies)) {
		await mkdir(dirname(join(modules, peer)), { recursive: true })
		await symlink(join(root, 'node_modules', peer), join(modules, peer), 'dir')
	}
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

	// The declarations must resolve under NodeNext, the strictest resolution
	// mode. skipLibCheck stays off, or a broken import between our .d.ts files
	// would quietly become `any` instead of an error.
	await writeFile(join(temporary, 'package.json'), '{ "type": "module" }\n')
	// Packages our declarations name besides the peers: runtime types for the
	// Node and Bun subpaths, and what vue-i18n brings along in a real install.
	const typePackages = [
		'@types/node',
		'@types/bun',
		'bun-types',
		'vue',
		'@intlify/core-base'
	]
	for (const name of typePackages) {
		await mkdir(dirname(join(modules, name)), { recursive: true })
		await symlink(join(root, 'node_modules', name), join(modules, name), 'dir')
	}
	await writeFile(
		join(temporary, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: {
				module: 'NodeNext',
				moduleResolution: 'NodeNext',
				target: 'ES2022',
				lib: ['ES2022', 'DOM'],
				types: ['node', 'bun'],
				strict: true,
				skipLibCheck: false,
				noEmit: true
			},
			files: ['consumer.ts']
		})
	)
	await writeFile(
		join(temporary, 'consumer.ts'),
		Object.entries(expectedExports)
			.map(([specifier, names], index) => {
				const members = names.map((name) => `typeof m${index}.${name}`)
				return (
					`import type * as m${index} from ${JSON.stringify(specifier)}\n` +
					`export type T${index} = [${members.join(', ')}]\n`
				)
			})
			.join('')
	)
	// Only our files count: the dev copies of vue and vue-i18n may disagree.
	const tsc = join(root, 'node_modules/typescript/bin/tsc')
	let output = ''
	try {
		execFileSync(
			process.execPath,
			[tsc, '-p', temporary, '--pretty', 'false'],
			{ cwd: temporary, encoding: 'utf8' }
		)
	} catch (error) {
		output = error.stdout
	}
	const errors = output
		.split('\n')
		.filter((line) => /^(consumer\.ts|package\/|error TS)/.test(line))
	assert.equal(
		errors.length,
		0,
		`Declarations fail under NodeNext:\n${errors.join('\n')}`
	)

	console.log(`Verified ${documented.length} package exports`)
} finally {
	await rm(temporary, { recursive: true, force: true })
}
