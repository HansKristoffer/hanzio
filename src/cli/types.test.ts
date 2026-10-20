import { expect, expectTypeOf, test } from 'bun:test'
import { z } from 'zod'
import { type CommandContext, defineCli, defineCommand } from '.'

test('run and output infer from the input schema and the return value', () => {
	const _typeCheck = () => {
		defineCommand({
			input: z.object({
				suite: z.string().meta({ positional: true }),
				repeats: z.number().default(1),
				mode: z.enum(['fast', 'full']).optional(),
				model: z.array(z.string()),
				json: z.boolean().optional()
			}),
			run: (input) => {
				expectTypeOf(input).toEqualTypeOf<{
					suite: string
					repeats: number
					mode?: 'fast' | 'full' | undefined
					model: string[]
					json?: boolean | undefined
				}>()
				// @ts-expect-error not in the schema
				void input.verbose
				return { count: input.repeats }
			},
			output: (result) => {
				expectTypeOf(result).toEqualTypeOf<{ count: number }>()
			}
		})
		defineCommand({
			run: (input) => {
				expectTypeOf(input).toEqualTypeOf<Record<string, never>>()
			}
		})
		defineCommand({
			raw: true,
			run: (_input, ctx) => {
				expectTypeOf(ctx.argv).toEqualTypeOf<readonly string[]>()
			}
		})
	}
	expect(_typeCheck).toBeInstanceOf(Function)
})

test('context and globals flow from defineCli to guard and commands', () => {
	type Ctx = { user: string }
	const _typeCheck = () => {
		const whoami = defineCommand({
			run: (_input, ctx: CommandContext<Ctx>) => ctx.context.user
		})
		defineCli({
			name: 'app',
			globals: z.object({ as: z.string().optional() }),
			context: async (globals) => {
				expectTypeOf(globals).toEqualTypeOf<{ as?: string | undefined }>()
				return { user: globals.as ?? 'me', role: 'admin' as const }
			},
			guard: ({ context, globals }) => {
				expectTypeOf(context).toEqualTypeOf<{ user: string; role: 'admin' }>()
				expectTypeOf(globals).toEqualTypeOf<{ as?: string | undefined }>()
			},
			commands: { whoami, nested: { whoami } }
		})
		defineCli({
			name: 'app',
			// @ts-expect-error whoami needs a context with `user`
			context: () => ({ id: 1 }),
			commands: { whoami }
		})
		defineCli({
			name: 'app',
			// @ts-expect-error strings are not commands
			commands: { whoami: 'whoami' }
		})
	}
	expect(_typeCheck).toBeInstanceOf(Function)
})

test('a command that needs context requires defineCli({ context })', () => {
	const _typeCheck = () => {
		const whoami = defineCommand({
			run: (_input, ctx: CommandContext<{ user: string }>) => ctx.context.user
		})
		// @ts-expect-error context is missing
		defineCli({ name: 'app', commands: { whoami } })
		defineCli({
			name: 'app',
			commands: { plain: defineCommand({ run: () => 'ok' }) }
		})
		defineCommand({
			// @ts-expect-error aliases are strings
			input: z.object({ region: z.string().meta({ alias: 1 }) }),
			run: () => {}
		})
	}
	expect(_typeCheck).toBeInstanceOf(Function)
})
