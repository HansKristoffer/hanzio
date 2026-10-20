// vue-i18n bindings: a locale-registry-aware `createI18n` and a typed
// composer. Needs `vue-i18n` (and so `vue`).

import type { WritableComputedRef } from 'vue'
import { createI18n, type I18nOptions, useI18n } from 'vue-i18n'
import { createStorageItem, type SyncStorageLike } from '../storage'
import {
	type LocaleRegistry,
	type TranslationParamsMap,
	typedTranslate
} from '.'

export type CreateVueI18nOptions<L extends string> = Omit<
	I18nOptions,
	'legacy' | 'locale'
> & {
	locales: LocaleRegistry<L>
	/**
	 * Remembers the chosen locale (a raw string) so screens before sign-in come
	 * up in the right language. Omit to persist nothing.
	 */
	storageKey?: string
	/** Defaults to `localStorage`, falling back to memory. */
	storage?: SyncStorageLike
}

type BrowserGlobals = {
	navigator?: { language?: string }
	document?: { documentElement: { lang: string } }
}

const browser = globalThis as BrowserGlobals

/**
 * `createI18n` in composition mode, starting in the persisted locale, then the
 * browser language, then `locales.defaultLocale` (also the fallback locale).
 * `setLocale` is the one write path: it switches vue-i18n, persists the choice
 * and keeps `<html lang>` accurate.
 */
export function createVueI18n<L extends string>(
	options: CreateVueI18nOptions<L>
) {
	const { locales, storageKey, storage, ...i18nOptions } = options
	const persisted = storageKey
		? createStorageItem<string | null>({
				key: storageKey,
				fallback: null,
				storage,
				serialize: (value) => value ?? '',
				deserialize: (raw) => raw
			})
		: undefined
	const initial = locales.resolve(persisted?.get(), browser.navigator?.language)
	const i18n = createI18n({
		fallbackLocale: locales.defaultLocale,
		...i18nOptions,
		legacy: false,
		locale: initial
	})

	const apply = (locale: L) => {
		;(i18n.global.locale as WritableComputedRef<string>).value = locale
		if (browser.document) browser.document.documentElement.lang = locale
	}
	apply(initial)

	return {
		i18n,
		setLocale(locale: L) {
			apply(locale)
			persisted?.set(locale)
		}
	}
}

/**
 * vue-i18n's composer with the locale and `t` narrowed to your registry and
 * generated key map. The one place an app should call `useI18n`.
 */
export function useTypedI18n<
	L extends string,
	Params extends TranslationParamsMap
>() {
	const composer = useI18n()
	return {
		...composer,
		locale: composer.locale as WritableComputedRef<L>,
		t: typedTranslate<Params>(composer.t)
	}
}
