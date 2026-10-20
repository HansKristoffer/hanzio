import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { type CliIO, CliError, defineCli, defineCommand } from '.'

function io(env: Record<string, string | undefined> = {}) {
	const out = { stdout: '', stderr: '' }
	const streams: CliIO = {
		stdout: { write: (text: string) => (out.stdout += text) },
		stderr: { write: (text: string) => (out.stderr += text) },
		env
	}
	return { out, streams }
}

async function run(
	cli: ReturnType<typeof defineCli>,
	argv: string[],
	env = {}
) {
	const { out, streams } = io(env)
	const code = await cli.run(argv, streams)
	return { code, ...out }
}

const evals = defineCli({
	name: 'evals',
	version: '1.2.3',
	description: 'Run evals',
	commands: {
		run: defineCommand({
			description: 'Run eval suites',
			input: z.object({
				suite: z.string().meta({ positional: true }),
				repeats: z.number().default(1).describe('Runs per case'),
				model: z.array(z.string()).describe('Models to compare'),
				judge: z.boolean().default(true),
				mode: z.enum(['fast', 'full']).optional(),
				region: z.string().optional().meta({ alias: 'r', env: 'EVALS_REGION' }),
				dryRun: z.boolean().optional(),
				json: z.boolean().optional()
			}),
			run: (input) => input
		}),
		check: {
			docs: defineCommand({
				description: 'Check docs',
				input: z.object({
					files: z.array(z.string()).meta({ positional: true })
				}),
				run: ({ files }) => `checked ${files.length}`
			})
		},
		exec: defineCommand({
			description: 'Run a command',
			input: z.object({ verbose: z.boolean().optional() }),
			run: (input, ctx) => ({ ...input, passthrough: ctx.passthrough })
		}),
		prisma: defineCommand({
			raw: true,
			run: (_input, ctx) => ctx.argv.join(' ')
		}),
		fail: defineCommand({
			run: () => {
				throw new CliError('nothing to do', { exitCode: 3 })
			}
		}),
		crash: defineCommand({
			run: () => {
				throw new Error('boom')
			}
		}),
		quiet: defineCommand({
			run: (_input, ctx) => {
				ctx.exitCode = 1
			}
		}),
		heavy: () =>
			Promise.resolve({ default: defineCommand({ run: () => 'loaded' }) }),
		lazy: defineCommand({
			description: 'Loaded on demand',
			load: async () => defineCommand({ run: () => 'lazy' })
		})
	}
})

describe('parsing', () => {
	test('types flags from the Zod shape and applies defaults', async () => {
		const result = await run(evals, [
			'run',
			'smoke',
			'--repeats',
			'3',
			'--model=a',
			'--model',
			'b',
			'--no-judge',
			'--mode',
			'fast',
			'-r',
			'eu',
			'--dry-run',
			'--json'
		])
		expect(result.code).toBe(0)
		expect(JSON.parse(result.stdout)).toEqual({
			suite: 'smoke',
			repeats: 3,
			model: ['a', 'b'],
			judge: false,
			mode: 'fast',
			region: 'eu',
			dryRun: true,
			json: true
		})
	})

	test('missing booleans and arrays read as false and []', async () => {
		const result = await run(evals, ['run', 'smoke', '--json'])
		expect(JSON.parse(result.stdout)).toEqual({
			suite: 'smoke',
			repeats: 1,
			model: [],
			judge: true,
			json: true
		})
	})

	test('reads pipes from their input side', async () => {
		const cli = defineCli({
			name: 'release',
			commands: defineCommand({
				input: z.object({ autoSubmit: z.stringbool().default(true) }),
				run: (input) => input
			})
		})
		const result = await run(cli, ['--auto-submit', 'false'])
		expect(JSON.parse(result.stdout)).toEqual({ autoSubmit: false })
	})

	test('falls back to .meta({ env })', async () => {
		const result = await run(evals, ['run', 'smoke', '--json'], {
			EVALS_REGION: 'us'
		})
		expect(JSON.parse(result.stdout).region).toBe('us')
	})

	test('pretty-prints JSON without --json and strings as-is', async () => {
		expect((await run(evals, ['run', 'smoke'])).stdout).toContain(
			'\n  "suite": "smoke"'
		)
		expect((await run(evals, ['check', 'docs', 'a.md', 'b.md'])).stdout).toBe(
			'checked 2\n'
		)
	})

	test('collects arguments after -- and keeps raw argv for raw commands', async () => {
		const exec = await run(evals, [
			'exec',
			'--verbose',
			'--',
			'bun',
			'test',
			'--watch'
		])
		expect(JSON.parse(exec.stdout)).toEqual({
			verbose: true,
			passthrough: ['bun', 'test', '--watch']
		})
		const prisma = await run(evals, ['prisma', 'migrate', 'dev', '--name', 'x'])
		expect(prisma.stdout).toBe('migrate dev --name x\n')
	})

	test('loads lazy commands', async () => {
		expect((await run(evals, ['heavy'])).stdout).toBe('loaded\n')
		expect((await run(evals, ['lazy'])).stdout).toBe('lazy\n')
	})
})

