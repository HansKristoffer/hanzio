export type LocaleInfo = {
	/** BCP-47 tag for `Intl` and `<html lang>`, e.g. `'da-DK'`. */
	tag: string
	/** The language naming itself, for locale pickers: `'Dansk'`. */
	name: string
}

export type LocaleRegistry<L extends string> = {
	/** Locale ids in declaration order. They name the catalog files. */
	readonly locales: readonly L[]
	readonly defaultLocale: L
	tag(locale: L): string
	name(locale: L): string
	/**
	 * A supported locale for a BCP-47-ish tag (`'da'`, `'da-DK'`, `'en_US'`), or
	 * `null`. Matches the id, then the tag, then the language subtag, then the
	 * aliases.
	 */
	match(tag: string | null | undefined): L | null
	/** The first candidate that matches, else `defaultLocale`. */
	resolve(...candidates: readonly (string | null | undefined)[]): L
}

/** The locale union of a registry: `LocaleOf<typeof locales>`. */
export type LocaleOf<R> = R extends LocaleRegistry<infer L> ? L : never

const normalizeTag = (tag: string) =>
	tag.trim().replaceAll('_', '-').toLowerCase()

/**
 * The app's shipped UI locales, shared by every runtime and the catalog check.
 *
 * ```ts
 * export const uiLocales = defineLocales({
 * 	locales: {
 * 		en: { tag: 'en-US', name: 'English' },
 * 		nb: { tag: 'nb-NO', name: 'Norsk bokmål' }
 * 	},
 * 	defaultLocale: 'en',
 * 	aliases: { no: 'nb' }
 * })
 * uiLocales.match('no-NO') // 'nb'
 * ```
 */
export function defineLocales<
	const T extends Record<string, LocaleInfo>
>(options: {
	locales: T
	defaultLocale: keyof T & string
	/** Extra tags or language subtags that mean a locale: `{ no: 'nb' }`. */
	aliases?: Record<string, keyof T & string>
}): LocaleRegistry<keyof T & string> {
	type L = keyof T & string
	const { locales: info, defaultLocale, aliases = {} } = options
	const locales = Object.keys(info) as L[]
	const lookup = new Map<string, L>()
	for (const locale of locales) lookup.set(normalizeTag(locale), locale)
	for (const locale of locales) {
		const tag = normalizeTag(info[locale]!.tag)
		if (!lookup.has(tag)) lookup.set(tag, locale)
	}
	const aliasLookup = new Map<string, L>()
	for (const [alias, locale] of Object.entries(aliases)) {
		if (!Object.hasOwn(info, locale)) {
			throw new Error(`Alias "${alias}" points at unknown locale "${locale}"`)
		}
		aliasLookup.set(normalizeTag(alias), locale)
	}
	if (!Object.hasOwn(info, defaultLocale)) {
		throw new Error(`Default locale "${defaultLocale}" is not in locales`)
	}

	const match = (tag: string | null | undefined): L | null => {
		if (!tag) return null
		const full = normalizeTag(tag)
		const language = full.split('-')[0] ?? ''
		return (
			lookup.get(full) ??
			aliasLookup.get(full) ??
			lookup.get(language) ??
			aliasLookup.get(language) ??
			null
		)
	}

	return {
		locales,
		defaultLocale,
		tag: (locale) => info[locale]!.tag,
		name: (locale) => info[locale]!.name,
		match,
		resolve: (...candidates) => {
			for (const candidate of candidates) {
				const locale = match(candidate)
				if (locale) return locale
			}
			return defaultLocale
		}
	}
}

/**
 * A locale picker that switches immediately and rolls back when `persist`
 * (for example saving the user's language on the server) rejects.
 *
 * ```ts
 * const selectLocale = createLocaleSelector({
 * 	getLocale: () => locale.value,
 * 	setLocale,
 * 	persist: (locale) => api.user.updateLocale({ locale }),
 * 	onError: () => toast.error(t('settings.language.error'))
 * })
 * ```
 */
export function createLocaleSelector<L extends string>(options: {
	getLocale: () => L
	setLocale: (locale: L) => unknown
	persist?: (locale: L) => Promise<unknown>
	onError?: (error: unknown) => void
}): (locale: L) => Promise<void> {
	const { getLocale, setLocale, persist, onError } = options
	return async (next) => {
		const previous = getLocale()
		if (previous === next) return
		await setLocale(next)
		if (!persist) return
		try {
			await persist(next)
		} catch (error) {
			await setLocale(previous)
			onError?.(error)
		}
	}
}
