---
description: Typed `{name}` placeholders, translators, locale registries, vue-i18n and i18next setup, and a catalog checker.
---

# hanzio/i18n

Typed `{name}` message templates and the glue around an i18n framework: a
locale registry, typed `t` for vue-i18n and i18next, their setup, and a
`hanzio-i18n` bin that checks JSON catalogs and generates their key maps.
`hanzio/i18n` itself has no dependencies; plurals and ICU syntax are the
framework's job.

```ts
import { createTranslator, extractPlaceholders, interpolate } from 'hanzio/i18n'

interpolate('Hi {name}, you have {count} messages', { name: 'Ada', count: 3 })
// 'Hi Ada, you have 3 messages'

interpolate('Hi {name}') // type error: params required
interpolate('Hi {name}', { nam: 'Ada' }) // type error: misspelled

extractPlaceholders('{name} has {count} items, {name}') // ['name', 'count']
```

## Placeholders

A placeholder is `{` + word characters (`[A-Za-z0-9_]`) + `}`. Anything else is
plain text: `{ name }`, `{}`, `{count, plural, ...}`. The types and the runtime
use the same rule.

- A placeholder without a param (or with `null`/`undefined`) stays as `{name}`.
- Only own properties of `params` are used, so `{toString}` is never filled from
  `Object.prototype`.
- Values are `string | number`, converted with `String()`.

Types:

| Type                     | `'Hi {name}, {count}'`                       |
| ------------------------ | -------------------------------------------- |
| `PlaceholderNames<S>`    | `'name' \| 'count'`                          |
| `PlaceholderParams<S>`   | `{ name: string \| number; count: ... }`     |
| `PlaceholderArgs<S>`     | `[params: PlaceholderParams<S>]`, `[]` if none |

For a non-literal `string` template, names are `string` and params are optional.

## Translator

```ts
const messages = {
	common: { save: 'Save' },
	greeting: 'Hi {name}'
} as const

const t = createTranslator(messages)

t('common.save') // 'Save'
t('greeting', { name: 'Ada' }) // 'Hi Ada'
t('greeting') // type error: params required
t('common.save', { name: 'Ada' }) // type error: no placeholders
t('common.missing') // type error: unknown key
```

Keys are the dot paths of the string leaves (`MessageKeys<T>`). Pass the
messages inline or `as const` so the templates stay literal; with plain
`Record<string, string>` messages (for example JSON imports) keys are `string`
and params are optional. A key that is missing at runtime returns the key.

`flattenMessages(messages)` gives the flat map: `{ 'common.save': 'Save', greeting: 'Hi {name}' }`.

## Typed `t` for a framework

