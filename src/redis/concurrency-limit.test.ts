import { describe, expect, expectTypeOf, test } from 'bun:test'
import { createRedisConcurrencyLimit } from './concurrency-limit.js'

const quiet = { warn: () => {} }

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((res) => {
		resolve = res
	})
	return { promise, resolve }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3_000) {
	const startedAt = Date.now()
	while (!predicate()) {
		if (Date.now() - startedAt > timeoutMs) {
			throw new Error('timed out waiting for limiter state')
		}
		await Bun.sleep(1)
	}
}

/**
 * Stands in for the sorted sets the Lua scripts operate on, including Redis'
 * clock (tests advance it explicitly to exercise slot expiry) and its script
 * cache (so `SCRIPT LOAD` / `EVALSHA` / `NOSCRIPT` behave like the real thing).
 */
function fakeRedis(input: {
	key: string
	max: number
	slotTtlMs: number
	maxStartsPerSecond?: number
}) {
	const inflightKey = `{${input.key}}:inflight`
	const startsKey = `{${input.key}}:starts`
	const cooldownKey = `{${input.key}}:cooldown`

	const members = new Map<string, number>()
	const starts = new Map<string, number>()
	let cooldownUntilWallMs = 0
	let nowMs = 1_000_000
	let renewals = 0

	const shaBySource = new Map<string, string>()
	const sourceBySha = new Map<string, string>()
	const cachedShas = new Set<string>()
	const calls = { scriptLoad: 0, evalsha: 0, evalInline: 0, acquire: 0 }

	function shaFor(source: string) {
		let sha = shaBySource.get(source)
		if (!sha) {
			sha = `sha-${shaBySource.size + 1}`
			shaBySource.set(source, sha)
			sourceBySha.set(sha, source)
		}
		return sha
	}

	function cooldownRemainingMs() {
		return cooldownUntilWallMs - Date.now()
	}

	function runScript(source: string, tail: string[]) {
		const numKeys = Number(tail[0])
		const keys = tail.slice(1, 1 + numKeys)
		const argv = tail.slice(1 + numKeys)

		if (source.includes('inflightKey')) {
			calls.acquire++
			expect(keys).toEqual([inflightKey, cooldownKey])
			expect(Number(argv[0])).toBe(input.max)
			expect(Number(argv[1])).toBe(input.slotTtlMs)

			const cooldownMs = cooldownRemainingMs()
			if (cooldownMs > 0) return [0, cooldownMs]

			for (const [member, expiresAt] of members) {
				if (expiresAt <= nowMs) members.delete(member)
			}
			let granted = 0
			for (const token of argv.slice(2)) {
				if (members.size >= input.max) break
				members.set(token, nowMs + input.slotTtlMs)
				granted++
			}
			return [granted, 0]
		}

		if (source.includes('startsKey')) {
			expect(keys).toEqual([startsKey, cooldownKey])
			expect(Number(argv[0])).toBe(input.maxStartsPerSecond ?? 0)

			const cooldownMs = cooldownRemainingMs()
			if (cooldownMs > 0) return [0, cooldownMs]

			const windowMs = Number(argv[1])
			for (const [member, startedAt] of starts) {
				if (startedAt <= nowMs - windowMs) starts.delete(member)
			}
			const tokens = argv.slice(2)
			let granted = 0
			for (const token of tokens) {
				if (starts.size >= (input.maxStartsPerSecond ?? 0)) break
				starts.set(token, nowMs)
				granted++
			}

			let waitMs = 0
			if (granted < tokens.length && starts.size > 0) {
				const oldest = Math.min(...starts.values())
				waitMs = Math.max(0, oldest + windowMs - nowMs)
			}
			return [granted, waitMs]
		}

		if (source.includes('local renewed')) {
			expect(keys).toEqual([inflightKey])
			expect(Number(argv[0])).toBe(input.slotTtlMs)
			let renewed = 0
			for (const token of argv.slice(1)) {
				if (!members.has(token)) continue
				members.set(token, nowMs + input.slotTtlMs)
				renewals++
				renewed++
			}
			return renewed
		}

		expect(keys).toEqual([cooldownKey])
		const waitMs = Number(argv[0])
		if (waitMs > cooldownRemainingMs()) {
			cooldownUntilWallMs = Date.now() + waitMs
		}
		return 1
	}

	async function send(command: string, args: string[]) {
		if (command === 'ZREM') {
			expect(args[0]).toBe(inflightKey)
			for (const token of args.slice(1)) members.delete(token)
			return 1
		}

		if (command === 'SCRIPT') {
			expect(args[0]).toBe('LOAD')
			calls.scriptLoad++
			const sha = shaFor(args[1]!)
			cachedShas.add(sha)
			return sha
		}

		if (command === 'EVALSHA') {
			const sha = args[0]!
			if (!cachedShas.has(sha)) {
				throw new Error('NOSCRIPT No matching script. Please use EVAL.')
			}
			calls.evalsha++
			return runScript(sourceBySha.get(sha)!, args.slice(1))
		}

		expect(command).toBe('EVAL')
		calls.evalInline++
		const source = args[0]!
		// An inline EVAL repopulates the server-side cache, same as real Redis.
		cachedShas.add(shaFor(source))
		return runScript(source, args.slice(1))
	}

	return {
		send,
		members,
		starts,
		calls,
		renewalCount: () => renewals,
		/** Simulates a Redis restart or `SCRIPT FLUSH`. */
		flushScripts: () => cachedShas.clear(),
		advance: (ms: number) => {
			nowMs += ms
		}
	}
}

