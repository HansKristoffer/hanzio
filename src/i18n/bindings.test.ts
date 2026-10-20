import { describe, expect, test } from 'bun:test'
import i18next from 'i18next'
import { createMemoryStorage } from '../storage'
import { defineLocales } from '.'
import { initI18next } from './i18next'
import { localeCatalogReloadPlugin } from './vite'
import { createVueI18n } from './vue'

const locales = defineLocales({
	locales: {
		en: { tag: 'en-US', name: 'English' },
		da: { tag: 'da-DK', name: 'Dansk' }
	},
	defaultLocale: 'en'
})

describe('createVueI18n', () => {
	const messages = { en: { hi: 'Hi {name}' }, da: { hi: 'Hej {name}' } }

	test('starts in the persisted locale and persists changes raw', () => {
		const storage = createMemoryStorage()
		storage.setItem('ui-locale', 'da-DK')
		const { i18n, setLocale } = createVueI18n({
			locales,
			messages,
			storageKey: 'ui-locale',
			storage
		})
		expect(i18n.global.locale.value).toBe('da')
		expect(i18n.global.t('hi', { name: 'Ada' })).toBe('Hej Ada')

		setLocale('en')
		expect(i18n.global.locale.value).toBe('en')
		expect(storage.getItem('ui-locale')).toBe('en')
	})

	test('falls back to the default locale', () => {
		const { i18n } = createVueI18n({ locales, messages })
		expect(i18n.global.fallbackLocale.value).toBe('en')
		expect(locales.locales).toContain(i18n.global.locale.value as 'en')
	})
})

describe('initI18next', () => {
	const resources = {
		en: { translation: { hi: 'Hi {name}' } },
		da: { translation: { hi: 'Hej {name}' } }
	}

	test('resolves persisted, then device locale, with {name} interpolation', async () => {
		const map = new Map<string, string>()
		const storage = {
			getItem: async (key: string) => map.get(key) ?? null,
			setItem: async (key: string, value: string) => {
				map.set(key, value)
			},
			removeItem: async (key: string) => {
				map.delete(key)
			}
		}
		const i18n = i18next.createInstance()
		const app = initI18next(i18n, {
			showSupportNotice: false,
			locales,
			resources,
			deviceLocales: () => ['fr-FR', 'da-DK'],
			storageKey: 'ui-locale',
			storage
		})
		await app.ready
		expect(app.locale()).toBe('da')
		expect(i18n.t('hi', { name: 'Ada & co' })).toBe('Hej Ada & co')

		await app.syncLocale('en_US')
		expect(app.locale()).toBe('en')
		expect(map.get('ui-locale')).toBe('en')
		await app.syncLocale('fr')
		expect(app.locale()).toBe('en')

		const next = initI18next(i18next.createInstance(), {
			locales,
			resources,
			deviceLocales: () => ['da'],
			storageKey: 'ui-locale',
			storage
		})
		await next.ready
		expect(next.locale()).toBe('en')
	})
})

describe('localeCatalogReloadPlugin', () => {
	function run(file: string, environment = 'client') {
		const invalidated: string[] = []
		const sent: unknown[] = []
		const modules = new Map([
			['virtual:intlify-i18n-0', { id: 'virtual:intlify-i18n-0' }],
			['/src/main.ts', { id: '/src/main.ts' }]
		])
		const context = {
			environment: {
				name: environment,
				moduleGraph: {
					idToModuleMap: modules,
					invalidateModule: (module: { id: string }) =>
						invalidated.push(module.id)
				},
				hot: { send: (payload: unknown) => sent.push(payload) }
			}
		}
		const hook = localeCatalogReloadPlugin().hotUpdate as unknown as (
			this: typeof context,
			options: { file: string }
		) => unknown
		const result = hook.call(context, { file })
		return { result, invalidated, sent }
	}

	test('invalidates catalog modules and reloads on a catalog change', () => {
		expect(run('/app/src/locales/da.json')).toEqual({
			result: [],
			invalidated: ['virtual:intlify-i18n-0'],
			sent: [{ type: 'full-reload' }]
		})
	})

	test('ignores other files and non-client environments', () => {
		expect(run('/app/src/main.ts').sent).toEqual([])
		expect(run('/app/src/locales/da.json', 'ssr').sent).toEqual([])
	})
})
