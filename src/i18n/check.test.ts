import { afterEach, describe, expect, test } from 'bun:test'
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateCatalogTypes } from './catalog'
import {
	type CatalogConfig,
	type ContentRulesConfig,
	validateCatalogs,
	writeCatalogTypes
} from './check'
import { createContentRules } from './content-rules'

// A cut-down version of a real app's rules: Danish markers, banned loanwords.
const rulesConfig = {
	exemptKeyPrefixes: ['landing.', 'system.'],
	allowCodeShapes: ['Solgt.com'],
	wrongLanguage: {
		markers: ['og', 'til', 'med', 'om', 'dit', 'vi', 'ikke'],
		letters: 'æøåÆØÅ'
	},
	bannedWords: {
		everywhere: ['videnshul', 'videnshuller'],
		translations: ['workflow', 'payload', 'pipeline']
	},
	identical: {
		brands: ['Lullu'],
		allowKeys: { 'deal.sendEmail': ['da', 'nb'] }
	}
} satisfies ContentRulesConfig

const rules = createContentRules(rulesConfig)
const roots: string[] = []

afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true })
})

function fixture(
	en: unknown,
	da: unknown,
	options: {
		extraLocale?: boolean
		widget?: unknown
		/** Files in a scanned source tree, keyed by file name. */
		source?: Record<string, string>
		dynamicKeyPrefixes?: string[]
	} = {}
) {
	const root = mkdtempSync(join(tmpdir(), 'hanzio-i18n-'))
	roots.push(root)
	const catalogs: CatalogConfig[] = [
		{
			name: 'platform',
			dir: 'platform',
			runtime: 'vue-i18n',
			...(options.source ? { sourceRoots: ['src'] } : {}),
			...(options.dynamicKeyPrefixes
				? { dynamicKeyPrefixes: options.dynamicKeyPrefixes }
				: {})
		}
	]
	if (options.source) {
		mkdirSync(join(root, 'src'))
		for (const [name, contents] of Object.entries(options.source)) {
			writeFileSync(join(root, 'src', name), contents)
		}
	}
	mkdirSync(join(root, 'platform'))
	writeFileSync(join(root, 'platform/en.json'), JSON.stringify(en))
	writeFileSync(join(root, 'platform/da.json'), JSON.stringify(da))
	if (options.extraLocale) {
		writeFileSync(join(root, 'platform/fr.json'), JSON.stringify(en))
	}
	if (options.widget) {
		catalogs.push({ name: 'widget', dir: 'widget', runtime: 'vue-i18n' })
		mkdirSync(join(root, 'widget'))
		writeFileSync(join(root, 'widget/en.json'), JSON.stringify(options.widget))
		writeFileSync(join(root, 'widget/da.json'), JSON.stringify(options.widget))
	}
	return validateCatalogs(
		{
			baseLocale: 'en',
			locales: ['en', 'da'],
			catalogs,
			disjointNamespaces: [['platform', 'widget']],
			rules: rulesConfig
		},
		{ root, checkGeneratedTypes: false }
	)
}

const messagesOf = async (issues: ReturnType<typeof fixture>) =>
	(await issues).map((issue) => issue.message)

