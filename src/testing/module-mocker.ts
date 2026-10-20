type ModuleExports = Record<string, unknown>

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
 * Bun resolves specifiers relative to the file that registers the mock, so
 * pass absolute paths or package names. A `resolve` function maps your own
 * shorthand (an `@/` alias, a source-root-relative path) to absolute paths.
 *
 * @example
 * const moduleMocker = new ModuleMocker((specifier) =>
 *   specifier.startsWith('@/') ? path.resolve(srcDir, specifier.slice(2)) : specifier
 * )
 * await moduleMocker.mock('@/lib/posthog', () => ({ captureException: mock() }))
 * afterAll(() => moduleMocker.clear())
 */
export class ModuleMocker {
	private restorers: (() => void)[] = []

	constructor(
		private readonly resolve: (specifier: string) => string = (specifier) =>
			specifier
	) {}

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
		for (const restore of this.restorers) restore()
		this.restorers = []
	}
}
