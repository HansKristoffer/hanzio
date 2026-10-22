// i18next bindings for apps (React Native, React) that keep `{name}`
// placeholders. Types only from `i18next`: you pass your own instance, already
// `.use(initReactI18next)` where you need React.

import type { i18n as I18next, InitOptions, ResourceLanguage } from 'i18next'
import {
	type AsyncStorageLike,
	createAsyncStorageItem
} from '../storage/index.js'
import type { LocaleRegistry } from './index.js'

/**
 * Starts `i18n` in the persisted locale, then the first supported device
 * locale, then `locales.defaultLocale` (also the fallback). Interpolation uses
 * `{name}` (not `{{name}}`) and does not escape, matching the catalog check
 * and `hanzio/i18n`.
 *
 * ```ts
 * export const appI18n = initI18next(i18n.use(initReactI18next), {
 * 	locales: uiLocales,
 * 	resources: { en: { translation: en }, da: { translation: da } },
 * 	deviceLocales: () => getLocales().flatMap((l) => [l.languageTag, l.languageCode]),
 * 	storageKey: 'app.ui-locale',
 * 	storage: AsyncStorage
 * })
 * ```
 */
export function initI18next<L extends string>(
	i18n: I18next,
	options: Omit<InitOptions, 'lng' | 'resources'> & {
		locales: LocaleRegistry<L>
		resources: Record<L, ResourceLanguage>
		/** Device languages in preference order, e.g. from `expo-localization`. */
		deviceLocales?: () => readonly (string | null | undefined)[]
		/** Remembers the chosen locale (a raw string). Needs `storage`. */
		storageKey?: string
		storage?: AsyncStorageLike
	}
) {
	const { locales, deviceLocales, storageKey, storage, ...initOptions } =
		options
	const persisted =
		storageKey && storage
			? createAsyncStorageItem<string | null>({
					key: storageKey,
					fallback: null,
					storage,
					serialize: (value) => value ?? '',
					deserialize: (raw) => raw
				})
			: undefined

	const ready = (async () => {
		const locale = locales.resolve(
			await persisted?.get(),
			...(deviceLocales?.() ?? [])
		)
		await i18n.init({
			fallbackLng: locales.defaultLocale,
			returnNull: false,
			...initOptions,
			interpolation: {
				escapeValue: false,
				prefix: '{',
				suffix: '}',
				...initOptions.interpolation
			},
			lng: locale
		})
	})()

	async function setLocale(locale: L) {
		if (i18n.language !== locale) await i18n.changeLanguage(locale)
		await persisted?.set(locale)
	}

	return {
		/** Resolves once `i18n.init` finishes. Await it before the first render. */
		ready,
		setLocale,
		/** The active locale, or the default before `ready`. */
		locale: () => locales.match(i18n.language) ?? locales.defaultLocale,
		/**
		 * Follows a server-side preference (the signed-in user's locale). An
		 * unsupported or missing tag changes nothing.
		 */
		async syncLocale(tag: string | null | undefined) {
			const locale = locales.match(tag)
			if (locale) await setLocale(locale)
		}
	}
}
