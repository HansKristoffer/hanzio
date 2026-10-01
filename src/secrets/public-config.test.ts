import { expect, test } from 'bun:test'
import { readPublicConfig } from './public-config'
import { getViteDefine, viteSecretSetPlugin } from './vite'

test('selects public keys without reading unrelated credentials or mutating inputs', () => {
	const values = {
		VITE_API_URL: 'https://example.test/api',
		get PRIVATE_UPLOAD_TOKEN(): string {
			throw new Error('Private credentials must not be read')
		}
	}
	const config = readPublicConfig(['VITE_API_URL'], values)

	expect(config.secrets()).toEqual({ VITE_API_URL: 'https://example.test/api' })
	expect(viteSecretSetPlugin(config).config()).toEqual({
		define: { 'import.meta.env.VITE_API_URL': '"https://example.test/api"' }
	})
	config.secrets().VITE_API_URL = 'changed'
	expect(config.secret('VITE_API_URL')).toBe(values.VITE_API_URL)
})

test('reports missing keys without exposing configured values', () => {
	expect(() =>
		readPublicConfig(['URL', 'SITE_KEY'], { URL: 'public-value', SITE_KEY: '' })
	).toThrow('Missing required public configuration: SITE_KEY')
	expect(() => readPublicConfig(['constructor'], {})).toThrow('constructor')
})

test('requires explicit browser exposure for keys without a VITE_ prefix', () => {
	const config = readPublicConfig(['PUBLIC_URL'], {
		PUBLIC_URL: 'https://example.test'
	})

	expect(() => getViteDefine(config)).toThrow('VITE_')
	expect(getViteDefine(config, { publicKeys: ['PUBLIC_URL'] })).toEqual({
		'import.meta.env.PUBLIC_URL': '"https://example.test"'
	})
})

test('validates the same snapshot it returns when inputs are getters', () => {
	let reads = 0
	const config = readPublicConfig(['VITE_URL'], {
		get VITE_URL() {
			return ++reads === 1 ? 'https://example.test' : undefined
		}
	})

	expect(config.secret('VITE_URL')).toBe('https://example.test')
	expect(reads).toBe(1)
})
