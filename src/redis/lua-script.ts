/** One raw Redis command, e.g. `(command, args) => redis.getClient().send(command, args)`. */
export type RedisSend = (command: string, args: string[]) => Promise<unknown>

function isNoScriptError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error)
	return message.includes('NOSCRIPT')
}

/**
 * Ship a Lua script by SHA instead of resending its source on every call.
 *
 * Redis forgets its script cache on restart and on `SCRIPT FLUSH`, so a
 * `NOSCRIPT` reply falls back to an inline `EVAL` (which repopulates the cache)
 * and drops the stale digest.
 *
 * The digest is cached per instance rather than per module so each limiter -
 * and each test fake - owns its own cache.
 */
export function createLuaScript(send: RedisSend, source: string) {
	let sha: string | null = null
	let loading: Promise<string> | null = null

	function load() {
		loading ??= send('SCRIPT', ['LOAD', source])
			.then(String)
			.finally(() => {
				loading = null
			})
		return loading
	}

	return async function evalScript(keys: string[], args: string[]) {
		const tail = [String(keys.length), ...keys, ...args]
		sha ??= await load()
		try {
			return await send('EVALSHA', [sha, ...tail])
		} catch (error) {
			if (!isNoScriptError(error)) throw error
			sha = null
			return await send('EVAL', [source, ...tail])
		}
	}
}
