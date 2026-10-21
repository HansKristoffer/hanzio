import { isAbsolute } from 'node:path'

type ModuleExports = Record<string, unknown>

/**
 * Package names resolve from `baseDir`, so a mock targets the copy your code
 * imports even under isolated installs; anything else is a path relative to it.
 */
function resolveFrom(baseDir: string) {
	return (specifier: string) => {
		if (isAbsolute(specifier)) return specifier
		if (specifier.startsWith('.')) return Bun.resolveSync(specifier, baseDir)
		try {
			return Bun.resolveSync(specifier, baseDir)
		} catch (error) {
			try {
				return Bun.resolveSync(`./${specifier}`, baseDir)
			} catch {
				throw error
			}
		}
	}
}

/**
 * `mock.module` that can be undone. Bun replaces a mocked module for the whole
 * process and `mock.restore()` does not bring it back
 * (https://github.com/oven-sh/bun/issues/7823), so one suite's stub silently
 * leaks into every later suite.
 *
 * Mocks spread the module's real exports first, so exports you don't override
 * keep working, and `clear()` re-registers the originals. Call it in
 * `afterEach` or `afterAll`.
 *
 * Without an argument, pass absolute paths. Pass your source root to resolve
 * against it: package names from there (so mocks hit the same copy your code
 * imports), and `./lib/x` or `lib/x` relative to it. A function maps your own
 * shorthand, such as an `@/` alias, to absolute paths instead.
 *
 * @example
 * const moduleMocker = new ModuleMocker(srcDir)
 * await moduleMocker.mock('lib/posthog.ts', () => ({ captureException: mock() }))
 * await moduleMocker.mock('ai', () => ({ generateText: mock() }))
 * afterAll(() => moduleMocker.clear())
 */
export class ModuleMocker {
	private restorers: (() => void)[] = []

	private readonly resolve: (specifier: string) => string

	constructor(
		baseDirOrResolve: string | ((specifier: string) => string) = (specifier) =>
			specifier
	) {
		this.resolve =
			typeof baseDirOrResolve === 'string'
				? resolveFrom(baseDirOrResolve)
				: baseDirOrResolve
	}

	async mock(
		specifier: string,
		renderMocks: () => ModuleExports
	): Promise<void> {
		const { mock } = await import('bun:test')
		const resolved = this.resolve(specifier)
		const original = { ...(await import(resolved)) } as ModuleExports
		const merged = { ...original, ...renderMocks() }
		mock.module(resolved, () => merged)
		this.restorers.push(() => {
			mock.module(resolved, () => original)
		})
	}

	clear(): void {
		// Newest first, so a module mocked twice ends on its real exports.
		for (const restore of this.restorers.toReversed()) restore()
		this.restorers = []
	}
}
