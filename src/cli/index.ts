import { parseArgs } from 'node:util'
import type { z } from 'zod'
import {
	closest,
	type Field,
	fieldHelp,
	fieldLabel,
	fieldsOf,
	readFields,
	UsageError
} from './fields'

declare module 'zod' {
	interface GlobalMeta {
		/** hanzio/cli: read this key from positional arguments, in key order. */
		positional?: boolean
		/** hanzio/cli: one-letter short flag, e.g. `'r'` for `-r`. */
		alias?: string
		/** hanzio/cli: environment variable read when the flag is missing. */
		env?: string
	}
}

const commandKey: unique symbol = Symbol.for('hanzio/cli/command')

/**
 * An expected failure: the CLI prints the message without a stack trace and
 * exits with `exitCode` (default 1).
 */
export class CliError extends Error {
	readonly exitCode: number

	constructor(
		message: string,
		options?: { exitCode?: number; cause?: unknown }
	) {
		super(
			message,
			options?.cause === undefined ? undefined : { cause: options.cause }
		)
		this.name = 'CliError'
		this.exitCode = options?.exitCode ?? 1
	}
}

export type CliWriter = { write(text: string): unknown }

/** Where `cli.run()` writes and reads env fallbacks; defaults to `process`. */
export type CliIO = {
	stdout?: CliWriter
	stderr?: CliWriter
	env?: Record<string, string | undefined>
}

export type CommandContext<C = unknown> = {
	/** What `defineCli({ context })` returned. */
	readonly context: C
	/** The validated `defineCli({ globals })` values. */
	readonly globals: Record<string, unknown>
	/** Command names from the root, e.g. `['deal', 'list']`. */
	readonly path: readonly string[]
	/** Every argument after the command names, unparsed. */
	readonly argv: readonly string[]
	/** Arguments after `--`. */
	readonly passthrough: readonly string[]
	/** `--json` was passed (as a global or a command option). */
	readonly json: boolean
	readonly stdout: CliWriter
	readonly stderr: CliWriter
	readonly env: Record<string, string | undefined>
	/** Set to exit non-zero without printing an error. */
	exitCode: number
}

export type Command<C = unknown> = {
	readonly [commandKey]: true
	readonly description?: string
	readonly input?: AnyObject
	readonly raw?: boolean
	readonly run?: (input: never, ctx: CommandContext<C>) => unknown
	readonly output?: (result: never, ctx: CommandContext<C>) => unknown
	readonly load?: LazyCommand<C>
}

/** `() => import('./commands/heavy')`: loaded only when the command runs. */
export type LazyCommand<C = unknown> = () => Promise<
	Command<C> | { default: Command<C> }
>

export type CommandGroup<C = unknown> = {
	readonly [name: string]: CommandNode<C>
}

export type CommandNode<C = unknown> =
	| Command<C>
	| LazyCommand<C>
	| CommandGroup<C>

type AnyObject = z.ZodObject<z.core.$ZodShape, z.core.$ZodObjectConfig>
type EmptyObject = z.ZodObject<Record<never, never>>

export type Cli = {
	readonly name: string
	/** Runs the CLI and resolves to its exit code: 0 ok, 1 failure, 2 usage error. */
	run(argv?: readonly string[], io?: CliIO): Promise<number>
}

export type CliConfig<G extends AnyObject, C> = {
	name: string
	version?: string
	description?: string
	/** Options accepted before or after any command, e.g. `--org`. */
	globals?: G
	/** Runs before every command; throw a `CliError` to refuse it. */
	guard?: (call: {
		path: readonly string[]
		input: Record<string, unknown>
		globals: z.output<G>
		context: C
	}) => unknown
	/** A command (single-command CLI) or nested groups of commands. */
	commands: CommandNode<C>
} & (undefined extends C
	? { context?: ContextFunction<G, C> }
	: { context: ContextFunction<G, C> })

/** Builds the `ctx.context` every command receives. */
type ContextFunction<G extends AnyObject, C> = (
	globals: z.output<G>
) => C | Promise<C>

/**
 * A command. `input` is a Zod object whose keys become `--kebab-case` flags,
 * or positionals with `.meta({ positional: true })`. `run`'s return value is
 * printed by `output` (default: strings as-is, anything else as JSON).
 */
export function defineCommand<
	S extends AnyObject = EmptyObject,
	R = unknown,
	C = unknown
