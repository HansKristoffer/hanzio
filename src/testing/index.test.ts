import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
	createPrismaMock,
	createTestStorage,
	installWindowShim,
	ModuleMocker,
	mockCallArg,
	noopLogger
} from '.'

const fixtureDir = mkdtempSync(path.join(tmpdir(), 'hanzio-module-mocker-'))
const fixture = path.join(fixtureDir, 'greeting.ts')
writeFileSync(
	fixture,
	`export const greeting = 'hello'
export const farewell = 'bye'
export const shout = (text: string) => \`\${text.toUpperCase()}!\`
`
)

describe('ModuleMocker', () => {
	const moduleMocker = new ModuleMocker()
	afterEach(() => moduleMocker.clear())

	test('a partial mock keeps the exports it does not override', async () => {
		await moduleMocker.mock(fixture, () => ({ greeting: 'mocked' }))

		const during = await import(fixture)
		expect(during.greeting).toBe('mocked')
		expect(during.farewell).toBe('bye')
		expect(during.shout('hi')).toBe('HI!')
	})

	test('clear restores the original module', async () => {
		await moduleMocker.mock(fixture, () => ({ greeting: 'mocked' }))
		moduleMocker.clear()

		expect((await import(fixture)).greeting).toBe('hello')
	})

	test('resolves shorthand specifiers through the resolver', async () => {
		const aliased = new ModuleMocker((specifier) =>
			path.join(fixtureDir, specifier.replace('@/', ''))
		)
		await aliased.mock('@/greeting.ts', () => ({ farewell: 'ciao' }))
		expect((await import(fixture)).farewell).toBe('ciao')
		aliased.clear()
		expect((await import(fixture)).farewell).toBe('bye')
	})
})

type FakePrisma = {
	user: {
		findUnique: (args: { where: { id: string } }) => Promise<unknown>
		create: (args: unknown) => Promise<unknown>
	}
	$transaction: (fn: unknown) => Promise<unknown>
}

describe('createPrismaMock', () => {
	test('auto-creates a stable mock per model method', async () => {
		const prisma = createPrismaMock<FakePrisma>(mock)
		prisma.user.findUnique.mockResolvedValue({ id: 'u1' })

		expect(await prisma.user.findUnique({ where: { id: 'u1' } })).toEqual({
			id: 'u1'
		})
		expect(prisma.user.findUnique).toBe(prisma.user.findUnique)
		expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' } })
		expect(prisma.$transaction).toBe(prisma.$transaction)
	})

	test('$reset clears every created mock', async () => {
		const prisma = createPrismaMock<FakePrisma>(mock)
		prisma.user.create.mockResolvedValue('created')
		await prisma.user.create({})

		prisma.$reset()
		expect(prisma.user.create).not.toHaveBeenCalled()
		expect(await prisma.user.create({})).toBeUndefined()
	})
})

function typeTests() {
	const prisma = createPrismaMock<FakePrisma>(mock)
	prisma.user.findUnique.mockResolvedValue(null)
	// @ts-expect-error models the client does not have are not mocked
	prisma.post.findMany.mockResolvedValue([])
	// @ts-expect-error neither are methods missing from a delegate
	prisma.user.upsert.mockResolvedValue(null)
}
void typeTests

type ShimmedGlobal = {
	window?: {
		location: URL
		localStorage: Storage
		addEventListener: (...args: unknown[]) => void
	}
}

describe('installWindowShim', () => {
	test('keeps its own shape when a test assigns a partial window', () => {
		const global = globalThis as ShimmedGlobal
		const reset = installWindowShim('http://localhost:3000/app?x=1')
		const listen = mock(() => {})
		const window = () => global.window!
		expect(window().location.pathname).toBe('/app')

		global.window = { addEventListener: listen } as never
		window().addEventListener('storage', () => {})
		expect(listen).toHaveBeenCalledTimes(1)
		expect(window().location.origin).toBe('http://localhost:3000')

		window().localStorage.setItem('key', 'value')
		reset()
		expect(window().localStorage.getItem('key')).toBeNull()
		expect(window().addEventListener).not.toBe(listen)
		delete global.window
	})

	test('createTestStorage implements the Storage API', () => {
		const storage = createTestStorage()
		storage.setItem('a', '1')
		storage.setItem('b', '2')
		expect(storage.length).toBe(2)
		expect(storage.key(1)).toBe('b')
		storage.removeItem('a')
		expect(storage.getItem('a')).toBeNull()
		storage.clear()
		expect(storage.length).toBe(0)
	})
})

describe('helpers', () => {
	test('mockCallArg reads a typed call argument', () => {
		const fn = mock((_input: { id: string }, _flag?: boolean) => {})
		fn({ id: 'first' })
		fn({ id: 'second' }, true)
		expect(mockCallArg<{ id: string }>(fn, 1).id).toBe('second')
		expect(mockCallArg<boolean>(fn, 1, 1)).toBe(true)
		expect(mockCallArg(fn, 5)).toBeUndefined()
	})

	test('noopLogger binds to itself', () => {
		expect(noopLogger.bind({ scope: 'x' }).child()).toBe(noopLogger)
		noopLogger.error('ignored')
	})
})
