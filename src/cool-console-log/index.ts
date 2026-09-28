// ═══════════════════════════════════════════════════════════════════════════
// Cool Console Log - Colorful Terminal Logging Utility
// ═══════════════════════════════════════════════════════════════════════════

/** ANSI color codes for terminal output */
export const terminalColors = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	dim: '\x1b[2m',
	italic: '\x1b[3m',
	underline: '\x1b[4m',
	// Foreground colors
	black: '\x1b[30m',
	red: '\x1b[31m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	blue: '\x1b[34m',
	magenta: '\x1b[35m',
	cyan: '\x1b[36m',
	white: '\x1b[37m',
	gray: '\x1b[90m',
	// Bright variants
	brightRed: '\x1b[91m',
	brightGreen: '\x1b[92m',
	brightYellow: '\x1b[93m',
	brightBlue: '\x1b[94m',
	brightMagenta: '\x1b[95m',
	brightCyan: '\x1b[96m',
	brightWhite: '\x1b[97m',
	// Background colors
	bgBlack: '\x1b[40m',
	bgRed: '\x1b[41m',
	bgGreen: '\x1b[42m',
	bgYellow: '\x1b[43m',
	bgBlue: '\x1b[44m',
	bgMagenta: '\x1b[45m',
	bgCyan: '\x1b[46m',
	bgWhite: '\x1b[47m'
} as const

export type TerminalColor = keyof typeof terminalColors

const noColors = Object.fromEntries(
	Object.keys(terminalColors).map((key) => [key, ''])
) as unknown as typeof terminalColors

function getProcessEnvironment():
	| Record<string, string | undefined>
	| undefined {
	return typeof process === 'undefined' ? undefined : process.env
}

function isDev(): boolean {
	return getProcessEnvironment()?.NODE_ENV !== 'production'
}

/**
 * Whether stdout should get ANSI colors: `NO_COLOR` disables, `FORCE_COLOR`
 * (other than `'0'`) enables, otherwise only when stdout is a TTY.
 * Always false where `process` doesn't exist (browsers, Workers).
 */
export function supportsColor(): boolean {
	const env = getProcessEnvironment()
	if (!env || env.NO_COLOR) return false
	if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0') return true
	return process.stdout?.isTTY === true
}

/** Log levels supported by the logger */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const levelRank: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3
}

/** Attributes that can be passed to log methods. Objects are rendered as compact JSON. */
export type LogAttributes = Record<string, unknown>

/** Log method signature */
export type LogMethod = (message: string, attributes?: LogAttributes) => void

/** Logger interface with colored output */
export type CoolLogger = {
	debug: LogMethod
	info: LogMethod
	warn: LogMethod
	error: LogMethod
	/** Returns a logger that adds `attributes` to every entry (call-site attributes win). */
	child: (attributes: LogAttributes) => CoolLogger
}

/** Color config per log level */
const levelColors: Record<LogLevel, { badge: string; text: string }> = {
	debug: { badge: terminalColors.gray, text: terminalColors.dim },
	info: { badge: terminalColors.cyan, text: terminalColors.reset },
	warn: { badge: terminalColors.yellow, text: terminalColors.yellow },
	error: { badge: terminalColors.red, text: terminalColors.brightRed }
}

function formatValue(value: unknown): string {
	if (value instanceof Error) return String(value)
	if (typeof value !== 'object' || value === null) return String(value)
	try {
		return JSON.stringify(value)
	} catch (_error) {
		return '[Unserializable]'
	}
}

/** Format attributes as a compact colored string */
function formatAttributes(attrs?: LogAttributes): string {
	if (!attrs || Object.keys(attrs).length === 0) return ''
	const formatted = Object.entries(attrs)
		.map(
			([k, v]) =>
				`${terminalColors.dim}${k}=${terminalColors.reset}${formatValue(v)}`
		)
		.join(' ')
	return ` ${formatted}`
}

/**
 * Options for creating a cool logger
 */
export type CoolLoggerOptions = {
	/** Only use colors in development (default: true). Colors also require `supportsColor()`. */
	colorsInDevOnly?: boolean
	/** Lowest level that is printed (default: 'debug' in dev, 'info' in production) */
	minLevel?: LogLevel
	/** Callback for each log entry, before level filtering (e.g., to add to OpenTelemetry span) */
	onLog?: (level: LogLevel, message: string, attributes?: LogAttributes) => void
}

/**
 * Creates a logger with colorful console output.
 *
 * @example
 * ```ts
 * const logger = createCoolLogger()
 * logger.info('User logged in', { userId: '123' })
 * logger.warn('Rate limit approaching', { remaining: 10 })
 * logger.error('Payment failed', { reason: 'insufficient_funds' })
 * const requestLog = logger.child({ requestId: 'abc' })
 * ```
 */
