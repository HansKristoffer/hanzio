// Catalog checks for `<dir>/<locale>.json` translation catalogs, used by the
// `hanzio-i18n` bin. The base locale is the source of truth: every locale must
// have its keys and placeholders, and the generated key maps must match it.

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync
} from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { extractPlaceholders, type Messages } from './index.js'
import {
	type CatalogConfig,
	type CatalogIssue,
	flattenCatalog,
	generateCatalogTypes,
	parseMessages
} from './catalog.js'
import { type ContentRulesConfig, createContentRules } from './content-rules.js'

export type { CatalogConfig, CatalogIssue, CatalogRuntime } from './catalog.js'
export { generateCatalogTypes, parseMessages } from './catalog.js'
export type { ContentRulesConfig } from './content-rules.js'

export type I18nConfig<
	Locale extends string = string,
	Catalog extends string = string
> = {
	/** The source-of-truth locale; usually `'en'`. */
	baseLocale: NoInfer<Locale>
	/** Every shipped locale, the base included. Each needs a catalog file. */
	locales: readonly Locale[]
	catalogs: readonly (CatalogConfig & { name: Catalog })[]
	/**
	 * Groups of catalogs merged into one runtime (`{ ...platform, ...widget }`),
	 * so their top-level keys must not overlap.
	 */
	disjointNamespaces?: readonly (readonly NoInfer<Catalog>[])[]
	rules?: ContentRulesConfig<NoInfer<Locale>>
}

/**
 * Types an `i18n.config.ts` default export: `baseLocale`, the catalog names
 * in `disjointNamespaces` and the locales in `rules.identical.allowKeys` must
 * be ones the config declares.
 */
export function defineI18nConfig<
	const Locale extends string,
	const Catalog extends string
>(config: I18nConfig<Locale, Catalog>): I18nConfig<Locale, Catalog> {
	return config
}

type VueCompiler = typeof import('@intlify/message-compiler')

function vueSyntaxIssues(compiler: VueCompiler, key: string, value: string) {
	const issues: string[] = []
	if (compiler.detectHtmlTag(value)) {
		issues.push(
			`"${key}" contains HTML, which vue-i18n rejects with strictMessage: "${value}"`
		)
	}
	const errors: string[] = []
	compiler.baseCompile(value, {
		onError: (error) => errors.push(error.message)
	})
	if (errors.length > 0) {
		issues.push(
			`"${key}" is not valid vue-i18n syntax (${errors.join('; ')}): "${value}" - escape literal { } and @ with {'{'} {'}'} {'@'}`
		)
	}
	return issues
}

function readCatalog(path: string, catalog: string, locale: string) {
	try {
		return parseMessages(
			JSON.parse(readFileSync(path, 'utf8')),
			catalog,
			locale
		)
	} catch (error) {
		return {
			messages: undefined,
			issues: [{ catalog, locale, message: `invalid JSON - ${String(error)}` }]
		}
	}
}

function collectSourceFiles(path: string, files: string[] = []): string[] {
	if (!existsSync(path)) return files
	if (statSync(path).isFile()) {
		if (/\.(tsx?|jsx?|vue|svelte)$/.test(path) && !/\.test\./.test(path)) {
			files.push(path)
		}
		return files
	}
	for (const name of readdirSync(path)) {
		if (name !== 'node_modules') collectSourceFiles(join(path, name), files)
	}
	return files
}

