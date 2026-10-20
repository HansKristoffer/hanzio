/** A complete in-memory `Storage` (`localStorage` / `sessionStorage`). */
export function createTestStorage(): Storage {
	const store = new Map<string, string>()
	return {
		get length() {
			return store.size
		},
		clear: () => store.clear(),
		getItem: (key) => store.get(key) ?? null,
		key: (index) => [...store.keys()][index] ?? null,
		removeItem: (key) => {
			store.delete(key)
		},
		setItem: (key, value) => {
			store.set(key, String(value))
		}
	}
}

type ShimLocation = Pick<
	URL,
	| 'href'
	| 'origin'
	| 'protocol'
	| 'host'
	| 'hostname'
	| 'port'
	| 'pathname'
	| 'search'
	| 'hash'
>

type ShimWindow = {
	location: ShimLocation
	addEventListener: (...args: unknown[]) => void
	removeEventListener: (...args: unknown[]) => void
	localStorage: Storage
}

const noop = () => {}

function locationOf(href: string): ShimLocation {
	const { origin, protocol, host, hostname, port, pathname, search, hash } =
		new URL(href)
	return {
		href,
		origin,
		protocol,
		host,
		hostname,
		port,
		pathname,
		search,
		hash
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

/**
 * Installs a minimal `globalThis.window` for unit tests of browser-facing code
 * that only probes `window` (`location`, `localStorage`, event listeners), and
 * returns a `reset` to call in `afterEach`.
 *
 * Tests may assign a partial `window`. The shim keeps its own shape and copies
 * `location`, `localStorage` and the listener functions from the assigned
 * object, because libraries such as axios and PostHog read those at import
 * time. It installs no `document`: Vue and PrismJS treat one as a full DOM.
 *
 * @example
 * // test-setup.ts, preloaded through bunfig.toml
 * const resetWindow = installWindowShim()
 * afterEach(resetWindow)
 */
export function installWindowShim(href = 'http://localhost/'): () => void {
	const shim: ShimWindow = {
		location: locationOf(href),
		addEventListener: noop,
		removeEventListener: noop,
		localStorage: createTestStorage()
	}

	const assign = (value: unknown) => {
		if (!isObject(value)) return
		if (value.localStorage) shim.localStorage = value.localStorage as Storage
		shim.location =
			isObject(value.location) && typeof value.location.href === 'string'
				? (value.location as ShimLocation)
				: locationOf(href)
		shim.addEventListener =
			typeof value.addEventListener === 'function'
				? (value.addEventListener as ShimWindow['addEventListener'])
				: noop
		shim.removeEventListener =
			typeof value.removeEventListener === 'function'
				? (value.removeEventListener as ShimWindow['removeEventListener'])
				: noop
	}

	const install = () => {
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			enumerable: true,
			get: () => shim,
			set: assign
		})
	}

	install()
	return () => {
		shim.location = locationOf(href)
		shim.addEventListener = noop
		shim.removeEventListener = noop
		shim.localStorage = createTestStorage()
		install()
	}
}
