import type { Mock, mock } from 'bun:test'

export type PrismaMethodMock = Mock<(...args: unknown[]) => Promise<unknown>>

/**
 * A Prisma client where every model delegate and every method is a Bun mock,
 * created on first access, like `jest-mock-extended`'s `mockDeep()`.
 * `$`-prefixed client methods (`$transaction`, `$queryRaw`) are mocks too.
 */
export type DeepMockedPrisma<Client> = {
	[K in keyof Client]: Client[K] extends (...args: never[]) => unknown
		? PrismaMethodMock
		: { [Method in keyof Client[K]]: PrismaMethodMock }
} & {
	/** Resets every mock created so far. Call it in `beforeEach`. */
	$reset: () => void
}

/**
 * Builds a deep auto-mock of a Prisma client from Bun's `mock`. Register it
 * with `mock.module` in place of the module that exports your client.
 *
 * @example
 * import { mock } from 'bun:test'
 * import type { prisma } from '../lib/prisma'
 *
 * export const prismaMock = createPrismaMock<typeof prisma>(mock)
 * mock.module(prismaModulePath, () => ({ ...prismaExports, prisma: prismaMock }))
 *
 * prismaMock.user.findUnique.mockResolvedValue({ id: 'u1' })
 * expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' } })
 */
export function createPrismaMock<Client>(
	createMock: typeof mock
): DeepMockedPrisma<Client> {
	const created: PrismaMethodMock[] = []
	const reset = () => {
		for (const method of created) method.mockReset()
	}

	const methodsOf = (methods: Map<string, PrismaMethodMock>, key: string) => {
		let method = methods.get(key)
		if (!method) {
			method = createMock() as unknown as PrismaMethodMock
			created.push(method)
			methods.set(key, method)
		}
		return method
	}

	const delegates = new Map<string, object>()
	const rootMethods = new Map<string, PrismaMethodMock>()

	const delegateFor = (model: string) => {
		let delegate = delegates.get(model)
		if (!delegate) {
			const methods = new Map<string, PrismaMethodMock>()
			delegate = new Proxy(
				{},
				{
					get: (_target, method) =>
						typeof method === 'symbol' ? undefined : methodsOf(methods, method)
				}
			)
			delegates.set(model, delegate)
		}
		return delegate
	}

	return new Proxy({} as DeepMockedPrisma<Client>, {
		get(_target, property) {
			if (property === '$reset') return reset
			if (typeof property === 'symbol') return undefined
			if (property.startsWith('$')) return methodsOf(rootMethods, property)
			return delegateFor(property)
		}
	})
}
