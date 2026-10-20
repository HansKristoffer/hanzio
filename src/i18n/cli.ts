#!/usr/bin/env node
// `hanzio-i18n check` validates translation catalogs; `hanzio-i18n generate`
// writes their key maps. Both read `i18n.config.{ts,mts,js,mjs}` (or
// `--config <file>`) from the current directory. A `.ts` config needs Bun or
// a Node version that strips types.

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
	type CatalogIssue,
	type I18nConfig,
	validateCatalogs,
	writeCatalogTypes
} from './check'

const CONFIG_NAMES = [
	'i18n.config.ts',
	'i18n.config.mts',
	'i18n.config.js',
	'i18n.config.mjs'
]
const USAGE = 'Usage: hanzio-i18n <check|generate> [--config <file>]'

function fail(message: string): never {
	console.error(message)
	process.exit(1)
}

function printIssues(issues: CatalogIssue[]) {
	for (const issue of issues) {
		const locale = issue.locale ? `/${issue.locale}` : ''
		console.error(`❌ ${issue.catalog}${locale}: ${issue.message}`)
	}
}

const [command, ...rest] = process.argv.slice(2)
const flag = rest.indexOf('--config')
const configArg = flag === -1 ? undefined : rest[flag + 1]
if (flag !== -1 && !configArg) fail(USAGE)
const configPath = configArg
	? resolve(configArg)
	: CONFIG_NAMES.map((name) => resolve(name)).find((path) => existsSync(path))
if (!configPath || !existsSync(configPath)) {
	fail(
		`No i18n config found: pass --config or add ${CONFIG_NAMES[0]}.\n${USAGE}`
	)
}

const loaded = (await import(pathToFileURL(configPath).href)) as {
	default?: I18nConfig
}
const config = loaded.default
if (!config?.catalogs) fail(`${configPath} must default-export an i18n config`)
const root = dirname(configPath)

if (command === 'check') {
	const issues = await validateCatalogs(config, { root })
	if (issues.length > 0) {
		printIssues(issues)
		process.exit(1)
	}
	for (const catalog of config.catalogs) {
		console.log(`✅ ${catalog.name}: ${config.locales.length} locale(s) valid`)
	}
} else if (command === 'generate') {
	const { written, issues } = writeCatalogTypes(config, { root })
	if (issues.length > 0) {
		printIssues(issues)
		process.exit(1)
	}
	for (const path of written) console.log(`Generated ${path}`)
} else {
	fail(USAGE)
}
