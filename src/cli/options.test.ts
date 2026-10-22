import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
	type Cli,
	CliError,
	CliUsageError,
	type CommandNode,
	defineCli,
	defineCommand
} from './index.js'

async function run(cli: Cli, argv: string[], env = {}) {
	const out = { stdout: '', stderr: '' }
	const code = await cli.run(argv, {
		stdout: { write: (text: string) => (out.stdout += text) },
		stderr: { write: (text: string) => (out.stderr += text) },
		env
	})
	return { code, ...out }
}

const echo = defineCommand({
	input: z.object({ suite: z.string().optional() }),
	run: (input, ctx) => ({ path: ctx.path, ...input })
})

describe('defaultCommand', () => {
	const evals = defineCli({
		name: 'evals',
		globals: z.object({ org: z.string().optional() }),
		defaultCommand: 'run',
		commands: { run: echo, inspect: echo }
	})

	test('runs with no command, or when the first argument is a command flag', async () => {
		expect(JSON.parse((await run(evals, [])).stdout)).toEqual({
			path: ['run']
		})
		expect(JSON.parse((await run(evals, ['--suite', 'x'])).stdout)).toEqual({
			path: ['run'],
			suite: 'x'
		})
	})

	test('globals before an explicit command and --help keep working', async () => {
		const inspect = await run(evals, ['--org', 'a', 'inspect'])
		expect(JSON.parse(inspect.stdout).path).toEqual(['inspect'])
		expect((await run(evals, ['--help'])).stdout).toContain(
			'Usage: evals <command> [options]'
		)
	})

	test('a function reads it from the environment', async () => {
		const release = defineCli({
			name: 'release',
			defaultCommand: (env) => env.RELEASE_COMMAND,
			commands: { run: echo }
		})
		expect((await run(release, [], { RELEASE_COMMAND: 'run' })).code).toBe(0)
		expect((await run(release, [])).stderr).toStartWith('Missing command')
	})
})

describe('onError', () => {
	const commands = {
		run: defineCommand({
			input: z.object({ suite: z.string().meta({ positional: true }) }),
			run: () => 'ok'
		}),
		fail: defineCommand({
			run: () => {
				throw new CliError('nope', { exitCode: 3 })
			}
		})
	}

	test('keeps the default message with another usage exit code', async () => {
		const cli = defineCli({
			name: 'tool',
			commands,
			onError: (_error, io) => {
				const code = io.print()
				return code === 2 ? 1 : code
			}
		})
		expect(await run(cli, ['nope'])).toEqual({
			code: 1,
			stdout: '',
			stderr:
				'Unknown command "nope". Commands: run, fail, completion\nRun "tool --help" for usage.\n'
		})
		expect(await run(cli, ['fail'])).toEqual({
			code: 3,
			stdout: '',
			stderr: 'nope\n'
		})
	})

	test('prints help instead of a usage error', async () => {
		const cli = defineCli({
			name: 'tool',
			commands,
			onError: (error, io) => {
				if (!(error instanceof CliUsageError)) return
				io.stdout.write(error.help)
				return error.kind === 'missing-command' ? 0 : 1
			}
		})
		const empty = await run(cli, [])
		expect(empty.code).toBe(0)
		expect(empty.stdout).toStartWith('tool\n\nUsage: tool <command> [options]')
		expect(empty.stdout).toEndWith(" for a command's options.\n")
		const missing = await run(cli, ['run'])
		expect(missing.code).toBe(1)
		expect(missing.stdout).toStartWith('Usage: tool run <suite> [options]')
		expect(missing.stderr).toBe('')
	})

	test('formats any error itself', async () => {
		const errors: unknown[] = []
		const cli = defineCli({
			name: 'tool',
			commands,
			onError: (error, io) => {
				errors.push(error)
				io.stderr.write(`✗ ${(error as Error).message}\n`)
				return 1
			}
		})
		expect(await run(cli, ['fail'])).toEqual({
			code: 1,
			stdout: '',
			stderr: '✗ nope\n'
		})
		await run(cli, ['run', 'a', 'b'])
		expect(errors[1]).toMatchObject({
			kind: 'invalid-arguments',
			path: ['run'],
			message: 'Unexpected argument "b"'
		})
	})
})

test('unknownCommand resolves commands that are not in the tree', async () => {
	const cli = defineCli({
		name: 'tool',
		commands: { run: echo },
		unknownCommand: (name): CommandNode | undefined =>
			name === 'redis'
				? { flush: defineCommand({ run: () => 'flushed' }) }
				: undefined
	})
	expect((await run(cli, ['redis', 'flush'])).stdout).toBe('flushed\n')
	expect((await run(cli, ['nope'])).stderr).toStartWith(
		'Unknown command "nope".'
	)
})

describe('help', () => {
	const cli = defineCli({
		name: 'tool',
		commands: {
			stop: defineCommand({
				description: 'Stop processes\n\nStops every process by default.',
				usage: '[name...] [--all]',
				raw: true,
				run: () => undefined
			}),
			ls: defineCommand({
				description: 'List processes',
				input: z.object({ json: z.boolean().optional() }),
				examples: ['tool ls --json'],
				run: () => undefined
			})
		},
		help: (text, { path }) => (path.length ? text : `${text}\n\nDocs: x.dev`)
	})

	test('lists usage strings and the first line of each description', async () => {
		const root = (await run(cli, ['--help'])).stdout
		expect(root).toContain(
			'  stop [name...] [--all]  Stop processes\n  ls                      List processes\n'
		)
		expect(root).toEndWith("for a command's options.\n\nDocs: x.dev\n")
	})

	test('command help shows the full description and examples', async () => {
		expect((await run(cli, ['ls', '--help'])).stdout).toBe(
			`Usage: tool ls [options]

List processes

Options:
  --json
  -h, --help  Show help

Examples:
  tool ls --json
`
		)
	})
})