/** Any dotted path, wherever it appears. */
const KEY_REFERENCE = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+/g
/** The `prefix.` of a `` `prefix.${expr}` `` key, which keeps a whole family. */
const KEY_FAMILY_PREFIX = /([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*\.)\$\{/g

/**
 * Keys nothing in `sourceRoots` references. Plain string scanning: any dotted
 * path counts, which over-reports references and so keeps a dead key rather
 * than flagging a live one.
 */
function findUnusedKeys(
	root: string,
	catalog: CatalogConfig,
	keys: Iterable<string>
) {
	const references = new Set<string>()
	const prefixes = new Set(catalog.dynamicKeyPrefixes ?? [])
	const catalogDir = join(root, catalog.dir) + sep
	const files = (catalog.sourceRoots ?? []).flatMap((dir) =>
		collectSourceFiles(join(root, dir))
	)

	for (const path of files) {
		// The generated key map lives next to the catalogs and names every key.
		if (path.startsWith(catalogDir)) continue

		const source = readFileSync(path, 'utf8')
		for (const [reference] of source.matchAll(KEY_REFERENCE)) {
			references.add(reference)
		}
		for (const [, prefix] of source.matchAll(KEY_FAMILY_PREFIX)) {
			if (prefix) prefixes.add(prefix)
		}
	}

	return [...keys].filter(
		(key) =>
			!references.has(key) &&
			![...prefixes].some((prefix) => key.startsWith(prefix))
	)
}

const placeholderSet = (template: string) =>
	extractPlaceholders(template).sort().join(',')

/**
 * Every problem in the configured catalogs, empty when they are valid. Paths
 * in `config` are relative to `root`.
 */
export async function validateCatalogs(
	config: I18nConfig,
	options: { root: string; checkGeneratedTypes?: boolean }
): Promise<CatalogIssue[]> {
	const { root, checkGeneratedTypes = true } = options
	const { baseLocale } = config
	const locales = [...config.locales].sort()
	const rules = createContentRules(config.rules)
	const issues: CatalogIssue[] = []
	const baseByCatalog = new Map<string, Messages>()

	// An optional peer, loaded only when a catalog needs it.
	let compiler: VueCompiler | undefined
	if (config.catalogs.some((catalog) => catalog.runtime === 'vue-i18n')) {
		try {
			compiler = await import('@intlify/message-compiler')
		} catch {
			issues.push({
				catalog: 'config',
				message:
					'vue-i18n catalogs need @intlify/message-compiler installed to check message syntax'
			})
		}
	}

	for (const catalog of config.catalogs) {
		const report = (message: string, locale?: string) =>
			issues.push({ catalog: catalog.name, locale, message })
		const syntax = (locale: string, key: string, value: string) => {
			if (catalog.runtime !== 'vue-i18n' || !compiler) return
			for (const message of vueSyntaxIssues(compiler, key, value)) {
				report(message, locale)
			}
		}

		const dir = join(root, catalog.dir)
		if (!existsSync(dir)) {
			report(`catalog directory does not exist: ${catalog.dir}`)
			continue
		}
		const files = readdirSync(dir)
			.filter((file) => file.endsWith('.json'))
			.map((file) => file.slice(0, -'.json'.length))
		const missingFiles = locales.filter((locale) => !files.includes(locale))
		const extraFiles = files.filter((locale) => !locales.includes(locale))
		if (missingFiles.length > 0) {
			report(`missing locale file(s): ${missingFiles.join(', ')}`)
		}
		if (extraFiles.length > 0) {
			report(`unregistered locale file(s): ${extraFiles.sort().join(', ')}`)
		}

		const basePath = join(dir, `${baseLocale}.json`)
		if (!existsSync(basePath)) continue
		const baseResult = readCatalog(basePath, catalog.name, baseLocale)
		issues.push(...baseResult.issues)
		if (!baseResult.messages) continue
		baseByCatalog.set(catalog.name, baseResult.messages)
		const base = flattenCatalog(baseResult.messages)

		for (const [key, value] of base) {
			const shape = rules.codeShape(value)
			if (shape) {
				report(
					`"${key}" looks like source code, not copy (${shape}): "${value}" - restore the expression at the call site instead of translating it`,
					baseLocale
				)
			}
			const markers = rules.wrongLanguage(key, value)
			if (markers) {
				report(
					`"${key}" is not ${baseLocale} (${markers}): "${value}"`,
					baseLocale
				)
			}
			const banned = rules.bannedWord(key, value, true)
			if (banned) {
				report(
					`"${key}" uses banned vocabulary "${banned}": "${value}"`,
					baseLocale
				)
			}
			syntax(baseLocale, key, value)
		}

		for (const locale of locales) {
			if (locale === baseLocale) continue
			const path = join(dir, `${locale}.json`)
			if (!existsSync(path)) continue
			const result = readCatalog(path, catalog.name, locale)
			issues.push(...result.issues)
			if (!result.messages) continue
			const translated = flattenCatalog(result.messages)

			const stale = [...translated.keys()].filter((key) => !base.has(key))
			const missing = [...base.keys()].filter((key) => !translated.has(key))
			if (stale.length > 0) {
				report(
					`stale key(s) not in ${baseLocale}.json: ${stale.join(', ')}`,
					locale
				)
			}
			if (missing.length > 0) {
				report(`missing translation key(s): ${missing.join(', ')}`, locale)
			}

			for (const [key, value] of translated) {
				// Machine translation rewrites code shapes too, so check every locale.
				const shape = rules.codeShape(value)
				if (shape) {
					report(
						`"${key}" looks like source code, not copy (${shape}): "${value}"`,
						locale
					)
				}
				const banned = rules.bannedWord(key, value, false)
				if (banned) {
					report(
						`"${key}" uses banned vocabulary "${banned}": "${value}"`,
						locale
					)
				}
				const source = base.get(key)
				if (source !== undefined) {
					if (rules.identicalLabel(key, locale, source, value)) {
						report(
							`"${key}" is identical to ${baseLocale}: "${value}" - translate it, or allow it in rules.identical.allowKeys if it is correct as-is`,
							locale
						)
					}
					if (placeholderSet(source) !== placeholderSet(value)) {
						report(
							`placeholder mismatch on "${key}" (${baseLocale}: "${source}" vs ${locale}: "${value}")`,
							locale
						)
					}
				}
				syntax(locale, key, value)
			}
		}

		if (catalog.sourceRoots?.length) {
			const byNamespace = new Map<string, string[]>()
			for (const key of findUnusedKeys(root, catalog, base.keys())) {
				const namespace = key.split('.')[0] ?? key
				byNamespace.set(namespace, [...(byNamespace.get(namespace) ?? []), key])
			}
			const scanned = catalog.sourceRoots.join(', ')
			for (const [namespace, keys] of [...byNamespace].sort(([a], [b]) =>
				a.localeCompare(b)
			)) {
				report(
					`${keys.length} unused key(s) under "${namespace}" - nothing in ${scanned} references them: ${keys.join(', ')}`
				)
			}
		}

		if (checkGeneratedTypes && catalog.generatedTypes) {
			const path = join(root, catalog.generatedTypes)
			const expected = generateCatalogTypes(catalog, baseResult.messages)
			const actual = existsSync(path) ? readFileSync(path, 'utf8') : null
			if (actual !== expected) {
				report(
					`generated types are stale; run hanzio-i18n generate (${relative(root, path)})`
				)
			}
		}
	}

	for (const group of config.disjointNamespaces ?? []) {
		const owners = new Map<string, string>()
		const collisions = new Set<string>()
		for (const name of group) {
			for (const namespace of Object.keys(baseByCatalog.get(name) ?? {})) {
				if (owners.has(namespace)) collisions.add(namespace)
				else owners.set(namespace, name)
			}
		}
		if (collisions.size > 0) {
			issues.push({
				catalog: group.join('/'),
				message: `shared top-level namespace(s): ${[...collisions].join(', ')}`
			})
		}
	}

	return issues
}

/**
 * Writes each catalog's `generatedTypes` from its base locale. Returns the
 * written paths, or the issues that stopped generation (nothing is written
 * when any base catalog is invalid).
 */
export function writeCatalogTypes(
	config: I18nConfig,
	options: { root: string }
): { written: string[]; issues: CatalogIssue[] } {
	const outputs: { path: string; contents: string }[] = []
	const issues: CatalogIssue[] = []
	for (const catalog of config.catalogs) {
		if (!catalog.generatedTypes) continue
		const parsed = readCatalog(
			join(options.root, catalog.dir, `${config.baseLocale}.json`),
			catalog.name,
			config.baseLocale
		)
		issues.push(...parsed.issues)
		if (!parsed.messages) continue
		outputs.push({
			path: join(options.root, catalog.generatedTypes),
			contents: generateCatalogTypes(catalog, parsed.messages)
		})
	}
	if (issues.length > 0) return { written: [], issues }
	for (const { path, contents } of outputs) {
		mkdirSync(dirname(path), { recursive: true })
		writeFileSync(path, contents)
	}
	return { written: outputs.map(({ path }) => path), issues }
}
