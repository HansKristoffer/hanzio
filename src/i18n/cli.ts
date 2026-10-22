#!/usr/bin/env node
// `hanzio-i18n check` validates translation catalogs; `hanzio-i18n generate`
// writes their key maps. Both read `i18n.config.{ts,mts,js,mjs}` (or
// `--config <file>`) from the current directory. A `.ts` config needs Bun or
// a Node version that strips types.

import { existsSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import {
	CliError,
	type CommandContext,
	defineCli,
	defineCommand
} from '../cli/index.js'
import {
	type CatalogIssue,
	type I18nConfig,
	validateCatalogs,
	writeCatalogTypes
} from './check.js'

const CONFIG_NAMES = [
	'i18n.config.ts',
	'i18n.config.mts',
	'i18n.config.js',
	'i18n.config.mjs'
]

type Loaded = { config: I18nConfig; root: string }

// Node resolves a config's imports like a browser: `./src/locales` fails
// because it names neither a file nor an extension. Bun resolves it like a
// bundler. These are the suffixes TypeScript's bundler resolution tries.
const BUNDLER_SUFFIXES = [
	'.ts',
	'.mts',
	'.js',
	'.mjs',
	'/index.ts',
	'/index.mts',
	'/index.js',
	'/index.mjs'
]

function resolveLikeBundlers() {
	// Missing under Bun, which needs no help, and under Node before 22.15.
	nodeModule.registerHooks?.({
		resolve(specifier, context, nextResolve) {
			try {
				return nextResolve(specifier, context)
			} catch (error) {
				const code = (error as { code?: string }).code
				const retry =
					specifier.startsWith('.') &&
					(code === 'ERR_MODULE_NOT_FOUND' ||
						code === 'ERR_UNSUPPORTED_DIR_IMPORT')
				if (!retry) throw error
				for (const suffix of BUNDLER_SUFFIXES) {
					try {
						return nextResolve(specifier + suffix, context)
					} catch {}
				}
				throw error
			}
		}
	})
}

async function loadConfig(file: string | undefined): Promise<Loaded> {
	const path = file
		? resolve(file)
		: CONFIG_NAMES.map((name) => resolve(name)).find((path) => existsSync(path))
	if (!path || !existsSync(path))
		throw new CliError(
			`No i18n config found: pass --config or add ${CONFIG_NAMES[0]}.`
		)
	resolveLikeBundlers()
	const loaded = (await import(pathToFileURL(path).href)) as {
		default?: I18nConfig
	}
	if (!loaded.default?.catalogs)
		throw new CliError(`${path} must default-export an i18n config`)
	return { config: loaded.default, root: dirname(path) }
}

function failOnIssues(issues: CatalogIssue[], ctx: CommandContext) {
	if (issues.length === 0) return
	for (const issue of issues) {
		const locale = issue.locale ? `/${issue.locale}` : ''
		ctx.stderr.write(`❌ ${issue.catalog}${locale}: ${issue.message}\n`)
	}
	throw new CliError(`${issues.length} catalog problem(s)`)
}

const cli = defineCli({
	name: 'hanzio-i18n',
	globals: z.object({
		config: z
			.string()
			.optional()
			.describe('Config file (default: i18n.config.*)')
	}),
	context: (globals) => loadConfig(globals.config),
	commands: {
		check: defineCommand({
			description: 'Validate the translation catalogs',
			run: async (_input, ctx: CommandContext<Loaded>) => {
				const { config, root } = ctx.context
				failOnIssues(await validateCatalogs(config, { root }), ctx)
				return config.catalogs
					.map(
						(catalog) =>
							`✅ ${catalog.name}: ${config.locales.length} locale(s) valid`
					)
					.join('\n')
			}
		}),
		generate: defineCommand({
			description: "Write each catalog's generatedTypes",
			run: (_input, ctx: CommandContext<Loaded>) => {
				const { config, root } = ctx.context
				const { written, issues } = writeCatalogTypes(config, { root })
				failOnIssues(issues, ctx)
				return (
					written.map((path) => `Generated ${path}`).join('\n') || undefined
				)
			}
		})
	}
})

process.exitCode = await cli.run()