describe('validateCatalogs', () => {
	test('accepts complete matching catalogs', async () => {
		expect(
			await fixture(
				{ common: { hello: 'Hello {name}' } },
				{ common: { hello: 'Hej {name}' } }
			)
		).toEqual([])
	})

	test('rejects missing, stale, and mismatched placeholder keys', async () => {
		const messages = await messagesOf(
			fixture(
				{ common: { hello: 'Hello {name}', save: 'Save' } },
				{ common: { hello: 'Hej {person}', old: 'Old' } }
			)
		)
		expect(messages.some((m) => m.includes('stale key'))).toBe(true)
		expect(messages.some((m) => m.includes('missing translation'))).toBe(true)
		expect(messages.some((m) => m.includes('placeholder mismatch'))).toBe(true)
	})

	test('rejects unregistered locale files and invalid leaves', async () => {
		const messages = await messagesOf(
			fixture(
				{ common: { count: 1 } },
				{ common: { count: 'En' } },
				{
					extraLocale: true
				}
			)
		)
		expect(messages.some((m) => m.includes('unregistered locale'))).toBe(true)
		expect(messages.some((m) => m.includes('object or string'))).toBe(true)
	})

	test('rejects mojibake and non-normalized Unicode', async () => {
		const messages = await messagesOf(
			fixture(
				{ common: { loading: 'Loading' } },
				{ common: { loading: 'IndlÃ¦ser é' } }
			)
		)
		expect(messages.some((m) => m.includes('mojibake'))).toBe(true)
		expect(messages.some((m) => m.includes('NFC-normalized'))).toBe(true)
	})

	test('reports unused keys, keeping template families and dynamic prefixes', async () => {
		const messages = await messagesOf(
			fixture(
				{
					common: { used: 'Used', dead: 'Dead' },
					agents: { fields: { name: 'Name', tone: 'Tone' } },
					entities: { vehicle: { SOLD: 'Sold' } }
				},
				{
					common: { used: 'Brugt', dead: 'Dod' },
					agents: { fields: { name: 'Navn', tone: 'Tone' } },
					entities: { vehicle: { SOLD: 'Solgt' } }
				},
				{
					source: {
						'app.vue': `t('common.used')\nt(\`agents.fields.\${field}\`)\n`
					},
					dynamicKeyPrefixes: ['entities.']
				}
			)
		)
		expect(messages).toEqual([
			'1 unused key(s) under "common" - nothing in src references them: common.dead'
		])
	})

	// An extraction pass once stored template expressions as translations:
	// "row.name" rendered literally for every row of a list.
	test('rejects values that are source code rather than copy', async () => {
		const issues = await fixture(
			{
				channels: { title: 'row.name' },
				workflow: { handler: 'updateNodeDescription' },
				cars: { alt: 'carTitle(car)' },
				agent: { label: 'FIELD_LABELS[field.name]' },
				ui: { tip: 'tooltip ?? undefined' }
			},
			{
				channels: { title: 'Zeilenname' },
				workflow: { handler: 'updateNodeDescription' },
				cars: { alt: 'carTitle(bil)' },
				agent: { label: 'FIELD_LABELS[felt.navn]' },
				ui: { tip: 'verktøytips ?? udefinert' }
			}
		)
		for (const key of [
			'channels.title',
			'workflow.handler',
			'cars.alt',
			'agent.label',
			'ui.tip'
		]) {
			expect(
				issues.some(
					(i) =>
						i.message.includes(key) &&
						i.message.includes('looks like source code')
				)
			).toBe(true)
		}
		// Shapes that survive machine translation are caught in the locale too.
		expect(
			issues.some(
				(i) => i.locale === 'da' && i.message.includes('carTitle(bil)')
			)
		).toBe(true)
		expect(
			issues.some((i) => i.locale === 'da' && i.message.includes('udefinert'))
		).toBe(true)
	})

	test('accepts real copy that superficially resembles code', async () => {
		expect(
			await fixture(
				{
					brand: { partner: 'Solgt.com' },
					common: { perMonth: '{count} mo.', cancel: 'Cancel' },
					cars: { status: 'In transit', vin: 'VIN' },
					support: { seen: 'Seen {time}', using: 'Using {tool}…' }
				},
				{
					brand: { partner: 'Solgt.com' },
					common: { perMonth: '{count} mdr.', cancel: 'Annuller' },
					cars: { status: 'På vej', vin: 'VIN' },
					support: { seen: 'Set {time}', using: 'Bruger {tool}…' }
				}
			)
		).toEqual([])
	})

	test('rejects copy in another language committed to the base catalog', async () => {
		const issues = await fixture(
			{ consent: { title: 'Vi værner om dit privatliv' } },
			{ consent: { title: 'Vi værner om dit privatliv' } }
		)
		expect(
			issues.some((i) => i.locale === 'en' && i.message.includes('is not en'))
		).toBe(true)
	})

	test('allows an English sentence containing a Scandinavian proper noun', async () => {
		expect(
			await fixture(
				{ landing: { quote: 'Søren Dahl - wrote Saturday at 8:18 p.m.' } },
				{ landing: { quote: 'Søren Dahl - skrev lørdag klokken 20.18' } }
			)
		).toEqual([])
	})

	test('rejects vue-i18n syntax that strictMessage compiles reject', async () => {
		const messages = await messagesOf(
			fixture(
				{
					support: {
						fixture: '{ "inventory": { ... } }',
						html: 'Click <b>here</b>'
					}
				},
				{
					support: {
						fixture: '{ "inventory": { ... } }',
						html: 'Klik <b>her</b>'
					}
				}
			)
		)
		expect(
			messages.some(
				(m) => m.includes('fixture') && m.includes('not valid vue-i18n syntax')
			)
		).toBe(true)
		expect(
			messages.some((m) => m.includes('html') && m.includes('contains HTML'))
		).toBe(true)
	})

	test('rejects catalogs merged into one runtime that share a namespace', async () => {
		const messages = await messagesOf(
			fixture(
				{ common: { save: 'Save' } },
				{ common: { save: 'Gem' } },
				{
					widget: { common: { send: 'Send' } }
				}
			)
		)
		expect(messages).toContain('shared top-level namespace(s): common')
	})

	test('reports a label identical to its source', async () => {
		expect(
			await messagesOf(
				fixture(
					{ dialogs: { submit: 'Resolve gap' } },
					{ dialogs: { submit: 'Resolve gap' } }
				)
			)
		).toEqual([expect.stringContaining('"dialogs.submit" is identical to en')])
	})
})

