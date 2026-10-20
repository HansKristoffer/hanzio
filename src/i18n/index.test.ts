import { describe, expect, expectTypeOf, test } from 'bun:test'
import {
	createTranslator,
	extractPlaceholders,
	flattenMessages,
	interpolate,
	type MessageKeys,
	type PlaceholderNames,
	type PlaceholderParams,
	createLocaleSelector,
	defineLocales,
	type LocaleOf,
	typedTranslate
} from '.'

describe('PlaceholderNames', () => {
	test('extracts names from literal templates', () => {
		expectTypeOf<
			PlaceholderNames<'Hi {name}, you have {count} {count}'>
		>().toEqualTypeOf<'name' | 'count'>()
		expectTypeOf<PlaceholderNames<'Hello'>>().toEqualTypeOf<never>()
		expectTypeOf<PlaceholderNames<string>>().toEqualTypeOf<string>()
		// Same rules as the runtime pattern: word characters only
		expectTypeOf<
			PlaceholderNames<'{ x } {} {a b} {n, plural} {{wrapped}} {a {b}'>
		>().toEqualTypeOf<'wrapped' | 'b'>()
		expectTypeOf<PlaceholderParams<'{a}'>>().toEqualTypeOf<{
			a: string | number
		}>()
	})
})

describe('extractPlaceholders', () => {
	test('returns unique names in order, matching the type', () => {
		const names = extractPlaceholders('{name} has {count} items, {name}')
		expect(names).toEqual(['name', 'count'])
		expectTypeOf(names).toEqualTypeOf<('name' | 'count')[]>()
		expect(
			extractPlaceholders('{ x } {} {a b} {n, plural} {{wrapped}} {a {b}')
		).toEqual(['wrapped', 'b'])
	})
})

describe('interpolate', () => {
	test('replaces strings and numbers', () => {
		expect(
			interpolate('{name} has {count} items', { name: 'Ada', count: 2 })
		).toBe('Ada has 2 items')
		expect(interpolate('{a}{a}', { a: 0 })).toBe('00')
		expect(interpolate('Hello')).toBe('Hello')
	})

	test('leaves missing and inherited params untouched', () => {
		const dynamic: string = 'Hello {name} {toString}'
		expect(interpolate(dynamic)).toBe(dynamic)
		expect(interpolate(dynamic, {})).toBe(dynamic)
		const params = { name: 'Ada' } as unknown as { name: string }
		expect(interpolate('{name} {missing}' as string, params)).toBe(
			'Ada {missing}'
		)
	})

	test('types params from the template', () => {
		function typeAssertions() {
			// @ts-expect-error params are required
			interpolate('Hi {name}')
			// @ts-expect-error misspelled param
			interpolate('Hi {name}', { nam: 'Ada' })
			// @ts-expect-error extra param
			interpolate('Hi {name}', { name: 'Ada', extra: 1 })
			// @ts-expect-error no placeholders, no params
			interpolate('Hi', { name: 'Ada' })
			// @ts-expect-error values are strings or numbers
			interpolate('Hi {name}', { name: true })
		}
		expectTypeOf(typeAssertions).toBeFunction()
	})
})

const messages = {
	common: { save: 'Save' },
	greeting: 'Hi {name}',
	items: { count: '{name} has {count} items' }
} as const

describe('flattenMessages', () => {
	test('flattens to dot keys', () => {
		const flat = flattenMessages(messages)
		expect(flat).toEqual({
			'common.save': 'Save',
			greeting: 'Hi {name}',
			'items.count': '{name} has {count} items'
		})
		expectTypeOf<MessageKeys<typeof messages>>().toEqualTypeOf<
			'common.save' | 'greeting' | 'items.count'
		>()
	})
})

describe('createTranslator', () => {
	const t = createTranslator(messages)

	test('translates with params', () => {
		expect(t('common.save')).toBe('Save')
		expect(t('greeting', { name: 'Ada' })).toBe('Hi Ada')
		expect(t('items.count', { name: 'Ada', count: 2 })).toBe('Ada has 2 items')
		expect(t('nope' as 'greeting', { name: 'Ada' })).toBe('nope')
	})

	test('enforces keys and params', () => {
		function typeAssertions() {
			// @ts-expect-error unknown key
			t('common.missing')
			// @ts-expect-error intermediate keys are not messages
			t('common')
			// @ts-expect-error params are required
			t('greeting')
			// @ts-expect-error misspelled param
			t('greeting', { person: 'Ada' })
			// @ts-expect-error parameter-free keys reject params
			t('common.save', { name: 'Ada' })
		}
		expectTypeOf(typeAssertions).toBeFunction()
	})

	test('non-literal messages make params optional', () => {
		const loose: Record<string, string> = { hi: 'Hi {name}' }
		const tLoose = createTranslator(loose)
		expect(tLoose('hi')).toBe('Hi {name}')
		expect(tLoose('hi', { name: 'Ada' })).toBe('Hi Ada')
	})
})

