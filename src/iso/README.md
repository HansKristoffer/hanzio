# hanzio/iso

ISO codes as literal unions, with English names. Static data with no
dependencies, so it works where `Intl.DisplayNames` does not (Hermes). For
names in other languages, use `Intl.DisplayNames`.

```ts
import {
	countryCodes,
	countryFlag,
	countryNames,
	currencyNames,
	languageNames,
	matchLanguageCode,
	type CountryCode
} from 'hanzio/iso'

countryNames.DK // 'Denmark'
countryFlag('DK') // '🇩🇰'
currencyNames.EUR // 'Euro'
languageNames.nb // 'Norwegian Bokmål'
matchLanguageCode('da_DK') // 'da'

const options = countryCodes.map((code) => ({
	value: code,
	label: `${countryFlag(code)} ${countryNames[code]}`
}))
```

| Data | Codes | Type and guard |
| --- | --- | --- |
| `countryNames` | All 249 ISO 3166-1 alpha-2 codes | `CountryCode`, `isCountryCode` |
| `currencyNames` | ISO 4217 codes in circulation (no historic codes, funds or metals) | `CurrencyCode`, `isCurrencyCode` |
| `languageNames` | All 183 ISO 639-1 codes, lowercase | `LanguageCode`, `isLanguageCode` |

`countryCodes`, `currencyCodes` and `languageCodes` list the keys.
`matchLanguageCode(tag)` returns the language subtag of a BCP-47-ish tag when
it is an ISO 639-1 code; map languages your app treats as one (`'nn'` to
`'nb'`, say) yourself.

`languageFromE164PhoneNumber(number)` guesses a conversation language from a
phone number's calling code (`'+4520304050'` → `'da'`). It covers the Nordics,
the UK, Ireland, North America and the larger Western European countries, and
returns `null` for anything else.
