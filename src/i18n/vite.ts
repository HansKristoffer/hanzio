import type { Plugin } from 'vite'

const INTLIFY_VIRTUAL_PREFIX = 'virtual:intlify-i18n-'

/**
 * Dev-server plugin: reload the page with fresh catalogs when a
 * `locales/*.json` file changes.
 *
 * `@intlify/unplugin-vue-i18n` serves each catalog as a `virtual:intlify-i18n-N`
 * module that the module graph cannot tie back to its JSON file, and its own
 * hot update only invalidates its bundle module, so an edited key kept serving
 * the old catalog until the dev server restarted. This invalidates every
 * catalog module and reloads: `createI18n` reads messages once at startup, so a
 * hot swap would not reach the running instance anyway.
 */
export function localeCatalogReloadPlugin(
	options: {
		/** Which changed files are catalogs. Default: `.json` in a `locales` folder. */
		match?: RegExp
	} = {}
): Plugin {
	const match = options.match ?? /[/\\]locales[/\\][^/\\]+\.json$/
	return {
		name: 'hanzio-locale-catalog-reload',
		apply: 'serve',
		hotUpdate({ file }) {
			if (this.environment.name !== 'client') return
			if (!match.test(file)) return

			const graph = this.environment.moduleGraph
			for (const [id, module] of graph.idToModuleMap) {
				if (id.startsWith(INTLIFY_VIRTUAL_PREFIX))
					graph.invalidateModule(module)
			}

			this.environment.hot.send({ type: 'full-reload' })
			return []
		}
	}
}