`hanzio-i18n generate` writes a key → placeholder-name map from your base
catalog (see [Catalog checks](#catalog-checks)). `TypedTranslate<Params>`
turns it into a strict `t`, and `typedTranslate` narrows a framework's `t`:

```ts
import { typedTranslate } from 'hanzio/i18n'
import type { AppTranslationParams } from './locales/i18n.generated'

// { 'common.save': never; 'greeting': 'name' }
export const t = typedTranslate<AppTranslationParams>(i18n.t.bind(i18n))

t('greeting', { name: 'Ada' })
t('greeting') // type error: params required
t('common.save', { name: 'Ada' }) // type error: no placeholders
```

`DynamicTranslate` is the explicit escape hatch for data-driven keys.

## Locales

`defineLocales` is the one list of shipped UI locales, shared by every runtime
and the catalog check:

```ts
import { defineLocales, type LocaleOf } from 'hanzio/i18n'

export const uiLocales = defineLocales({
	locales: {
		en: { tag: 'en-US', name: 'English' },
		da: { tag: 'da-DK', name: 'Dansk' },
		nb: { tag: 'nb-NO', name: 'Norsk bokmål' }
	},
	defaultLocale: 'en',
	aliases: { no: 'nb' }
})
export type UiLocale = LocaleOf<typeof uiLocales> // 'en' | 'da' | 'nb'

uiLocales.match('da_DK') // 'da' (id, tag, language subtag, then aliases)
uiLocales.match('no-NO') // 'nb'
uiLocales.resolve(saved, navigator.language) // first match, else 'en'
uiLocales.tag('da') // 'da-DK', for Intl
uiLocales.name('nb') // 'Norsk bokmål', for pickers
```

Ids name the catalog files (`da.json`). A server enum such as `da_DK` matches
too, and `tag(locale).replace('-', '_')` goes the other way.

`createLocaleSelector` switches the locale at once and rolls back when saving
the choice fails:

```ts
const selectLocale = createLocaleSelector({
	getLocale: () => locale.value,
	setLocale,
	persist: (locale) => api.user.updateLocale({ locale }),
	onError: () => toast.error(t('settings.language.error'))
})
```

## vue-i18n

`hanzio/i18n/vue` needs `vue-i18n`. `createVueI18n` calls `createI18n` in
composition mode, starting in the persisted locale, then the browser language,
then the default (also the fallback). `messages` needs a catalog for every
locale in the registry. `setLocale` switches, persists and sets `<html lang>`.
Other options go to `createI18n` unchanged.

```ts
import { createVueI18n } from 'hanzio/i18n/vue'

export const { i18n, setLocale, useI18n } = createVueI18n({
	locales: uiLocales,
	messages: { en, da, nb },
	storageKey: 'app.ui-locale',
	datetimeFormats: { en: dateFormats, da: dateFormats, nb: dateFormats }
})

// The app's only useI18n: locale is UiLocale, t is checked against the map.
export const useAppI18n = () => useI18n<AppTranslationParams>()
```

The stored value is the raw locale id. After sign-in, call `setLocale` with the
user's saved locale so pre-auth screens match on the next visit.

`hanzio/i18n/vite` has `localeCatalogReloadPlugin()`, a dev-server plugin for
`@intlify/unplugin-vue-i18n`: an edited `locales/*.json` reloads the page with
fresh catalogs instead of serving the old ones until a restart. Pass
`{ match }` if your catalogs are not in `locales` folders.

## i18next

`hanzio/i18n/i18next` takes your `i18next` instance (`.use(initReactI18next)`
first for React). It starts in the persisted locale, then the first supported
device locale, then the default, and interpolates `{name}` without escaping,
the same syntax the rest of this module uses.

```ts
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getLocales } from 'expo-localization'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { initI18next } from 'hanzio/i18n/i18next'

export const appI18n = initI18next(i18n.use(initReactI18next), {
	locales: uiLocales,
	resources: { en: { translation: en }, da: { translation: da } },
	deviceLocales: () => getLocales().flatMap((l) => [l.languageTag, l.languageCode]),
	storageKey: 'app.ui-locale',
	storage: AsyncStorage
})

await appI18n.ready // before the first render
appI18n.locale() // 'da'
await appI18n.setLocale('en') // switches and persists
await appI18n.syncLocale(me?.locale) // follow the user's saved locale; unknown tags do nothing
```

Other options go to `i18n.init`. Type `useTranslation()`'s `t` with
`typedTranslate`.

## Catalog checks

The `hanzio-i18n` bin checks catalogs stored as one JSON file per locale
(`<dir>/<locale>.json`), with the base locale as the source of truth:

```bash
hanzio-i18n check     # fails with one line per problem
hanzio-i18n generate  # writes each catalog's generatedTypes
```

Both read `i18n.config.ts` (or `.mts`, `.js`, `.mjs`, or `--config <file>`)
from the current directory; paths in it are relative to the config file.
`defineI18nConfig` rejects a `baseLocale`, `disjointNamespaces` catalog or
`identical.allowKeys` locale the config does not declare. A
`.ts` config needs Bun, or a Node version that strips types.

```ts
import { defineI18nConfig } from 'hanzio/i18n/check'
import { uiLocales } from './src/locales'

export default defineI18nConfig({
	baseLocale: 'en',
	locales: uiLocales.locales,
	catalogs: [
		{
			name: 'platform',
			dir: 'apps/platform/src/locales',
			runtime: 'vue-i18n',
			generatedTypes: 'apps/platform/src/locales/i18n.generated.ts',
			generatedTypeName: 'PlatformTranslationParams',
			sourceRoots: ['apps/platform/src'],
			dynamicKeyPrefixes: ['entities.']
		},
		{ name: 'expo', dir: 'apps/expo/src/locales', runtime: 'i18next' }
	],
	disjointNamespaces: [['platform', 'widget']],
	rules: {
		exemptKeyPrefixes: ['admin.'],
		bannedWords: { translations: ['workflow', 'payload'] },
		wrongLanguage: { markers: ['og', 'til', 'ikke', 'vi'], letters: 'æøåÆØÅ' },
		identical: { brands: ['Acme'], allowKeys: { 'common.send': ['da', 'nb'] } }
	}
})
```

What `check` reports:

- Locale files missing from `locales`, or not in it.
- Leaves that are not strings, empty or dotted key segments, text that is not
  NFC-normalized, likely mojibake (`Ã¦`).
- Keys missing from or stale in a translation, and placeholder sets that
  differ from the base value.
- Values that look like source code (`row.name`, `carTitle(car)`,
  `LABELS[key]`, `x ?? y`), in every locale. `rules.allowCodeShapes` lists the
  exceptions.
- English left untranslated (three or more words, two English function words)
  and labels of two or more words identical to the base. Brands, acronyms and
  `rules.identical.allowKeys` are allowed.
- With `rules.wrongLanguage`: base values written in that language (two marker
  words, or one plus one of its `letters`).
- With `rules.bannedWords`: `everywhere` words in any catalog, `translations`
  words outside the base. Placeholders never count.
- `runtime: 'vue-i18n'`: HTML and syntax that vue-i18n's `strictMessage`
  compile rejects. Install `@intlify/message-compiler` for this.
- `sourceRoots`: keys no source file references. Any dotted path in a file
  counts, and `` `prefix.${x}` `` keeps a whole family; `dynamicKeyPrefixes`
  keeps families built from data.
- `generatedTypes` files that do not match the base catalog.
- `disjointNamespaces`: catalogs merged into one runtime that share a
  top-level key.

`runtime` also decides plural keys in the generated map: vue-i18n's `a | b`
messages and i18next's `key_one`/`key_other` (merged into `key`) take a
`count`. The same checks are available as `validateCatalogs(config, { root })`
and `writeCatalogTypes(config, { root })`.