>(definition: {
	description?: string
	input?: S
	run: (input: z.output<S>, ctx: CommandContext<C>) => R
	output?: (result: Awaited<R>, ctx: CommandContext<C>) => unknown
}): Command<C>
/** A command that skips parsing: everything after its name is in `ctx.argv`. */
export function defineCommand<R = unknown, C = unknown>(definition: {
	description?: string
	raw: true
	run: (input: Record<string, never>, ctx: CommandContext<C>) => R
	output?: (result: Awaited<R>, ctx: CommandContext<C>) => unknown
}): Command<C>
/** A lazy command whose description shows in help before it loads. */
export function defineCommand<C = unknown>(definition: {
	description?: string
	load: LazyCommand<C>
}): Command<C>
export function defineCommand(definition: object): Command {
	return { ...definition, [commandKey]: true }
}

const isCommand = (node: unknown): node is Command =>
	typeof node === 'object' && node !== null && commandKey in node

async function loadCommand(node: Command | LazyCommand): Promise<Command> {
	if (typeof node !== 'function' && !node.load) return node
	const loaded = await (typeof node === 'function' ? node() : node.load?.())
	const command = isCommand(loaded) ? loaded : loaded?.default
	if (!isCommand(command))
		throw new Error(
			'hanzio/cli: a lazy command must resolve to defineCommand() or a module that default-exports one'
		)
	return loadCommand(command)
}

/** Leaf commands under a group, by path, without loading lazy ones. */
function listCommands(
	group: CommandGroup,
	prefix: string[] = []
): [string[], string | undefined][] {
	return Object.entries(group).flatMap(([name, node]) =>
		typeof node === 'function' || isCommand(node)
			? [
					[
						[...prefix, name],
						typeof node === 'function' ? undefined : node.description
					]
				]
			: listCommands(node, [...prefix, name])
	)
}

function table(rows: [string, string | undefined][]): string {
	const width = Math.max(...rows.map(([left]) => left.length))
	return rows
		.map(([left, right]) => `  ${left.padEnd(width)}  ${right ?? ''}`.trimEnd())
		.join('\n')
}

const optionRows = (fields: Field[]): [string, string][] =>
	fields.map((field) => [fieldLabel(field), fieldHelp(field)])

const helpRow: [string, string] = ['-h, --help', 'Show help']