describe('generated types', () => {
	test('include placeholders and runtime plural counts', () => {
		expect(
			generateCatalogTypes(
				{ runtime: 'vue-i18n', generatedTypeName: 'WidgetParams' },
				{
					items: {
						count: 'No items | One item for {name} | {count} items for {name}'
					}
				}
			)
		).toContain("'items.count': 'count' | 'name'")
		expect(
			generateCatalogTypes(
				{ runtime: 'i18next' },
				{
					items: {
						vehicle_one: '{name} has one vehicle',
						vehicle_other: '{name} has vehicles'
					}
				}
			)
		).toContain("'items.vehicle': 'count' | 'name'")
	})

	test('writeCatalogTypes writes what the check expects', async () => {
		const root = mkdtempSync(join(tmpdir(), 'hanzio-i18n-'))
		roots.push(root)
		mkdirSync(join(root, 'locales'))
		writeFileSync(join(root, 'locales/en.json'), '{"hi":"Hi {name}"}')
		const config = {
			baseLocale: 'en',
			locales: ['en'],
			catalogs: [
				{
					name: 'app',
					dir: 'locales',
					runtime: 'plain',
					generatedTypes: 'locales/i18n.generated.ts',
					generatedTypeName: 'AppParams'
				}
			]
		} as const
		expect(await validateCatalogs(config, { root })).toEqual([
			{
				catalog: 'app',
				message:
					'generated types are stale; run hanzio-i18n generate (locales/i18n.generated.ts)'
			}
		])
		const { written } = writeCatalogTypes(config, { root })
		expect(written).toEqual([join(root, 'locales/i18n.generated.ts')])
		expect(readFileSync(written[0]!, 'utf8')).toContain("\t'hi': 'name'")
		expect(await validateCatalogs(config, { root })).toEqual([])
	})
})

describe('banned vocabulary', () => {
	test('rejects a banned word in a translation, not in the base', () => {
		expect(
			rules.bannedWord('automations.empty', 'Ingen workflows endnu', false)
		).toBe('workflows')
		expect(
			rules.bannedWord('automations.empty', 'No workflows yet', true)
		).toBeNull()
	})

	test('does not read a {pipeline} placeholder as the word', () => {
		expect(rules.bannedWord('deals.status', '{pipeline}', false)).toBeNull()
	})

	test('exempts configured key prefixes', () => {
		expect(
			rules.bannedWord('system.worker.payload', 'Payload', false)
		).toBeNull()
		expect(
			rules.bannedWord('landing.foo', 'Videnshul fundet', false)
		).toBeNull()
	})

	test('bans `everywhere` words in the base too', () => {
		expect(rules.bannedWord('gaps.title', 'Videnshuller', true)).toBe(
			'Videnshuller'
		)
	})
})

describe('untranslated English', () => {
	test('flags an English sentence shipped as a translation', () => {
		const text = 'A customer is waiting for a human reply.'
		expect(rules.untranslatedEnglish('handover', 'da', text, text)).toBe(true)
		expect(
			rules.untranslatedEnglish(
				'handover',
				'da',
				text,
				'En kunde venter på svar.'
			)
		).toBe(false)
	})

	test('ignores company names and short labels', () => {
		expect(
			rules.untranslatedEnglish(
				'org',
				'da',
				'Hansen Biler A/S',
				'Hansen Biler A/S'
			)
		).toBe(false)
		expect(rules.untranslatedEnglish('email', 'da', 'Email', 'Email')).toBe(
			false
		)
	})
})

describe('identical labels', () => {
	test('flags a short label shipped untranslated', () => {
		expect(
			rules.identicalLabel('doc.label', 'da', 'Document name', 'Document name')
		).toBe(true)
		expect(
			rules.identicalLabel('doc.label', 'da', 'Document name', 'Dokumentnavn')
		).toBe(false)
	})

	test('ignores single words, brands, URLs and selectors', () => {
		expect(rules.identicalLabel('status', 'da', 'Status', 'Status')).toBe(false)
		expect(rules.identicalLabel('label', 'da', 'Lullu AI', 'Lullu AI')).toBe(
			false
		)
		expect(
			rules.identicalLabel(
				'site',
				'da',
				'https://example.com',
				'https://example.com'
			)
		).toBe(false)
		expect(
			rules.identicalLabel(
				'selector',
				'da',
				'.vehicle-sidebar',
				'.vehicle-sidebar'
			)
		).toBe(false)
	})

	test('an allowed key is only accepted in its locales', () => {
		expect(
			rules.identicalLabel('deal.sendEmail', 'da', 'Send email', 'Send email')
		).toBe(false)
		expect(
			rules.identicalLabel('deal.sendEmail', 'de', 'Send email', 'Send email')
		).toBe(true)
	})
})