describe('usage errors exit 2', () => {
	test('validation names the flag', async () => {
		const result = await run(evals, [
			'run',
			'smoke',
			'--repeats',
			'many',
			'--mode',
			'slow'
		])
		expect(result.code).toBe(2)
		expect(result.stderr).toContain('--repeats: Invalid input: expected number')
		expect(result.stderr).toContain('--mode: Invalid option')
		expect(result.stderr).toContain('Run "evals run --help" for usage.')
	})

	test('missing positional', async () => {
		const result = await run(evals, ['run'])
		expect(result.code).toBe(2)
		expect(result.stderr).toContain('<suite>:')
	})

	test('unknown option and command suggest the closest name', async () => {
		const option = await run(evals, ['run', 'smoke', '--repeat', '2'])
		expect(option.code).toBe(2)
		expect(option.stderr).toContain(
			'Unknown option --repeat. Did you mean --repeats?'
		)
		const command = await run(evals, ['chek', 'docs'])
		expect(command.code).toBe(2)
		expect(command.stderr).toContain(
			'Unknown command "chek". Did you mean "check"?'
		)
		const nested = await run(evals, ['check', 'doc'])
		expect(nested.stderr).toContain('Did you mean "check docs"?')
	})

	test('unexpected extra positional', async () => {
		const result = await run(evals, ['exec', 'stray'])
		expect(result.code).toBe(2)
		expect(result.stderr).toContain('Unexpected argument "stray"')
	})

	test('no command prints the command list', async () => {
		const result = await run(evals, [])
		expect(result.code).toBe(2)
		expect(result.stderr).toContain('check docs')
	})
})

describe('failures', () => {
	test('CliError prints its message without a stack', async () => {
		const result = await run(evals, ['fail'])
		expect(result).toEqual({ code: 3, stdout: '', stderr: 'nothing to do\n' })
	})

	test('other errors exit 1 with a stack', async () => {
		const result = await run(evals, ['crash'])
		expect(result.code).toBe(1)
		expect(result.stderr).toContain('Error: boom\n    at ')
	})

	test('ctx.exitCode fails without a message', async () => {
		expect(await run(evals, ['quiet'])).toEqual({
			code: 1,
			stdout: '',
			stderr: ''
		})
	})
})

describe('help', () => {
	test('lists commands with descriptions, version and completion', async () => {
		const result = await run(evals, ['--help'])
		expect(result.code).toBe(0)
		expect(result.stdout).toContain('evals 1.2.3\nRun evals')
		expect(result.stdout).toMatch(/run\s+Run eval suites/)
		expect(result.stdout).toMatch(/check docs\s+Check docs/)
		expect(result.stdout).toMatch(/lazy\s+Loaded on demand/)
		expect(result.stdout).toContain('completion <bash|zsh>')
		expect((await run(evals, ['--version'])).stdout).toBe('1.2.3\n')
	})

	test('per-command usage shows types, defaults and enum values', async () => {
		const result = await run(evals, ['run', '--help'])
		expect(result.code).toBe(0)
		expect(result.stdout).toContain('Usage: evals run <suite> [options]')
		expect(result.stdout).toMatch(
			/--repeats <number>\s+Runs per case \(default: 1\)/
		)
		expect(result.stdout).toContain('--model <string>...')
		expect(result.stdout).toContain('--[no-]judge')
		expect(result.stdout).toContain('--mode <fast|full>')
		expect(result.stdout).toMatch(
			/-r, --region <string>\s+\[env: EVALS_REGION\]/
		)
		expect(result.stdout).toContain('--dry-run')
	})

	test('group help lists its subcommands', async () => {
		const result = await run(evals, ['check', '-h'])
		expect(result.stdout).toContain('Usage: evals check <command> [options]')
		expect(result.stdout).toContain('docs')
	})
})