describe('createRedisConcurrencyLimit', () => {
	test('never runs more than max tasks at once', async () => {
		const max = 3
		const redis = fakeRedis({ key: 'test:inflight', max, slotTtlMs: 30_000 })
		const withLimit = createRedisConcurrencyLimit({
			key: 'test:inflight',
			max,
			slotTtlMs: 30_000,
			send: redis.send
		})

		let current = 0
		let peak = 0
		const started = Array.from({ length: max + 5 }, () => deferred<void>())

		const running = started.map(({ promise }) =>
			withLimit(async () => {
				current++
				peak = Math.max(peak, current)
				await promise
				current--
			})
		)

		try {
			await waitUntil(() => current === max)
			await Bun.sleep(10)
			expect(peak).toBe(max)
			expect(current).toBe(max)
		} finally {
			for (const { resolve } of started) resolve()
			await Promise.all(running)
		}
		expect(current).toBe(0)
		expect(redis.members.size).toBe(0)
	})

	test('grants a burst of waiters in a single acquire call', async () => {
		const max = 4
		const redis = fakeRedis({ key: 'test:inflight', max, slotTtlMs: 30_000 })
		const withLimit = createRedisConcurrencyLimit({
			key: 'test:inflight',
			max,
			slotTtlMs: 30_000,
			send: redis.send
		})

		let started = 0
		const blockers = Array.from({ length: max }, () => deferred<void>())
		const running = blockers.map(({ promise }) =>
			withLimit(async () => {
				started++
				await promise
			})
		)

		try {
			await waitUntil(() => started === max)
			// The whole burst is handed to Redis at once, so waiter count does not
			// drive command count.
			expect(redis.calls.acquire).toBe(1)
		} finally {
			for (const { resolve } of blockers) resolve()
			await Promise.all(running)
		}
	})

	test('releases the slot after a thrown error', async () => {
		const redis = fakeRedis({ key: 'test:inflight', max: 1, slotTtlMs: 30_000 })
		const withLimit = createRedisConcurrencyLimit({
			key: 'test:inflight',
			max: 1,
			slotTtlMs: 30_000,
			send: redis.send
		})

		await expect(
			withLimit(async () => {
				throw new Error('boom')
			})
		).rejects.toThrow('boom')

		let ran = false
		await withLimit(async () => {
			ran = true
		})
		expect(ran).toBe(true)
	})

	test('reclaims a slot left behind by a crashed holder', async () => {
		const redis = fakeRedis({ key: 'test:inflight', max: 1, slotTtlMs: 1_000 })
		const withLimit = createRedisConcurrencyLimit({
			key: 'test:inflight',
			max: 1,
			slotTtlMs: 1_000,
			send: redis.send
		})

		redis.members.set('crashed-pod-token', 1_000_500)
		redis.advance(1_000)

		let ran = false
		await withLimit(async () => {
			ran = true
		})
		expect(ran).toBe(true)
		expect(redis.members.has('crashed-pod-token')).toBe(false)
	})

	test('heartbeats the slot for as long as the task runs', async () => {
		const slotTtlMs = 300
		const redis = fakeRedis({ key: 'test:inflight', max: 1, slotTtlMs })
		const withLimit = createRedisConcurrencyLimit({
			key: 'test:inflight',
			max: 1,
			slotTtlMs,
			send: redis.send
		})

		await withLimit(async () => {
			// Outlives the TTL: without renewal the slot would be up for grabs.
			await waitUntil(() => redis.renewalCount() >= 2)
			redis.advance(slotTtlMs)
			expect([...redis.members.values()][0]).toBeGreaterThan(1_000_000)
		})

		expect(redis.renewalCount()).toBeGreaterThanOrEqual(2)
		expect(redis.members.size).toBe(0)
	})

	test('renews every slot the process holds in one call', async () => {
		const slotTtlMs = 300
		const redis = fakeRedis({ key: 'test:inflight', max: 3, slotTtlMs })
		const withLimit = createRedisConcurrencyLimit({
			key: 'test:inflight',
			max: 3,
			slotTtlMs,
			send: redis.send
		})

		const blockers = Array.from({ length: 3 }, () => deferred<void>())
		const running = blockers.map(({ promise }) => withLimit(() => promise))

		try {
			await waitUntil(() => redis.members.size === 3)
			const before = redis.calls.evalsha
			// Three renewals recorded, but they arrive on a single variadic call.
			await waitUntil(() => redis.renewalCount() >= 3)
			expect(redis.calls.evalsha - before).toBe(1)
		} finally {
			for (const { resolve } of blockers) resolve()
			await Promise.all(running)
		}
	})

	test('caps how many runs start per second', async () => {
		const redis = fakeRedis({
			key: 'test:inflight',
			max: 8,
			slotTtlMs: 30_000,
			maxStartsPerSecond: 2
		})
		const withLimit = createRedisConcurrencyLimit({
			key: 'test:inflight',
			max: 8,
			slotTtlMs: 30_000,
			maxStartsPerSecond: 2,
			send: redis.send
		})

		let started = 0
		const blockers = Array.from({ length: 4 }, () => deferred<void>())
		const running = blockers.map(({ promise }) =>
			withLimit(async () => {
				started++
				await promise
			})
		)

		try {
			await waitUntil(() => started === 2)
			await Bun.sleep(20)
			expect(started).toBe(2)
			expect(redis.starts.size).toBe(2)
			redis.advance(1_000)
			await waitUntil(() => started === 4)
		} finally {
			for (const { resolve } of blockers) resolve()
			await Promise.all(running)
		}
	})

	test('tripCooldown pauses new acquires until the wait elapses', async () => {
		const redis = fakeRedis({ key: 'test:inflight', max: 2, slotTtlMs: 30_000 })
		const withLimit = createRedisConcurrencyLimit({
			key: 'test:inflight',
			max: 2,
			slotTtlMs: 30_000,
			send: redis.send
		})

		await withLimit.tripCooldown(80)
		let ran = false
		const pending = withLimit(async () => {
			ran = true
		})
		await Bun.sleep(20)
		expect(ran).toBe(false)
		await pending
		expect(ran).toBe(true)
	})

	test('reloads the script after Redis forgets its cache', async () => {
		const redis = fakeRedis({ key: 'test:inflight', max: 1, slotTtlMs: 30_000 })
		const withLimit = createRedisConcurrencyLimit({
			key: 'test:inflight',
			max: 1,
			slotTtlMs: 30_000,
			send: redis.send
		})

		await withLimit(async () => {})
		expect(redis.calls.evalInline).toBe(0)

		redis.flushScripts()

		let ran = false
		await withLimit(async () => {
			ran = true
		})
		expect(ran).toBe(true)
		// NOSCRIPT falls back to an inline EVAL rather than failing the caller.
		expect(redis.calls.evalInline).toBeGreaterThan(0)
	})

	test('runs uncapped once Redis has been unreachable long enough', async () => {
		const withLimit = createRedisConcurrencyLimit({
			key: 'test:inflight',
			max: 1,
			slotTtlMs: 30_000,
			failOpenAfterMs: 50,
			logger: quiet,
			send: async () => {
				throw new Error('connection refused')
			}
		})

		let ran = false
		await withLimit(async () => {
			ran = true
		})
		expect(ran).toBe(true)
	})

	test('later callers degrade immediately instead of re-paying the trip', async () => {
		let commands = 0
		const withLimit = createRedisConcurrencyLimit({
			key: 'test:inflight',
			max: 1,
			slotTtlMs: 30_000,
			failOpenAfterMs: 50,
			logger: quiet,
			send: async () => {
				commands++
				throw new Error('connection refused')
			}
		})

		await withLimit(async () => {})
		const afterFirst = commands

		const startedAt = Date.now()
		let ran = false
		await withLimit(async () => {
			ran = true
		})

		expect(ran).toBe(true)
		expect(Date.now() - startedAt).toBeLessThan(50)
		expect(commands).toBe(afterFirst)
	})

	test('runs uncapped when Redis commands time out', async () => {
		const withLimit = createRedisConcurrencyLimit({
			key: 'test:inflight',
			max: 1,
			slotTtlMs: 30_000,
			failOpenAfterMs: 50,
			logger: quiet,
			commandTimeoutMs: 20,
			send: async () => {
				await Bun.sleep(100)
				return 1
			}
		})

		let ran = false
		await withLimit(async () => {
			ran = true
		})
		expect(ran).toBe(true)
	})

	test('reports queue depth and wait time through hooks', async () => {
		const redis = fakeRedis({ key: 'test:inflight', max: 1, slotTtlMs: 30_000 })
		const waits: string[] = []
		const withLimit = createRedisConcurrencyLimit({
			key: 'test:inflight',
			max: 1,
			slotTtlMs: 30_000,
			send: redis.send,
			onWait: (stage) => {
				waits.push(`start:${stage}`)
				return () => waits.push(`stop:${stage}`)
			}
		})

		const blocker = deferred<void>()
		const holding = withLimit(() => blocker.promise)
		const waiting = withLimit(async () => {})
		await waitUntil(() => redis.members.size === 1)
		expect(withLimit.queueDepth()).toBe(1)

		blocker.resolve()
		await Promise.all([holding, waiting])
		expect(withLimit.queueDepth()).toBe(0)
		expect(waits).toEqual([
			'start:slot',
			'start:slot',
			'stop:slot',
			'stop:slot'
		])
	})

	test('reports under metricLabel and unregisters the gauge on dispose', async () => {
		const redis = fakeRedis({ key: 'tenant:42', max: 1, slotTtlMs: 30_000 })
		const gauges = new Map<string, () => number>()
		const waits: string[] = []
		const withLimit = createRedisConcurrencyLimit({
			key: 'tenant:42',
			max: 1,
			slotTtlMs: 30_000,
			send: redis.send,
			metricLabel: 'tenants',
			onWait: (stage, label) => {
				waits.push(`${label}:${stage}`)
			},
			onQueueDepth: (depth, label) => {
				gauges.set(label, depth)
				return () => gauges.delete(label)
			}
		})

		await withLimit(async () => {})
		expect(waits).toEqual(['tenants:slot'])
		expect(gauges.get('tenants')?.()).toBe(0)

		withLimit.dispose()
		withLimit.dispose()
		expect(gauges.size).toBe(0)
	})

	test('logs warnings with their attributes', async () => {
		const warnings: [string, Record<string, unknown>][] = []
		const withLimit = createRedisConcurrencyLimit({
			key: 'test:inflight',
			max: 1,
			slotTtlMs: 30_000,
			failOpenAfterMs: 0,
			logger: {
				warn: (message, attributes) => {
					expectTypeOf(attributes).toEqualTypeOf<Record<string, unknown>>()
					warnings.push([message, attributes])
				}
			},
			send: async () => {
				throw new Error('connection refused')
			}
		})

		await withLimit(async () => {})
		withLimit.dispose()
		expect(warnings[0]?.[1]).toMatchObject({ key: 'test:inflight' })
	})
})
