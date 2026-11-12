import { expect, test } from 'bun:test'
import { localeCatalogReloadPlugin } from './vite'

/** Whether the plugin reloads the page when `file` changes. */
function reloads(file: string) {
	const sent: unknown[] = []
	const context = {
		environment: {
			name: 'client',
			moduleGraph: { idToModuleMap: new Map<string, never>() },
			hot: { send: (payload: unknown) => sent.push(payload) }
		}
	}
	const hotUpdate = localeCatalogReloadPlugin().hotUpdate
	if (typeof hotUpdate !== 'function') throw new Error('expected a hook')
	// Only the fields the plugin reads.
	hotUpdate.call(context as never, { file } as never)
	return sent.length > 0
}

test('the default match covers catalogs at any depth below locales', () => {
	expect(reloads('/app/src/locales/en.json')).toBe(true)
	expect(reloads('/app/src/locales/en/settings.json')).toBe(true)
	expect(reloads('C:\\app\\src\\locales\\en\\vault-io.json')).toBe(true)
	expect(reloads('/app/src/locales/en/index.ts')).toBe(false)
	expect(reloads('/app/src/locales.json')).toBe(false)
	expect(reloads('/app/src/config/en.json')).toBe(false)
})
