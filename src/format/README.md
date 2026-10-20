# hanzio/format

Locale-aware formatting on top of `Intl`, with no dependencies. Every function
takes the locale (a BCP-47 tag such as `'en-US'` or `'da-DK'`) explicitly, and
every function that reads the clock accepts a `now` for tests.

```ts
import { formatRelativeTime, formatBytes } from 'hanzio/format'
```

## Cached formatters

Creating an `Intl` formatter is slow; these return one shared instance per
(locale, options), keyed on a stable JSON of the options (key order does not
matter). Each cache holds the 100 most recently used formatters.

```ts
getNumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(5) // '€5.00'
getDateTimeFormat('en-GB', { dateStyle: 'medium' }).format(date) // '28 Sep 2026'
getRelativeTimeFormat('en-US', { numeric: 'auto' }).format(-1, 'day') // 'yesterday'
getListFormat('en-US', { type: 'disjunction' }).format(['a', 'b']) // 'a or b'
getPluralRules('en-US').select(1) // 'one'
```

## Numbers

```ts
formatNumber(1234567.891, 'da-DK') // '1.234.567,891'
formatPercent(0.25, 'en-US') // '25%' (takes a fraction, not 25)
formatCurrency(12.5, 'USD', 'en-US') // '$12.50' (whole units, not cents)
formatCurrency(2500, 'DKK', 'da-DK', { maximumFractionDigits: 0 }) // '2.500 kr.'
formatCompactNumber(1234, 'en-US') // '1.2K'
```

### `formatBytes(bytes, { locale?, decimals?, binary? })`

Unit labels (B, KB, MB, GB, TB, PB) are not localized; the number is. 1 KB is
1024 B by default (`binary: false` for 1000). Whole numbers up to KB, one
decimal from MB up, unless `decimals` is set. `locale` defaults to `'en-US'`.

```ts
formatBytes(3.45 * 1024 * 1024) // '3.5 MB'
```

### `formatPrice(amount, currency, locale)`

A price: whole amounts drop the minor units, fractional ones keep the
currency's usual digits instead of rounding into a price nobody charges.

```ts
formatPrice(2500, 'DKK', 'da-DK') // '2.500 kr.'
formatPrice(199.95, 'DKK', 'da-DK') // '199,95 kr.'
```

## Durations

```ts
splitDuration(93_784_005) // { days: 1, hours: 2, minutes: 3, seconds: 4, milliseconds: 5 }
formatClockDuration(3_909_000) // '1:05:09' ('5:09' under an hour)
```

### `formatDuration(ms, locale, { style?, maxUnits? })`

Truncates, never rounds up. Shows up to `maxUnits` (default 2) adjacent units
starting at the largest non-zero one, so 1 day 0 h 5 min reads `'1 day'`.
`style` is `'short'` by default.

```ts
formatDuration(3_930_000, 'en-US') // '1 hr, 5 min'
formatDuration(3_930_000, 'en-US', { style: 'narrow' }) // '1h 5m'
formatDuration(3_930_000, 'en-US', { style: 'long' }) // '1 hour, 5 minutes'
```

## Date presets

`formatDate(date, preset, locale)` formats a date in local time with a named
layout. The names read like dayjs tokens, but the order follows the locale.
The `HH` presets always use a 24-hour clock.

```ts
formatDate(date, 'D MMM', 'en-GB') // '5 Mar'
formatDate(date, 'D MMM', 'en-US') // 'Mar 5'
formatDate(date, 'HH:mm', 'en-US') // '07:04'
formatDateTime(date, 'en-GB') // '5 Mar 2026, 07:04' (newer ICU: '5 Mar 2026 at 07:04')
```

Presets: `'DD/MM/YYYY'`, `'DD/MM/YYYY HH:mm'`, `'HH:mm'`, `'ddd'`, `'D MMM'`,
`'D MMM YYYY'`, `'dddd, MMMM D'`, `'MMMM YYYY'`.

`formatCompactTime(date, locale, { now? })` is an activity timestamp for list
rows: the time today, "yesterday", else the date (with the year when it is not
this year). `formatDayDivider(date, locale, { now? })` labels a chat timeline:
"today", "yesterday", else weekday and date. Both return `''` for unparseable
input.

