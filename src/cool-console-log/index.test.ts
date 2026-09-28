import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
	type CoolLogger,
	colorize,
	createCoolLogger,
	logBanner,
	logOperationSummary,
	startOperation,
	supportsColor
} from '.'

const ENV_KEYS = ['NODE_ENV', 'NO_COLOR', 'FORCE_COLOR'] as const
const ESC = '\x1b['
let savedEnv: Record<string, string | undefined>
let spies: ReturnType<typeof spyOn>[]

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
	for (const key of ENV_KEYS) {
		const value = values[key]
		if (value === undefined) delete process.env[key]
		else process.env[key] = value
	}
}

beforeEach(() => {
	savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
	spies = (['log', 'debug', 'info', 'warn', 'error'] as const).map((method) =>
		spyOn(console, method).mockImplementation(() => {})
	)
})

afterEach(() => {
	for (const spy of spies) spy.mockRestore()
	setEnv(savedEnv)
})

const logged = (
	method: 'log' | 'debug' | 'info' | 'warn' | 'error'
): unknown[][] =>
	(console[method] as unknown as ReturnType<typeof spyOn>).mock.calls

describe('supportsColor', () => {
	test('NO_COLOR disables, FORCE_COLOR enables', () => {
		setEnv({ NO_COLOR: '1', FORCE_COLOR: '1' })
		expect(supportsColor()).toBe(false)
		setEnv({ FORCE_COLOR: '1' })
		expect(supportsColor()).toBe(true)
		setEnv({ FORCE_COLOR: '0' })
		expect(supportsColor()).toBe(process.stdout.isTTY === true)
	})

	test('does not throw without process', () => {
		const saved = globalThis.process
		// biome-ignore lint/suspicious/noExplicitAny: simulate a browser/Worker global
		;(globalThis as any).process = undefined
		try {
			expect(supportsColor()).toBe(false)
			expect(colorize('x', 'red')).toBe('x')
			createCoolLogger().debug('hi')
		} finally {
			globalThis.process = saved
		}
		expect(logged('debug')).toEqual([['[DEBUG]', 'hi', '']])
	})
})

describe('createCoolLogger', () => {
	test('plain output uses console[level] when colors are off', () => {
		setEnv({ NO_COLOR: '1' })
		createCoolLogger().warn('careful', { n: 1 })
		expect(logged('warn')).toEqual([['[WARN]', 'careful', { n: 1 }]])
	})

	test('colored output renders attributes compactly', () => {
		setEnv({ FORCE_COLOR: '1' })
		const circular: Record<string, unknown> = {}
		circular.self = circular
		createCoolLogger().info('hello', {
			user: { id: 1 },
			err: new Error('boom'),
			circular
		})

		const line = logged('log')[0]?.[0] as string
		expect(line).toContain(ESC)
		expect(line).toContain('{"id":1}')
		expect(line).toContain('Error: boom')
		expect(line).toContain('[Unserializable]')
	})

	test('minLevel defaults to info in production and is configurable', () => {
		setEnv({ NODE_ENV: 'production', NO_COLOR: '1' })
		const onLog: unknown[] = []
		const logger = createCoolLogger({ onLog: (level) => onLog.push(level) })
		logger.debug('hidden')
		logger.info('shown')
		expect(logged('debug')).toHaveLength(0)
		expect(logged('info')).toHaveLength(1)
		expect(onLog).toEqual(['debug', 'info'])

		setEnv({ NO_COLOR: '1' })
		createCoolLogger({ minLevel: 'error' }).warn('hidden')
		expect(logged('warn')).toHaveLength(0)
	})

	test('child merges attributes; call-site wins', () => {
		setEnv({ NO_COLOR: '1' })
		const child = createCoolLogger()
			.child({ requestId: 'r1', a: 1 })
			.child({ b: 2 })
		child.error('failed', { a: 3 })
		child.error('plain')
		expect(logged('error')).toEqual([
			['[ERROR]', 'failed', { requestId: 'r1', a: 3, b: 2 }],
			['[ERROR]', 'plain', { requestId: 'r1', a: 1, b: 2 }]
		])
	})

	test('is assignable to the api-wrapper logger option', () => {
		const logger: Pick<Console, 'debug' | 'error'> = createCoolLogger()
		const coolLogger: CoolLogger = createCoolLogger()
		expect(logger).toBeDefined()
		expect(coolLogger).toBeDefined()
	})
})

describe('operation helpers', () => {
	test('startOperation logs duration and error', () => {
		setEnv({ NO_COLOR: '1' })
		startOperation('user.create')()
		startOperation('user.delete')(false, new Error('nope'))
		const [ok, failed] = logged('log').map((call) => call[0] as string)
		expect(ok).toMatch(/^user\.create ✓ · \d+\.\dms$/)
		expect(failed).toMatch(/^user\.delete ✗ · \d+\.\dms · nope$/)
	})

	test('logOperationSummary is silent in production by default', () => {
		setEnv({ NODE_ENV: 'production' })
		logOperationSummary('op', 1, true)
		expect(logged('log')).toHaveLength(0)
	})

	test('colorize and logBanner fall back to plain text without color support', () => {
		setEnv({ NO_COLOR: '1' })
		expect(colorize('x', 'red', 'bold')).toBe('x')
		logBanner('Hi')
		expect(logged('log')).toEqual([['=== Hi ===']])

		setEnv({ FORCE_COLOR: '1' })
		expect(colorize('x', 'red')).toBe(`${ESC}31mx${ESC}0m`)
	})
})
