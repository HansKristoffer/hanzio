import { afterAll, describe, expect, test } from 'bun:test'
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The bin's help, output and exit codes are public API: these pin them.
const bin = join(import.meta.dir, 'cli.ts')
const root = realpathSync(mkdtempSync(join(tmpdir(), 'hanzio-i18n-cli-')))
mkdirSync(join(root, 'platform'))
writeFileSync(join(root, 'platform/en.json'), '{"hi":"Hello"}')
writeFileSync(join(root, 'platform/da.json'), '{"hi":"Hej"}')
writeFileSync(
	join(root, 'i18n.config.mjs'),
	`export default { baseLocale: 'en', locales: ['en', 'da'], catalogs: [{ name: 'platform', dir: 'platform', generatedTypes: 'platform/types.ts' }] }`
)
afterAll(() => rmSync(root, { recursive: true, force: true }))

function run(...args: string[]) {
	const result = Bun.spawnSync([process.execPath, bin, ...args], { cwd: root })
	const clean = (text: Buffer) => text.toString().replaceAll(root, '<root>')
	return {
		code: result.exitCode,
		stdout: clean(result.stdout),
		stderr: clean(result.stderr)
	}
}

const globalHelp = `Global options:
  --config <string>  Config file (default: i18n.config.*)
`

describe('hanzio-i18n', () => {
	test('help', () => {
		expect(run('--help')).toEqual({
			code: 0,
			stderr: '',
			stdout: `hanzio-i18n

Usage: hanzio-i18n <command> [options]

Commands:
  check                  Validate the translation catalogs
  generate               Write each catalog's generatedTypes
  completion <bash|zsh>  Print a shell completion script

Options:
  --config <string>  Config file (default: i18n.config.*)
  -h, --help         Show help

Run "hanzio-i18n <command> --help" for a command's options.
`
		})
	})

	test('bad arguments exit 2', () => {
		const result = run('chek')
		expect(result.code).toBe(2)
		expect(result.stderr).toBe(
			'Unknown command "chek". Did you mean "check"?\nRun "hanzio-i18n --help" for usage.\n'
		)
	})

	test('a missing config exits 1', () => {
		expect(run('check', '--config', 'missing.mjs')).toEqual({
			code: 1,
			stdout: '',
			stderr: 'No i18n config found: pass --config or add i18n.config.ts.\n'
		})
	})

	test('generate', () => {
		expect(run('generate', '--help')).toEqual({
			code: 0,
			stderr: '',
			stdout: `Usage: hanzio-i18n generate [options]

Write each catalog's generatedTypes

Options:
  -h, --help  Show help

${globalHelp}`
		})
		expect(run('generate')).toEqual({
			code: 0,
			stderr: '',
			stdout: 'Generated <root>/platform/types.ts\n'
		})
		expect(readFileSync(join(root, 'platform/types.ts'), 'utf8')).toContain(
			"'hi': never"
		)
	})

	// Runs after `generate`, so the generated types are current.
	test('check', () => {
		expect(run('check', '--help')).toEqual({
			code: 0,
			stderr: '',
			stdout: `Usage: hanzio-i18n check [options]

Validate the translation catalogs

Options:
  -h, --help  Show help

${globalHelp}`
		})
		expect(run('--config', 'i18n.config.mjs', 'check')).toEqual({
			code: 0,
			stderr: '',
			stdout: '✅ platform: 2 locale(s) valid\n'
		})
		writeFileSync(join(root, 'platform/da.json'), '{"hi":"Hej","x":"y"}')
		expect(run('check')).toEqual({
			code: 1,
			stdout: '',
			stderr:
				'❌ platform/da: stale key(s) not in en.json: x\n1 catalog problem(s)\n'
		})
	})
})