export function createCoolLogger(options: CoolLoggerOptions = {}): CoolLogger {
	const dev = isDev()
	const {
		colorsInDevOnly = true,
		minLevel = dev ? 'debug' : 'info',
		onLog
	} = options
	const useColors = supportsColor() && (!colorsInDevOnly || dev)

	const createLogger = (base?: LogAttributes): CoolLogger => {
		const createLogMethod =
			(level: LogLevel): LogMethod =>
			(message, callAttributes) => {
				const attributes =
					base && callAttributes
						? { ...base, ...callAttributes }
						: (callAttributes ?? base)

				onLog?.(level, message, attributes)

				if (levelRank[level] < levelRank[minLevel]) return

				if (useColors) {
					const { badge, text } = levelColors[level]
					const label = level.toUpperCase().padEnd(5)
					const attrStr = formatAttributes(attributes)
					console.log(
						`${badge}[${label}]${terminalColors.reset} ${text}${message}${terminalColors.reset}${attrStr}`
					)
				} else {
					console[level](`[${level.toUpperCase()}]`, message, attributes ?? '')
				}
			}

		return {
			debug: createLogMethod('debug'),
			info: createLogMethod('info'),
			warn: createLogMethod('warn'),
			error: createLogMethod('error'),
			child: (attributes) => createLogger({ ...base, ...attributes })
		}
	}

	return createLogger()
}

/**
 * Logs a request/operation summary with colored status and duration.
 * Shows: `operationName ✓ · 12.3ms` (green) or `operationName ✗ · 45.2ms` (red)
 *
 * @example
 * ```ts
 * const start = performance.now()
 * try {
 *   await doSomething()
 *   logOperationSummary('user.create', performance.now() - start, true)
 * } catch {
 *   logOperationSummary('user.create', performance.now() - start, false)
 * }
 * ```
 */
export function logOperationSummary(
	operationName: string,
	durationMs: number,
	success: boolean,
	options: { devOnly?: boolean; error?: Error | unknown } = {}
): void {
	const { devOnly = true, error } = options

	if (devOnly && !isDev()) return

	const c = supportsColor() ? terminalColors : noColors
	const statusIcon = success
		? `${c.brightGreen}✓${c.reset}`
		: `${c.brightRed}✗${c.reset}`
	const statusColor = success ? c.green : c.red
	const durationStr = `${c.dim}${durationMs.toFixed(1)}ms${c.reset}`

	const errorMessage = error
		? ` ${c.dim}·${c.reset} ${c.red}${error instanceof Error ? error.message : String(error)}${c.reset}`
		: ''

	console.log(
		`${statusColor}${c.bold}${operationName}${c.reset} ${statusIcon} ${c.dim}·${c.reset} ${durationStr}${errorMessage}`
	)
}

/**
 * Starts timing an operation. Call the returned `done` to log it via `logOperationSummary`.
 *
 * @example
 * ```ts
 * const done = startOperation('user.create')
 * try {
 *   await doSomething()
 *   done()
 * } catch (error) {
 *   done(false, error)
 * }
 * ```
 */
export function startOperation(
	operationName: string,
	options: { devOnly?: boolean } = {}
): (success?: boolean, error?: unknown) => void {
	const start = performance.now()
	return (success = true, error) =>
		logOperationSummary(operationName, performance.now() - start, success, {
			...options,
			error
		})
}

/**
 * Helper to colorize text for console output. Returns `text` unchanged in
 * production or when colors aren't supported (see `supportsColor`).
 *
 * @example
 * ```ts
 * console.log(colorize('Success!', 'green', 'bold'))
 * console.log(colorize('Warning', 'yellow'))
 * ```
 */
export function colorize(
	text: string,
	color: TerminalColor,
	...modifiers: TerminalColor[]
): string {
	if (!isDev() || !supportsColor()) return text

	const colorCodes = [
		terminalColors[color],
		...modifiers.map((m) => terminalColors[m])
	].join('')
	return `${colorCodes}${text}${terminalColors.reset}`
}

/**
 * Log a styled box/banner to the console (dev only)
 *
 * @example
 * ```ts
 * logBanner('Server Started', 'green')
 * logBanner('⚠️  Warning', 'yellow')
 * ```
 */
export function logBanner(
	text: string,
	color: TerminalColor = 'cyan',
	options: { devOnly?: boolean } = {}
): void {
	const { devOnly = true } = options

	if ((devOnly && !isDev()) || !supportsColor()) {
		console.log(`=== ${text} ===`)
		return
	}

	const c = terminalColors
	const padding = 2
	const line = '═'.repeat(text.length + padding * 2)

	console.log(`${c[color]}╔${line}╗${c.reset}`)
	console.log(
		`${c[color]}║${' '.repeat(padding)}${c.bold}${text}${c.reset}${c[color]}${' '.repeat(padding)}║${c.reset}`
	)
	console.log(`${c[color]}╚${line}╝${c.reset}`)
}
