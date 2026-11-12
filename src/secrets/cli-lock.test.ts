import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireCliLock } from './cli-lock'

const lockFile = () =>
	join(mkdtempSync(join(tmpdir(), 'hanzio-lock-')), 'nested', 'cli.lock')
const signal = () => new AbortController().signal

test('concurrent acquisitions take turns', async () => {
	const file = lockFile()
	const order: string[] = []
	const hold = async (name: string) => {
		const release = await acquireCliLock(signal(), file)

		order.push(`${name} in`)
		await new Promise((resolve) => setTimeout(resolve, 30))
		order.push(`${name} out`)
		await release()
	}

	await Promise.all([hold('a'), hold('b')])

	expect(order).toEqual(
		order[0] === 'a in'
			? ['a in', 'a out', 'b in', 'b out']
			: ['b in', 'b out', 'a in', 'a out']
	)
	expect(existsSync(file)).toBe(false)
})

test('takes over a lock left by a dead process', async () => {
	const file = lockFile()
	const first = await acquireCliLock(signal(), file)

	// Pretend the holder crashed: its file names a pid that does not exist.
	writeFileSync(file, '2147483646')

	const release = await acquireCliLock(signal(), file)

	await release()
	await first()
})

test('waiting for the lock ends with the caller signal', async () => {
	const file = lockFile()
	const release = await acquireCliLock(signal(), file)
	const reason = new Error('deadline')

	await expect(acquireCliLock(AbortSignal.timeout(30), file)).rejects.toThrow()
	await expect(acquireCliLock(AbortSignal.abort(reason), file)).rejects.toBe(
		reason
	)
	await release()
})