### `withLocale(getLocale)`

The date, number and price formatters with the locale read on every call, for
apps that keep the active locale in their i18n runtime:

```ts
export const fmt = withLocale(() => uiLocales.tag(appI18n.locale()))
fmt.formatCompactTime(message.createdAt)
```

## Relative time

### `formatRelativeTime(date, locale, { now?, numeric?, style?, withSuffix? })`

Picks seconds, minutes, hours, days (< 30), months (30-day) or years.
`numeric` defaults to `'auto'` ("yesterday"). `withSuffix: false` returns the
bare amount ("5 minutes") for use next to a label that already says when.
Unparseable input returns `''`.

```ts
formatRelativeTime('2026-09-28T11:00:00Z', 'en-US', { now: new Date('2026-09-28T12:00:00Z') }) // '1 hour ago'
```

### `formatWait(value, locale, { now? })`

Compact "how long has this waited" for a status pill: floors, never below
`1 min`, a future timestamp counts as no waiting. A `number` is a duration in
milliseconds; a `Date` or string is a start time measured against `now`.

```ts
formatWait(14 * 60_000 + 50_000, 'en-US') // '14 min'
```

## Dates and lists

### `formatDateRange(start, end, locale, options?)`

Uses `Intl.DateTimeFormat#formatRange`, which collapses the shared parts. When
`options` has no date/time fields, it uses day + short month + year (and still
applies `timeZone` and similar options).

```ts
formatDateRange('2026-08-24', '2026-08-30', 'en-GB', { timeZone: 'UTC' }) // '24–30 Aug 2026'
```

### `formatList(items, locale, options?)`

```ts
formatList(['a', 'b', 'c'], 'en-US') // 'a, b, and c'
```

## Counts and empty values

```ts
formatCappedCount(150) // '99+' (a negative number or NaN gives '0')
formatCappedCount(12, 9) // '9+'
pluralize(1234, { one: '{count} item', other: '{count} items' }, 'en-US') // '1,234 items'
```

`pluralize` picks the form with `Intl.PluralRules` and falls back to `other`.

`EM_DASH` (`'—'`) stands for "no value" in a table cell or detail row that must
keep its height, so a hyphen and an em dash never end up in the same column.

## Phone numbers

`hanzio/format/phone` needs `libphonenumber-js`, so it is a separate import.
`formatPhone(value, country?)` prints a stored number as a person reads it.
`country` is the reader's ISO 3166-1 alpha-2 country: a number from that
country prints the local way, any other with its country code.

```ts
import { formatPhone } from 'hanzio/format/phone'

formatPhone('+4520304050', 'DK') // '20 30 40 50'
formatPhone('+4520304050') // '+45 20 30 40 50'
formatPhone('+4512345678', 'DK') // '+45 12345678' (not a valid DK number)
formatPhone('extension 4021') // 'extension 4021'
```

Nothing is lost: an unparseable value comes back trimmed, and the national form
is used only for a valid number. Empty input returns `''`. Keep the raw E.164
value for `tel:` links.

## Runtime support

Works in browsers, Node, Bun, Workers and React Native. On Hermes, polyfill
`Intl.RelativeTimeFormat` and `Intl.PluralRules` if your Hermes build does not
have them. Load the FormatJS polyfills before any app code; the locale-data
imports must be literal paths for Metro, so list your locales by hand:

```ts
// intl-polyfill.ts, imported first in the app entry
import '@formatjs/intl-getcanonicallocales/polyfill'
import '@formatjs/intl-locale/polyfill'
import '@formatjs/intl-pluralrules/polyfill'
import '@formatjs/intl-pluralrules/locale-data/en'
import '@formatjs/intl-pluralrules/locale-data/da'
import '@formatjs/intl-relativetimeformat/polyfill'
import '@formatjs/intl-relativetimeformat/locale-data/en'
import '@formatjs/intl-relativetimeformat/locale-data/da'
```

The non-`force` polyfills skip APIs Hermes already has. `formatList`, `formatDuration` and `formatDateRange` fall back to
plain separators when `Intl.ListFormat` or `formatRange` is missing.
