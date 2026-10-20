---
description: Typed CLIs from Zod object schemas, parsed with node:util parseArgs, with generated help, completion and consistent exit codes.
---

# hanzio/cli

Each command's `input` is a Zod object: its keys become flags, Zod validates
them, and `run` gets the typed result. Parsing is `node:util` `parseArgs`, so
there is no extra dependency. Runs in Bun and Node 22.4+; needs `zod` 4.

```ts
// src/cli.ts
import { z } from 'zod'
import { defineCli, defineCommand } from 'hanzio/cli'

export default defineCli({
	name: 'better-mastra-evals',
	version: '1.0.0',
	commands: {
		run: defineCommand({
			description: 'Run eval suites',
			input: z.object({
				suite: z.string().meta({ positional: true }),
				repeats: z.number().default(1).describe('Runs per case'),
				json: z.boolean().optional()
			}),
			run: async (input, ctx) => {
				// input: { suite: string; repeats: number; json?: boolean }
			}
		}),
		inspect: () => import('./commands/inspect') // loaded only when used
	}
})
```

```ts
#!/usr/bin/env node
// bin.ts
import cli from './cli.js'

process.exitCode = await cli.run()
```

Use `process.exit(await cli.run())` instead when open database or Redis
handles would keep the process alive.

## Flags

| Schema | Command line |
| --- | --- |
| `z.string()`, `z.enum([...])` | `--name value` or `--name=value` |
| `z.number()` | `--repeats 3`, coerced before validation |
| `z.boolean()` | `--json`; `--no-json` sets `false`; missing is `false` |
| `z.array(z.string())` | repeatable: `--model a --model b`; missing is `[]` |
| `.optional()`, `.default(x)` | may be left out |
| `.describe('…')` | help text |
| `.meta({ positional: true })` | positional, in key order; an array takes the rest |
| `.meta({ alias: 'r' })` | `-r value` |
| `.meta({ env: 'APP_REGION' })` | read from the environment when the flag is missing |

Keys are camelCase in the schema and kebab-case on the command line (`dryRun`
→ `--dry-run`). These are the same `.meta()` keys as `trpc-cli`, plus `env`.
Pipes read their input side, so `z.stringbool()` takes `--submit true`.

Every CLI gets `-h`/`--help` (root, groups and commands), `--version` when you
pass `version`, and "Did you mean …?" for mistyped commands and flags.

## Commands

`commands` is a single command for a one-command CLI, or an object of
commands and nested groups, so `{ check: { docs } }` runs as `tool check
docs`. Groups are plain objects, so an adapter can build them from data.

A command is one of:

- `defineCommand({ description, input, run, output })`.
- `() => import('./commands/heavy')`, a module whose default export is a
  command. It loads only when it runs.
- `defineCommand({ description, load: () => import('./commands/heavy') })`,
  the same with a description for the command list.
- `defineCommand({ raw: true, run })`, which skips parsing: every argument
  after the command name is in `ctx.argv` (for `tool prisma migrate dev`).

`run(input, ctx)` gets:

| `ctx` | |
| --- | --- |
| `context` | what `defineCli({ context })` returned |
| `globals` | the parsed global options |
| `path` | command names, e.g. `['deal', 'list']` |
| `passthrough` | arguments after `--` (`tool exec -- bun test`) |
| `argv` | every argument after the command names, unparsed |
| `json` | `--json` was passed |
| `stdout`, `stderr`, `env` | the CLI's streams and environment |
| `exitCode` | set it to fail without an error message |

Whatever `run` returns goes to `output(result, ctx)`. The default prints
strings as they are and anything else as indented JSON, or compact JSON with
`--json`; `undefined` prints nothing.

## Globals, context and guard

```ts
const cli = defineCli({
	name: 'app',
	globals: z.object({
		org: z.string().optional(),
		allowProduction: z.boolean().optional(),
		json: z.boolean().optional()
	}),
	context: async (globals) => ({ db: await connect(), org: globals.org }),
	guard: ({ context, globals }) => {
		if (context.db.isProduction && !globals.allowProduction)
			throw new CliError('Refusing production; pass --allow-production')
	},
	commands: { deal: { list, get } }
})
```

Globals are accepted before or after the command names. `context` runs after
parsing, so `--help` never connects anywhere. `guard` runs before every
command. A command defined in its own file types its context by annotating
`ctx`:

```ts
export const list = defineCommand({
	input: z.object({ limit: z.number().default(20) }),
	run: (input, { context }: CommandContext<AppContext>) =>
		context.db.deal.findMany({ take: input.limit })
})
```

`defineCli` rejects a command whose context type doesn't match `context`.

## Errors and exit codes

| Exit | When |
| --- | --- |
| 0 | the command finished |
| 1 | `run` threw, or set `ctx.exitCode = 1` |
| 2 | bad arguments: unknown command or flag, failed validation |

Throw `new CliError(message, { exitCode })` for expected failures: the
message is printed without a stack. Other errors print their stack. With
`--json`, errors print as `{"error": "…"}`. Usage errors name the flag:

```
--repeats: Invalid input: expected number, received string
Run "better-mastra-evals run --help" for usage.
```

## Shell completion

A CLI with commands also gets `tool completion bash` and `tool completion
zsh`, which print a script that completes command names and flags:

```sh
# in ~/.zshrc (or ~/.bashrc with bash)
source <(tool completion zsh)
```

## Testing

`cli.run(argv, { stdout, stderr, env })` resolves to the exit code and never
touches `process`, so tests don't spawn anything:

```ts
let out = ''
const code = await cli.run(['run', 'smoke', '--json'], {
	stdout: { write: (text) => (out += text) },
	stderr: { write: () => {} },
	env: {}
})
expect(code).toBe(0)
```

## Migrating from `parseArgs`

1. Turn the `options` object into a `z.object`: `type: 'string'` becomes
   `z.string()`, `multiple: true` becomes `z.array(...)`, `default` becomes
   `.default()`, `short: 'r'` becomes `.meta({ alias: 'r' })`, and
   positionals become keys with `.meta({ positional: true })`.
2. Delete the hand-written validation (`Number(values.repeats)`, enum
   checks, "--x required" errors): `z.number()`, `z.enum()` and required keys
   do it, with the flag in the error.
3. Move each `switch (positionals[0])` branch into a `defineCommand`, and its
   help line into `description` / `.describe()`. Delete the `USAGE` string.
4. Replace `console.error(...); process.exit(1)` with `throw new CliError(...)`,
   and the `main().catch(...)` wrapper with `process.exitCode = await cli.run()`.

```ts
// before
const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: { out: { type: 'string', short: 'o' }, force: { type: 'boolean' } }
})
if (positionals[0] !== 'add' || !values.out) {
	console.error(USAGE)
	process.exit(2)
}
await add(positionals.slice(1), values)

// after
defineCli({
	name: 'tool',
	commands: {
		add: defineCommand({
			description: 'Copy fragments into a schema folder',
			input: z.object({
				fragments: z.array(z.string()).min(1).meta({ positional: true }),
				out: z.string().meta({ alias: 'o' }),
				force: z.boolean()
			}),
			run: (input) => add(input.fragments, input)
		})
	}
})
```
