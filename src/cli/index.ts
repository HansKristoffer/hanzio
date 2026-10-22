import { parseArgs } from 'node:util'
import type { z } from 'zod'
import {
	closest,
	type Field,
	fieldHelp,
	fieldLabel,
	fieldsOf,
	optionName,
	readFields,
	UsageError
} from './fields.js'

declare module 'zod' {
	interface GlobalMeta {
		/** hanzio/cli: read this key from positional arguments, in key order. */
		positional?: boolean
		/**
		 * hanzio/cli: other names for the flag: one letter for `-r`, longer for
		 * `--region-name`.
		 */
		alias?: string | readonly string[]
		/**
		 * hanzio/cli: environment variables read in order when the flag is
		 * missing. Blank values count as unset.
		 */
		env?: string | readonly string[]
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

/**
 * Bad arguments, passed to `defineCli({ onError })`. `help` is the help of
 * the group or command the arguments were for, ending in a newline.
 */
export class CliUsageError extends CliError {
	readonly kind: 'missing-command' | 'unknown-command' | 'invalid-arguments'
	readonly path: readonly string[]
	readonly help: string

	constructor(
		message: string,
		details: Pick<CliUsageError, 'kind' | 'path' | 'help'>
	) {
		super(message, { exitCode: 2 })
		this.name = 'CliUsageError'
		this.kind = details.kind
		this.path = details.path
		this.help = details.help
	}
}

/** What `defineCli({ onError })` gets besides the error. */
export type CliErrorIO = {
	readonly stdout: CliWriter
	readonly stderr: CliWriter
	readonly env: Record<string, string | undefined>
	readonly json: boolean
	/** Prints the error the default way and returns its exit code. */
	print(): number
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
	readonly usage?: string
	readonly examples?: readonly string[]
	readonly input?: AnyObject
	readonly raw?: boolean
	readonly strict?: boolean
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
	/**
	 * The root command to run when no command name is given, or when the first
	 * argument is a flag that isn't a global. A function reads it from `env`.
	 */
	defaultCommand?:
		| string
		| ((env: Record<string, string | undefined>) => string | undefined)
	/** Resolves a command name the group doesn't have, e.g. from config. */
	unknownCommand?: (
		name: string,
		path: readonly string[]
	) => CommandNode<C> | undefined | Promise<CommandNode<C> | undefined>
	/** Rewrites a help screen; `path` is `[]` for the root. */
	help?: (
		text: string,
		info: { path: readonly string[] }
	) => string | Promise<string>
	/**
	 * Handles every error, usage errors included (`CliUsageError`). Return the
	 * exit code, or `undefined` for `io.print()`.
	 */
	onError?: (
		error: unknown,
		io: CliErrorIO
	) => number | undefined | Promise<number | undefined>
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
	/** The first line is the summary in command lists; help shows it all. */
	description?: string
	/** Replaces the generated arguments in usage lines, e.g. `'[name...] [--all]'`. */
	usage?: string
	/** Command lines shown under "Examples:" in the command's help. */
	examples?: readonly string[]
	input?: S
	/** `false` ignores unknown flags and extra positionals. */
	strict?: boolean
	run: (input: z.output<S>, ctx: CommandContext<C>) => R
	output?: (result: Awaited<R>, ctx: CommandContext<C>) => unknown
}): Command<C>
/** A command that skips parsing: everything after its name is in `ctx.argv`. */
export function defineCommand<R = unknown, C = unknown>(definition: {
	description?: string
	usage?: string
	raw: true
	run: (input: Record<string, never>, ctx: CommandContext<C>) => R
	output?: (result: Awaited<R>, ctx: CommandContext<C>) => unknown
}): Command<C>
/** A lazy command whose description shows in help before it loads. */
export function defineCommand<C = unknown>(definition: {
	description?: string
	usage?: string
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

/** Leaf commands under a group as help rows, without loading lazy ones. */
function listCommands(
	group: CommandGroup,
	prefix: string[] = []
): [string, string | undefined][] {
	return Object.entries(group).flatMap(([name, node]) => {
		if (typeof node !== 'function' && !isCommand(node))
			return listCommands(node, [...prefix, name])
		const command = typeof node === 'function' ? undefined : node
		const names = [...prefix, name, command?.usage].filter(Boolean).join(' ')
		return [[names, command?.description?.split('\n')[0]]]
	})
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
	const unknownCommand = config.unknownCommand as
		| ((name: string, path: readonly string[]) => unknown)
		| undefined
	const builtIn = (group: CommandGroup) =>
		group === root && !Object.hasOwn(group, 'completion')

	const versionRow: [string, string][] = config.version
		? [['--version', 'Show version']]
		: []
	const section = (title: string, fields: Field[]) =>
		fields.length ? [`${title}:\n${table(optionRows(fields))}`] : []
	const positionalsOf = (fields: Field[]) =>
		fields.filter((field) => field.positional)
	const optionsOf = (fields: Field[]) =>
		fields.filter((field) => !field.positional)

	function groupHelp(group: CommandGroup, path: string[], globals: Field[]) {
		const usage = [
			config.name,
			...positionalsOf(globals).map(fieldLabel),
			...path
		].join(' ')
		const commands = listCommands(group)
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
			...section('\nArguments', positionalsOf(globals)),
			'',
			'Commands:',
			table(commands),
			'',
			'Options:',
			table([
				...optionRows(optionsOf(globals)),
				helpRow,
				...(path.length ? [] : versionRow)
			]),
			'',
			`Run "${usage} <command> --help" for a command's options.`
		].join('\n')
	}

	function commandHelp(command: Command, path: string[], globals: Field[]) {
		const fields = command.raw ? [] : fieldsOf(command.input)
		const positionals = [...positionalsOf(globals), ...positionalsOf(fields)]
		const usage = [
			config.name,
			...positionalsOf(globals).map(fieldLabel),
			...path,
			command.usage ?? [...positionalsOf(fields).map(fieldLabel), '[options]']
		]
		const sections = [`Usage: ${usage.flat().join(' ')}`]
		const description = command.description ?? config.description
		if (description) sections.push(description)
		sections.push(...section('Arguments', positionals))
		sections.push(
			`Options:\n${table([
				...optionRows(optionsOf(fields)),
				helpRow,
				...(path.length ? [] : versionRow)
			])}`
		)
		sections.push(...section('Global options', optionsOf(globals)))
		if (command.examples?.length)
			sections.push(
				`Examples:\n${command.examples.map((line) => `  ${line}`).join('\n')}`
			)
		return sections.join('\n\n')
	}

	async function helpText(
		node: CommandGroup | Command,
		path: string[],
		globals: Field[]
	) {
		const text = isCommand(node)
			? commandHelp(node, path, globals)
			: groupHelp(node, path, globals)
		return config.help ? config.help(text, { path }) : text
	}

	async function completion(shell: string, globals: Field[]) {
		const fn = `_${config.name.replace(/\W/g, '_')}_completion`
		const flags = (fields: Field[]) =>
			optionsOf([...fields, ...globals]).map((field) => `--${field.flag}`)
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
			let globalFields: Field[] = []
			// The group or command a usage error's help describes.
			let current: { node: CommandGroup | Command; path: string[] } = {
				node: {},
				path: []
			}
			try {
				globalFields = fieldsOf(config.globals)
				const globalPositionals = positionalsOf(globalFields)
				const array = globalPositionals.find((field) => field.multiple)
				if (array)
					throw new Error(
						`hanzio/cli: positional global "${array.key}" can't be an array`
					)
				const longNames = (field: Field) => [
					`--${field.flag}`,
					...field.aliases.map((alias) => `--${alias}`)
				]
				const names = (field: Field) => [
					...longNames(field),
					...(field.alias ? [`-${field.alias}`] : [])
				]
				const globalOptions = optionsOf(globalFields)
				const valueFlags = new Set(
					globalOptions
						.filter((field) => field.kind !== 'boolean' && !field.optionalValue)
						.flatMap(names)
				)
				const globalFlags = new Set(
					globalOptions.flatMap((field) => [
						...names(field),
						`--no-${field.flag}`
					])
				)
				const isHelp = (token: string) => token === '--help' || token === '-h'
				const isVersion = (token: string) =>
					token === '--version' ||
					(token === '-v' &&
						!globalOptions.some((field) => field.alias === 'v'))
				const isFlag = (token: string) => token.startsWith('-') && token !== '-'

				// Walk the command names; options before and between them are globals,
				// and positional globals come before the first command name.
				const args = [...argv]
				let defaultCommand =
					typeof config.defaultCommand === 'function'
						? config.defaultCommand(env)
						: config.defaultCommand
				let injected = -1
				let node: CommandNode = root
				const path: string[] = []
				const pre: string[] = []
				const positionals: string[] = []
				let index = 0
				while (typeof node !== 'function' && !isCommand(node)) {
					const group: CommandGroup = node
					current = { node: group, path: [...path] }
					const token = args[index]
					const end = token === undefined || token === '--'
					if (end && pre.some(isHelp)) {
						stdout.write(`${await helpText(group, path, globalFields)}\n`)
						return 0
					}
					if (end && !path.length && pre.some(isVersion)) {
						if (Object.hasOwn(group, 'version')) {
							pre.splice(0, pre.length, ...pre.filter((t) => !isVersion(t)))
							args.splice(index, 0, 'version')
							injected = index
							continue
						}
						if (config.version) {
							stdout.write(`${config.version}\n`)
							return 0
						}
					}
					if (
						!path.length &&
						defaultCommand !== undefined &&
						(end ||
							(isFlag(token) &&
								!isHelp(token) &&
								!isVersion(token) &&
								!globalFlags.has(token.split('=')[0] as string)))
					) {
						args.splice(index, 0, defaultCommand)
						injected = index
						defaultCommand = undefined
						continue
					}
					if (end)
						throw new UsageError(
							`${path.length ? `${usage}: missing` : 'Missing'} command\n\n${await helpText(group, path, globalFields)}`,
							'missing-command'
						)
					index++
					if (isFlag(token)) {
						pre.push(token)
						if (valueFlags.has(token) && args[index] !== undefined)
							pre.push(args[index++] as string)
						continue
					}
					if (token === 'completion' && builtIn(group) && !positionals.length) {
						const [shell = 'bash'] = args.slice(index)
						stdout.write(await completion(shell, globalFields))
						return 0
					}
					if (
						!path.length &&
						index - 1 !== injected &&
						positionals.length < globalPositionals.length
					) {
						positionals.push(token)
						usage = `${usage} ${token}`
						continue
					}
					const child =
						(Object.hasOwn(group, token) ? group[token] : undefined) ??
						((await unknownCommand?.(token, path)) as CommandNode | undefined)
					if (!child) {
						const names = Object.keys(group)
						if (builtIn(group)) names.push('completion')
						const guess = closest(token, names)
						throw new UsageError(
							`Unknown command "${[...path, token].join(' ')}".${guess ? ` Did you mean "${[...path, guess].join(' ')}"?` : ` Commands: ${names.join(', ')}`}`,
							'unknown-command'
						)
					}
					node = child
					path.push(token)
					usage = `${usage} ${token}`
				}

				const command = await loadCommand(node)
				current = { node: command, path }
				const rest = args.slice(index)
				const fields = command.raw ? [] : fieldsOf(command.input)
				const dash = rest.indexOf('--')
				const tokens = command.raw
					? pre
					: [...pre, ...(dash < 0 ? rest : rest.slice(0, dash))]
				if (!command.raw && tokens.some(isHelp)) {
					stdout.write(`${await helpText(command, path, globalFields)}\n`)
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
				// Every long name a user may type, mapped to its parseArgs option.
				const canonical = new Map<string, Field>()
				const all = optionsOf([...globalFields, ...fields])
				for (const field of all) {
					const name = optionName(field)
					for (const long of longNames(field)) {
						if (long === '--help' || canonical.has(long))
							throw new Error(`hanzio/cli: ${long} is declared twice`)
						canonical.set(long, field)
					}
					options[name] = {
						type: field.kind === 'boolean' ? 'boolean' : 'string',
						multiple: field.multiple,
						...(field.alias ? { short: field.alias } : {})
					}
				}
				// Aliases, `noX` flags and bare optional-value flags become the
				// option's own name before parsing.
				const rewritten = tokens.map((token) => {
					const eq = token.indexOf('=')
					const field = canonical.get(eq < 0 ? token : token.slice(0, eq))
					if (!field) return token
					const value =
						eq < 0 ? (field.optionalValue ? '=' : '') : token.slice(eq)
					return `--${optionName(field)}${value}`
				})
				const strict = command.strict !== false
				let parsed: ReturnType<typeof parseArgs>
				try {
					parsed = parseArgs({
						args: rewritten,
						options,
						allowPositionals: true,
						allowNegative: true,
						strict
					})
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					const unknown = /^Unknown option '(-[^']*)'/.exec(message)?.[1]
					if (!unknown) throw new UsageError(message.split('. ')[0] ?? message)
					const guess = closest(
						unknown.replace(/^--?/, ''),
						all.flatMap((field) => [field.flag, ...field.aliases])
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
					const raw = readFields(
						fields,
						parsed.values,
						positionals,
						env,
						strict
					)
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
				const globals = await validate(
					config.globals,
					globalFields,
					positionals
				)
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
				const failure =
					error instanceof UsageError
						? new CliUsageError(error.message, {
								kind: error.kind,
								path: current.path,
								help: config.onError
									? `${await helpText(current.node, current.path, globalFields)}\n`
									: ''
							})
						: error
				let printed: number | undefined
				const print = () => {
					if (printed !== undefined) return printed
					const message =
						failure instanceof Error ? failure.message : String(failure)
					if (failure instanceof CliUsageError)
						stderr.write(`${message}\nRun "${usage} --help" for usage.\n`)
					else if (json) stderr.write(`${JSON.stringify({ error: message })}\n`)
					else
						stderr.write(
							`${failure instanceof Error && !(failure instanceof CliError) ? (failure.stack ?? message) : message}\n`
						)
					printed = failure instanceof CliError ? failure.exitCode : 1
					return printed
				}
				if (!config.onError) return print()
				return (
					(await config.onError(failure, {
						stdout,
						stderr,
						env,
						json,
						print
					})) ?? print()
				)
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
