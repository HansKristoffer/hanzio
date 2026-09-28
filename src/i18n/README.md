---
description: Typed `{name}` placeholders, interpolation and a small typed translator.
---

# hanzio/i18n

A typed helper for `{name}` message templates, not an i18n framework: no
plurals, ICU, locale negotiation or escaping.

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