export function defineCli<G extends AnyObject = EmptyObject, C = undefined>(
	config: CliConfig<G, C>
): Cli {
	// The context type only matters at the call site; internally any command runs.
	const root = config.commands as unknown as CommandNode
	const builtIn = (group: CommandGroup) =>
		group === root && !Object.hasOwn(group, 'completion')

	const versionRow: [string, string][] = config.version
		? [['--version', 'Show version']]
		: []

	function groupHelp(group: CommandGroup, path: string[], globals: Field[]) {
		const usage = [config.name, ...path].join(' ')
		const commands = listCommands(group).map(
			([names, description]): [string, string | undefined] => [
				names.join(' '),
				description
			]
		)
		if (builtIn(group))
			commands.push([
				'completion <bash|zsh>',
				'Print a shell completion script'
			])
		return [
			...(path.length
				? []
				: [
						[config.name, config.version].filter(Boolean).join(' '),
						...(config.description ? [config.description] : []),
						''
					]),
			`Usage: ${usage} <command> [options]`,
			'',
			'Commands:',
			table(commands),
			'',
			'Options:',
			table([
				...optionRows(globals),
				helpRow,
				...(path.length ? [] : versionRow)
			]),
			'',
			`Run "${usage} <command> --help" for a command's options.`
		].join('\n')
	}

	function commandHelp(
		command: Command,
		path: string[],
		fields: Field[],
		globals: Field[]
	) {
		const positionals = fields.filter((field) => field.positional)
		const options = fields.filter((field) => !field.positional)
		const sections = [
			`Usage: ${[config.name, ...path, ...positionals.map(fieldLabel)].join(' ')} [options]`
		]
		const description = command.description ?? config.description
		if (description) sections.push(description)
		if (positionals.length)
			sections.push(`Arguments:\n${table(optionRows(positionals))}`)
		sections.push(
			`Options:\n${table([
				...optionRows(options),
				helpRow,
				...(path.length ? [] : versionRow)
			])}`
		)
		if (globals.length)
			sections.push(`Global options:\n${table(optionRows(globals))}`)
		return sections.join('\n\n')
	}

	async function completion(shell: string, globals: Field[]) {
		const fn = `_${config.name.replace(/\W/g, '_')}_completion`
		const flags = (fields: Field[]) =>
			[...fields, ...globals]
				.filter((field) => !field.positional)
				.map((field) => `--${field.flag}`)
		const cases: [string, string[]][] = []
		const visit = async (node: CommandNode, path: string[]) => {
			if (typeof node === 'function' || isCommand(node)) {
				const command = await loadCommand(node)
				cases.push([
					path.join(' '),
					command.raw ? [] : [...flags(fieldsOf(command.input)), '--help']
				])
				return
			}
			for (const [name, child] of Object.entries(node))
				await visit(child, [...path, name])
			const names = Object.keys(node)
			if (builtIn(node)) names.push('completion')
			cases.push([path.join(' '), [...names, ...flags([]), '--help']])
		}
		await visit(root, [])
		cases.sort(([a], [b]) => b.length - a.length)
		const branches = cases.map(([path, words]) =>
			path
				? `\t\t"${path}"|"${path} "*) opts="${words.join(' ')}" ;;`
				: `\t\t*) opts="${words.join(' ')}" ;;`
		)
		const script = `${fn}() {
	local cur="\${COMP_WORDS[COMP_CWORD]}" words="" word opts
	for word in "\${COMP_WORDS[@]:1:COMP_CWORD-1}"; do
		[[ $word == -* ]] || words="$words $word"
	done
	case "\${words# }" in
${branches.join('\n')}
	esac
	COMPREPLY=($(compgen -W "$opts" -- "$cur"))
}
complete -F ${fn} ${config.name}
`
		if (shell === 'bash') return script
		if (shell === 'zsh')
			return `autoload -U +X bashcompinit && bashcompinit\n${script}`
		throw new UsageError(`Unknown shell "${shell}": use bash or zsh`)
	}

	return {
		name: config.name,
		async run(argv = process.argv.slice(2), io = {}) {
			const stdout = io.stdout ?? process.stdout
			const stderr = io.stderr ?? process.stderr
			const env = io.env ?? process.env
			let usage = config.name
			let json = false
			try {
				const globalFields = fieldsOf(config.globals)
				const positional = globalFields.find((field) => field.positional)
				if (positional)
					throw new Error(
						`hanzio/cli: global "${positional.key}" can't be positional`
					)
				const valueFlags = new Set(
					globalFields
						.filter((field) => field.kind !== 'boolean')
						.flatMap((field) => [
							`--${field.flag}`,
							...(field.alias ? [`-${field.alias}`] : [])
						])
				)
				const isHelp = (token: string) => token === '--help' || token === '-h'

				// Walk the command names; options before and between them are globals.
				let node: CommandNode = root
				const path: string[] = []
				const pre: string[] = []
				let index = 0
				while (typeof node !== 'function' && !isCommand(node)) {
					const group: CommandGroup = node
					const token = argv[index]
					if (token === undefined || token === '--') {
						if (pre.some(isHelp)) {
							stdout.write(`${groupHelp(group, path, globalFields)}\n`)
							return 0
						}
						if (!path.length && config.version && pre.includes('--version')) {
							stdout.write(`${config.version}\n`)
							return 0
						}
						throw new UsageError(
							`${path.length ? `${usage}: missing` : 'Missing'} command\n\n${groupHelp(group, path, globalFields)}`
						)
					}
					index++
					if (token.startsWith('-') && token !== '-') {
						pre.push(token)
						if (valueFlags.has(token) && argv[index] !== undefined)
							pre.push(argv[index++] as string)
						continue
					}
					if (token === 'completion' && builtIn(group)) {
						const [shell = 'bash'] = argv.slice(index)
						stdout.write(await completion(shell, globalFields))
						return 0
					}
					const child = Object.hasOwn(group, token) ? group[token] : undefined
					if (!child) {
						const names = Object.keys(group)
						if (builtIn(group)) names.push('completion')
						const guess = closest(token, names)
						throw new UsageError(
							`Unknown command "${[...path, token].join(' ')}".${guess ? ` Did you mean "${[...path, guess].join(' ')}"?` : ` Commands: ${names.join(', ')}`}`
						)
					}
					node = child
					path.push(token)
					usage = `${usage} ${token}`
				}

				const command = await loadCommand(node)
				const rest = argv.slice(index)
				const fields = command.raw ? [] : fieldsOf(command.input)
				const dash = rest.indexOf('--')
				const tokens = command.raw
					? pre
					: [...pre, ...(dash < 0 ? rest : rest.slice(0, dash))]
				if (!command.raw && tokens.some(isHelp)) {
					stdout.write(`${commandHelp(command, path, fields, globalFields)}\n`)
					return 0
				}
				if (!path.length && config.version && tokens.includes('--version')) {
					stdout.write(`${config.version}\n`)
					return 0
				}

				const options: Record<
					string,
					{ type: 'string' | 'boolean'; multiple: boolean; short?: string }
				> = {}
				for (const field of [...globalFields, ...fields]) {
					if (field.positional) continue
					if (field.flag === 'help' || Object.hasOwn(options, field.flag))
						throw new Error(`hanzio/cli: --${field.flag} is declared twice`)
					options[field.flag] = {
						type: field.kind === 'boolean' ? 'boolean' : 'string',
						multiple: field.multiple,
						...(field.alias ? { short: field.alias } : {})
					}
				}
				let parsed: ReturnType<typeof parseArgs>
				try {
					parsed = parseArgs({
						args: tokens,
						options,
						allowPositionals: true,
						allowNegative: true,
						strict: true
					})
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					const unknown = /^Unknown option '(-[^']*)'/.exec(message)?.[1]
					if (!unknown) throw new UsageError(message.split('. ')[0] ?? message)
					const guess = closest(
						unknown.replace(/^--?/, ''),
						Object.keys(options)
					)
					throw new UsageError(
						`Unknown option ${unknown}.${guess ? ` Did you mean --${guess}?` : ''}`
					)
				}

				const issues: string[] = []
				const validate = async (
					schema: AnyObject | undefined,
					fields: Field[],
					positionals: string[]
				) => {
					const raw = readFields(fields, parsed.values, positionals, env)
					if (!schema) return raw
					const result = await schema.safeParseAsync(raw)
					if (result.success) return result.data as Record<string, unknown>
					for (const issue of result.error.issues) {
						const field = fields.find((field) => field.key === issue.path[0])
						const label = field
							? field.positional
								? `<${field.flag}>`
								: `--${field.flag}`
							: issue.path.join('.')
						issues.push(label ? `${label}: ${issue.message}` : issue.message)
					}
					return raw
				}
				const globals = await validate(config.globals, globalFields, [])
				const input = await validate(
					command.raw ? undefined : command.input,
					fields,
					parsed.positionals
				)
				if (issues.length) throw new UsageError(issues.join('\n'))
				json = input.json === true || globals.json === true

				const context = (await config.context?.(globals as z.output<G>)) as C
				await config.guard?.({
					path,
					input,
					globals: globals as z.output<G>,
					context
				})
				const ctx: CommandContext = {
					context,
					globals,
					path,
					argv: rest,
					passthrough: dash < 0 ? [] : rest.slice(dash + 1),
					json,
					stdout,
					stderr,
					env,
					exitCode: 0
				}
				const run = command.run as (input: unknown, ctx: unknown) => unknown
				const result = await run(input, ctx)
				const output =
					(command.output as
						| ((result: unknown, ctx: unknown) => unknown)
						| undefined) ?? printResult
				await output(result, ctx)
				return ctx.exitCode
			} catch (error) {
				if (error instanceof UsageError) {
					stderr.write(`${error.message}\nRun "${usage} --help" for usage.\n`)
					return 2
				}
				const message = error instanceof Error ? error.message : String(error)
				if (json) stderr.write(`${JSON.stringify({ error: message })}\n`)
				else
					stderr.write(
						`${error instanceof Error && !(error instanceof CliError) ? (error.stack ?? message) : message}\n`
					)
				return error instanceof CliError ? error.exitCode : 1
			}
		}
	}
}

/** The default `output`: nothing for `undefined`, strings as-is, JSON otherwise. */
function printResult(result: unknown, ctx: CommandContext<unknown>) {
	if (result === undefined) return
	ctx.stdout.write(
		`${ctx.json ? JSON.stringify(result) : typeof result === 'string' ? result : JSON.stringify(result, null, 2)}\n`
	)
}