describe('globals, context and guard', () => {
	const calls: unknown[] = []
	const app = defineCli({
		name: 'app',
		globals: z.object({
			as: z.string().optional(),
			allowProduction: z.boolean().optional(),
			json: z.boolean().optional()
		}),
		context: async (globals) => ({
			user: globals.as ?? 'me',
			production: true
		}),
		guard: ({ path, globals, context }) => {
			calls.push(path)
			if (context.production && !globals.allowProduction)
				throw new CliError('Refusing production without --allow-production')
		},
		commands: {
			deal: {
				list: defineCommand({
					input: z.object({ limit: z.number().default(10) }),
					run: (input, ctx: { context: { user: string } }) => ({
						user: ctx.context.user,
						limit: input.limit
					}),
					output: (result, ctx) => {
						ctx.stdout.write(`${result.user}:${result.limit}\n`)
					}
				})
			}
		}
	})

	test('accepts globals before and after the command', async () => {
		const before = await run(app, [
			'--as',
			'ann',
			'--allow-production',
			'deal',
			'list'
		])
		expect(before).toEqual({ code: 0, stdout: 'ann:10\n', stderr: '' })
		const after = await run(app, [
			'deal',
			'list',
			'--limit',
			'2',
			'--as=bob',
			'--allow-production'
		])
		expect(after.stdout).toBe('bob:2\n')
		expect(calls).toEqual([
			['deal', 'list'],
			['deal', 'list']
		])
	})

	test('the guard refuses a command', async () => {
		expect(await run(app, ['deal', 'list'])).toEqual({
			code: 1,
			stdout: '',
			stderr: 'Refusing production without --allow-production\n'
		})
	})

	test('--json errors are JSON', async () => {
		const result = await run(app, ['deal', 'list', '--json'])
		expect(JSON.parse(result.stderr)).toEqual({
			error: 'Refusing production without --allow-production'
		})
	})

	test('help shows global options', async () => {
		const result = await run(app, ['deal', 'list', '--help'])
		expect(result.stdout).toMatch(/Global options:\n\s+--as <string>/)
	})
})

describe('single-command CLI', () => {
	const greet = defineCli({
		name: 'greet',
		version: '0.1.0',
		commands: defineCommand({
			description: 'Say hello',
			input: z.object({ name: z.string().meta({ positional: true }) }),
			run: ({ name }) => `hello ${name}`
		})
	})

	test('runs without a command name', async () => {
		expect((await run(greet, ['ann'])).stdout).toBe('hello ann\n')
		expect((await run(greet, ['--version'])).stdout).toBe('0.1.0\n')
		expect((await run(greet, ['--help'])).stdout).toContain(
			'Usage: greet <name> [options]\n\nSay hello'
		)
	})
})

test('completion prints a bash script for the command tree', async () => {
	const bash = await run(evals, ['completion', 'bash'])
	expect(bash.code).toBe(0)
	expect(bash.stdout).toContain('complete -F _evals_completion evals')
	expect(bash.stdout).toContain('"check docs"|"check docs "*) opts="--help" ;;')
	expect(bash.stdout).toMatch(
		/"run"\|"run "\*\) opts="--repeats --model --judge/
	)
	const zsh = await run(evals, ['completion', 'zsh'])
	expect(zsh.stdout).toStartWith(
		'autoload -U +X bashcompinit && bashcompinit\n'
	)
	expect((await run(evals, ['completion', 'fish'])).code).toBe(2)
})
