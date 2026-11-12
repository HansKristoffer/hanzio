const STALE_LOCK_MS = 30_000

/**
 * Hold a machine-wide lock so concurrent processes run the Infisical CLI one
 * at a time; parallel `infisical user get token` runs can hang. Resolves with
 * a release function. A lock older than 30 s, or naming a dead process, is
 * taken over. Waiting ends with the signal's reason.
 */
export async function acquireCliLock(
	signal: AbortSignal,
	file?: string
): Promise<() => Promise<void>> {
	const [fs, os, path] = await Promise.all([
		import('node:fs/promises'),
		import('node:os'),
		import('node:path')
	])
	const lock = file ?? path.join(os.homedir(), '.infisical', 'hanzio-cli.lock')

	// The lock only prevents a hang; a home folder we cannot write to (a
	// read-only container) runs the CLI unlocked rather than failing the load.
	const unlocked = async () => {}

	try {
		await fs.mkdir(path.dirname(lock), { recursive: true, mode: 0o700 })
	} catch {
		return unlocked
	}

	for (;;) {
		signal.throwIfAborted()

		try {
			const handle = await fs.open(lock, 'wx', 0o600)

			try {
				await handle.writeFile(String(process.pid))
			} finally {
				await handle.close()
			}

			return () => fs.unlink(lock).catch(() => {})
		} catch (error) {
			if ((error as { code?: string }).code !== 'EEXIST') {
				return unlocked
			}
		}

		// ponytail: two waiters can both judge a lock stale and both unlink it;
		// harmless here, since the worst case is two CLI runs at once.
		if (await isStale(fs, lock)) {
			await fs.unlink(lock).catch(() => {})
			continue
		}

		await new Promise<void>((resolve, reject) => {
			const done = () => {
				clearTimeout(timer)
				reject(signal.reason)
			}
			const timer = setTimeout(
				() => {
					signal.removeEventListener('abort', done)
					resolve()
				},
				25 + Math.random() * 25
			)

			signal.addEventListener('abort', done, { once: true })
		})
	}
}

async function isStale(
	fs: typeof import('node:fs/promises'),
	lock: string
): Promise<boolean> {
	try {
		const [info, text] = await Promise.all([
			fs.stat(lock),
			fs.readFile(lock, 'utf8')
		])

		if (Date.now() - info.mtimeMs > STALE_LOCK_MS) {
			return true
		}

		const pid = Number(text)

		// An empty file is a lock being written right now.
		if (!Number.isInteger(pid) || pid <= 0) {
			return false
		}

		process.kill(pid, 0)

		return false
	} catch (error) {
		// ESRCH: no such process. ENOENT: released while we looked; retry at once.
		const code = (error as { code?: string }).code

		return code === 'ESRCH' || code === 'ENOENT'
	}
}
