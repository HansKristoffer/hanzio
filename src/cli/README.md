---
description: Typed CLIs from Zod object schemas, parsed with node:util parseArgs, with generated help, completion and consistent exit codes.
---

# hanzio/cli

Each command's `input` is a Zod object: its keys become flags, Zod validates
them, and `run` gets the typed result. Parsing is `node:util` `parseArgs`, so
there is no extra dependency. Runs in Bun and Node 22.4+. Commands with an
`input` need `zod` 4; a CLI made only of `raw` commands loads without it.

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
| `noWatch: z.boolean()` | its own flag `--no-watch`, not `--watch` negated |
| `z.array(z.string())` | repeatable: `--model a --model b`; missing is `[]` |
| `z.union([z.boolean(), z.string()])` | `--expose` is `true`, `--expose=api,web` is the string |
| `.optional()`, `.default(x)` | may be left out |
| `.describe('…')` | help text |
| `.meta({ positional: true })` | positional, in key order; an array takes the rest |
| `.meta({ alias: 'r' })` | `-r value`; longer aliases are flags: `alias: ['r', 'region-name']` |
| `.meta({ env: 'APP_REGION' })` | read from the environment when the flag is missing; a list is tried in order, and blank values count as unset |

Keys are camelCase in the schema and kebab-case on the command line (`dryRun`
→ `--dry-run`). These are the same `.meta()` keys as `trpc-cli`, plus `env`;
importing `hanzio/cli` types them on Zod's `GlobalMeta`.
Pipes read their input side, so `z.stringbool()` takes `--submit true`.

Every CLI gets `-h`/`--help` (root, groups and commands), `--version` and
`-v` when you pass `version`, and "Did you mean …?" for mistyped commands and
flags. A root command named `version` also answers `--version` and `-v`, so it
decides the format (`tool v1.2.3`).

`defineCommand({ strict: false })` ignores unknown flags and extra
positionals instead of exiting 2.

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

The first line of `description` is the command's summary in command lists;
its help shows all of it. `usage: '[name...] [--all]'` replaces the generated
arguments in both, and `examples: ['tool stop api']` adds an Examples section
to its help.

```ts
defineCli({
	name: 'evals',
	defaultCommand: 'run', // `evals` and `evals --case x` run `evals run`
	commands: { run, inspect }
})
```

`defaultCommand` runs when no command name is given, or when the first
argument is a flag that isn't a global. Pass a function to read it from the
environment: `defaultCommand: (env) => env.RELEASE_COMMAND`.

`unknownCommand: (name, path) => node` resolves a name the group doesn't
have, for commands that come from config. Return `undefined` for the usual
"Unknown command" error.

`help: (text, { path }) => text` rewrites every help screen (`path` is `[]`
for the root), to add sections such as the tasks a config defines.

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

Globals are accepted before or after the command names. A positional global
comes before the first command name, so `globals: z.object({ module:
z.string().meta({ positional: true }) })` reads `tool ./app.ts list`. `context` runs after
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

`defineCli` rejects a command whose context type doesn't match `context`, and
requires `context` once any command needs one.

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

`onError(error, io)` sees every error first. Return the exit code, or
`undefined` for the default output; `io.print()` writes that output and
returns its code. Usage errors are `CliUsageError`s with a `kind`
(`missing-command`, `unknown-command`, `invalid-arguments`), the command
`path`, and the `help` for it:

```ts
defineCli({
	name: 'tool',
	commands,
	onError: (error, io) => {
		// Help instead of an error when run without a command.
		if (error instanceof CliUsageError && error.kind === 'missing-command') {
			io.stdout.write(error.help)
			return 0
		}
		// Keep the message, but exit 1 on bad arguments.
		const code = io.print()
		return code === 2 ? 1 : code
	}
})
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