describe('TypedTranslate', () => {
	type Params = {
		'common.save': never
		'greeting.named': 'name'
		'items.count': 'count' | 'name'
	}

	test('enforces keys and named parameters', () => {
		const t = typedTranslate<Params>(
			(key: string, params?: Record<string, unknown>) =>
				`${key}${params ? JSON.stringify(params) : ''}`
		)
		expect(t('greeting.named', { name: 'Ada' })).toBe(
			'greeting.named{"name":"Ada"}'
		)

		function typeAssertions() {
			t('common.save')
			t('items.count', { count: 2, name: 'items' })
			// @ts-expect-error invalid key
			t('common.missing')
			// @ts-expect-error parameters are required
			t('greeting.named')
			// @ts-expect-error misspelled parameter
			t('greeting.named', { person: 'Ada' })
			// @ts-expect-error parameter-free keys reject values
			t('common.save', { name: 'Ada' })
		}
		expectTypeOf(typeAssertions).toBeFunction()
	})
})

describe('defineLocales', () => {
	const locales = defineLocales({
		locales: {
			en: { tag: 'en-US', name: 'English' },
			da: { tag: 'da-DK', name: 'Dansk' },
			nb: { tag: 'nb-NO', name: 'Norsk bokmål' }
		},
		defaultLocale: 'en',
		aliases: { no: 'nb', nn: 'nb' }
	})

	test('infers the locale union', () => {
		expectTypeOf<LocaleOf<typeof locales>>().toEqualTypeOf<'en' | 'da' | 'nb'>()
		expect(locales.locales).toEqual(['en', 'da', 'nb'])
		expect(locales.tag('da')).toBe('da-DK')
		expect(locales.name('nb')).toBe('Norsk bokmål')
	})

	test('matches normalized BCP-47-ish tags', () => {
		expect(locales.match('da-DK')).toBe('da')
		expect(locales.match('EN_us')).toBe('en')
		expect(locales.match(' da ')).toBe('da')
		expect(locales.match('nb-NO')).toBe('nb')
		expect(locales.match('no-NO')).toBe('nb')
		expect(locales.match('de')).toBeNull()
		expect(locales.match(null)).toBeNull()
		for (const locale of locales.locales) {
			expect(locales.match(locales.tag(locale))).toBe(locale)
		}
	})

	test('resolve takes the first matching candidate, else the default', () => {
		expect(locales.resolve(null, 'fr-FR', 'da-DK', 'nb')).toBe('da')
		expect(locales.resolve(undefined, 'fr')).toBe('en')
		expect(locales.resolve()).toBe('en')
	})

	test('rejects a default or alias outside the locales', () => {
		expect(() =>
			defineLocales({
				locales: { en: { tag: 'en', name: 'English' } },
				// @ts-expect-error not a declared locale
				defaultLocale: 'da'
			})
		).toThrow('"da"')
		expect(() =>
			defineLocales({
				locales: { en: { tag: 'en', name: 'English' } },
				defaultLocale: 'en',
				// @ts-expect-error not a declared locale
				aliases: { no: 'nb' }
			})
		).toThrow('"nb"')
	})
})

describe('createLocaleSelector', () => {
	test('switches at once and rolls back when persisting fails', async () => {
		let current = 'en' as 'en' | 'da'
		const errors: unknown[] = []
		let fail = false
		const select = createLocaleSelector<'en' | 'da'>({
			getLocale: () => current,
			setLocale: (locale) => {
				current = locale
			},
			persist: async () => {
				if (fail) throw new Error('offline')
			},
			onError: (error) => errors.push(error)
		})

		await select('da')
		expect(current).toBe('da')
		fail = true
		await select('en')
		expect(current).toBe('da')
		expect(errors).toHaveLength(1)
	})
})