describe('version', () => {
	test('-v prints the version like --version', async () => {
		const cli = defineCli({
			name: 'tool',
			version: '1.0.0',
			commands: { echo }
		})
		expect((await run(cli, ['-v'])).stdout).toBe('1.0.0\n')
	})

	test('a root version command handles --version and -v', async () => {
		const cli = defineCli({
			name: 'tool',
			version: '1.0.0',
			commands: { version: defineCommand({ run: () => 'tool v1.0.0' }) }
		})
		for (const argv of [['--version'], ['-v'], ['version']])
			expect((await run(cli, argv)).stdout).toBe('tool v1.0.0\n')
	})
})

test('strict: false ignores unknown flags and extra positionals', async () => {
	const cli = defineCli({
		name: 'md',
		commands: defineCommand({
			input: z.object({ url: z.string().meta({ positional: true }) }),
			strict: false,
			run: (input) => input
		})
	})
	const result = await run(cli, ['https://x.dev', 'extra', '--unknown', '1'])
	expect(JSON.parse(result.stdout)).toEqual({ url: 'https://x.dev' })
})

describe('flags', () => {
	const dev = defineCli({
		name: 'dev',
		commands: defineCommand({
			input: z.object({
				expose: z.union([z.boolean(), z.string()]).optional(),
				noWatch: z.boolean(),
				tui: z.boolean().default(true),
				secretsEnv: z
					.string()
					.optional()
					.meta({ alias: ['e', 'env'], env: ['SECRETS_ENV', 'APP_ENV'] })
			}),
			run: (input) => input
		})
	})
	const parse = async (argv: string[], env = {}) =>
		JSON.parse((await run(dev, argv, env)).stdout)

	test('an optional-value flag is true alone and a string with =', async () => {
		expect((await parse(['--expose'])).expose).toBe(true)
		expect((await parse(['--expose=api,web'])).expose).toBe('api,web')
		expect((await parse([])).expose).toBeUndefined()
	})

	test('a noX key is its own --no-x flag', async () => {
		expect(await parse(['--no-watch', '--no-tui'])).toMatchObject({
			noWatch: true,
			tui: false
		})
		expect((await parse([])).noWatch).toBe(false)
	})

	test('aliases can be long flags', async () => {
		expect((await parse(['--env', 'prod'])).secretsEnv).toBe('prod')
		expect((await parse(['-e', 'dev'])).secretsEnv).toBe('dev')
		expect((await parse(['--secrets-env=ci'])).secretsEnv).toBe('ci')
	})

	test('env falls back through blank variables', async () => {
		expect(
			(await parse([], { SECRETS_ENV: ' ', APP_ENV: 'staging' })).secretsEnv
		).toBe('staging')
		expect((await parse([], { SECRETS_ENV: '' })).secretsEnv).toBeUndefined()
	})

	test('help shows the new shapes', async () => {
		const help = (await run(dev, ['--help'])).stdout
		expect(help).toContain('--expose[=<string>]')
		expect(help).toMatch(/\n {2}--no-watch\s*\n/)
		expect(help).toContain('--[no-]tui')
		expect(help).toMatch(
			/-e, --secrets-env, --env <string>\s+\[env: SECRETS_ENV, APP_ENV\]/
		)
	})
})

describe('positional globals', () => {
	const webhooks = defineCli({
		name: 'webhooks',
		globals: z.object({
			module: z.string().meta({ positional: true }).describe('Module file')
		}),
		commands: {
			list: defineCommand({
				run: (_input, ctx) => `${ctx.globals.module}: list`
			}),
			test: defineCommand({
				input: z.object({ event: z.string().meta({ positional: true }) }),
				run: (input, ctx) => `${ctx.globals.module}: ${input.event}`
			})
		}
	})

	test('come before the command name', async () => {
		expect((await run(webhooks, ['./app.ts', 'list'])).stdout).toBe(
			'./app.ts: list\n'
		)
		expect((await run(webhooks, ['./app.ts', 'test', 'push'])).stdout).toBe(
			'./app.ts: push\n'
		)
	})

	test('show in usage lines and help', async () => {
		const root = (await run(webhooks, ['--help'])).stdout
		expect(root).toContain(
			'Usage: webhooks <module> <command> [options]\n\nArguments:\n  <module>  Module file\n\nCommands:'
		)
		expect(
			(await run(webhooks, ['./app.ts', 'test', '--help'])).stdout
		).toStartWith(
			'Usage: webhooks <module> test <event> [options]\n\nArguments:\n  <module>  Module file\n  <event>'
		)
	})

	test('a missing command names the given module in its hint', async () => {
		const result = await run(webhooks, ['./app.ts'])
		expect(result.code).toBe(2)
		expect(result.stderr).toEndWith(
			'Run "webhooks ./app.ts --help" for usage.\n'
		)
	})
})

test('a CLI of raw commands loads without zod', async () => {
	const build = await Bun.build({
		entrypoints: [`${import.meta.dir}/index.ts`],
		external: ['zod'],
		target: 'node'
	})
	const code = await build.outputs[0]?.text()
	expect(code).not.toMatch(/from ["']zod["']|require\(["']zod["']\)/)
})
