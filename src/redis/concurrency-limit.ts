import { createLuaScript, type RedisSend } from './lua-script.js'

const POLL_MS = 100
const FAILURE_LOG_THROTTLE_MS = 10_000
const DEFAULT_FAIL_OPEN_AFTER_MS = 15_000
const DEFAULT_COMMAND_TIMEOUT_MS = 3_000
const START_WINDOW_MS = 1_000
const MAX_COOLDOWN_MS = 5 * 60 * 1_000
const BREAKER_PROBE_INTERVAL_MS = 5_000
const MAX_RENEW_BATCH = 200

/**
 * Redis owns the clock. Pod clocks drift, and a client whose clock runs fast
 * would evict slots that are still held - breaching the cap it exists to guard.
 */
const NOW_MS_LUA = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
`

/**
 * Grants slots to as many of `ARGV[3..]` as fit under the cap, in order, and
 * reports the shared cooldown in the same round trip. Callers hand the whole
 * local waiting queue to one call, so Redis traffic tracks the cap rather than
 * the number of waiters.
 *
 * Returns `{grantedCount, waitMs}` - `waitMs > 0` means a cooldown is active.
 */
const ACQUIRE_SCRIPT = `
local inflightKey = KEYS[1]
local cooldownKey = KEYS[2]
local limit = tonumber(ARGV[1])
local ttlMs = tonumber(ARGV[2])
local cooldownMs = redis.call('PTTL', cooldownKey)
if cooldownMs > 0 then
  return {0, cooldownMs}
end
${NOW_MS_LUA}
redis.call('ZREMRANGEBYSCORE', inflightKey, '-inf', now)
local free = limit - redis.call('ZCARD', inflightKey)
local granted = 0
while granted < free and (granted + 3) <= #ARGV do
  redis.call('ZADD', inflightKey, now + ttlMs, ARGV[granted + 3])
  granted = granted + 1
end
if granted > 0 then
  redis.call('PEXPIRE', inflightKey, ttlMs)
end
return {granted, 0}
`.trim()

/**
 * Sliding window of *starts*. Unlike the slot cap, the window drains on a
 * known schedule, so an ungranted caller is told exactly when the oldest start
 * ages out instead of being left to poll.
 */
const START_SCRIPT = `
local startsKey = KEYS[1]
local cooldownKey = KEYS[2]
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local cooldownMs = redis.call('PTTL', cooldownKey)
if cooldownMs > 0 then
  return {0, cooldownMs}
end
${NOW_MS_LUA}
redis.call('ZREMRANGEBYSCORE', startsKey, '-inf', now - windowMs)
local free = limit - redis.call('ZCARD', startsKey)
local granted = 0
while granted < free and (granted + 3) <= #ARGV do
  redis.call('ZADD', startsKey, now, ARGV[granted + 3])
  granted = granted + 1
end
if granted > 0 then
  redis.call('PEXPIRE', startsKey, windowMs)
end
local waitMs = 0
if granted < (#ARGV - 2) then
  local oldest = redis.call('ZRANGE', startsKey, 0, 0, 'WITHSCORES')
  if oldest[2] then
    waitMs = math.ceil(tonumber(oldest[2]) + windowMs - now)
    if waitMs < 0 then
      waitMs = 0
    end
  end
end
return {granted, waitMs}
`.trim()

/**
 * Renews every slot this process still holds in one call. A member that has
 * already been evicted is left alone: re-adding it would breach the cap that
 * eviction just restored.
 */
const RENEW_SCRIPT = `
local key = KEYS[1]
local ttlMs = tonumber(ARGV[1])
${NOW_MS_LUA}
local renewed = 0
for i = 2, #ARGV do
  if redis.call('ZSCORE', key, ARGV[i]) then
    redis.call('ZADD', key, now + ttlMs, ARGV[i])
    renewed = renewed + 1
  end
end
if renewed > 0 then
  redis.call('PEXPIRE', key, ttlMs)
end
return renewed
`.trim()

const TRIP_COOLDOWN_SCRIPT = `
local key = KEYS[1]
local waitMs = tonumber(ARGV[1])
local ttl = redis.call('PTTL', key)
if ttl < waitMs then
  redis.call('SET', key, '1', 'PX', ARGV[1])
end
return 1
`.trim()

function withCommandTimeout(send: RedisSend, timeoutMs: number): RedisSend {
	return async (command, args) => {
		let timer: ReturnType<typeof setTimeout> | undefined
		try {
			return await Promise.race([
				send(command, args),
				new Promise<never>((_, reject) => {
					timer = setTimeout(
						() =>
							reject(new Error(`Redis command timed out after ${timeoutMs}ms`)),
						timeoutMs
					)
				})
			])
		} finally {
			if (timer) clearTimeout(timer)
		}
	}
}

// The pid tells a human which process holds a slot; it is absent outside Node and Bun.
function createToken() {
	const pid = globalThis.process?.pid
	return pid === undefined
		? crypto.randomUUID()
		: `${pid}:${crypto.randomUUID()}`
}

function jitterMs() {
	return Math.floor(Math.random() * POLL_MS)
}

// Background timers must not keep a process alive; `unref` is Node/Bun only.
function unref(timer: ReturnType<typeof setTimeout>) {
	;(timer as { unref?: () => void }).unref?.()
}

type GrantReply = { granted: number; waitMs: number }

function parseGrantReply(reply: unknown): GrantReply {
	const [granted, waitMs] = Array.isArray(reply) ? reply : []
	return {
		granted: Math.max(0, Number(granted) || 0),
		waitMs: Math.min(MAX_COOLDOWN_MS, Math.max(0, Number(waitMs) || 0))
	}
}

export type ConcurrencyLimitStage = 'slot' | 'start'

export type RedisConcurrencyLimitOptions = {
	key: string
	max: number
	slotTtlMs: number
	send: RedisSend
	maxStartsPerSecond?: number
	failOpenAfterMs?: number
	commandTimeoutMs?: number
	/** Receives throttled warnings with `{ key, error }`. Defaults to `console`. */
	logger?: { warn(message: string, attributes: Record<string, unknown>): void }
	/** The label `onWait` and `onQueueDepth` report under. Default: `key`. */
	metricLabel?: string
	/** Called when a caller starts queueing; the returned function runs once it stops. */
	onWait?: (
		stage: ConcurrencyLimitStage,
		metricLabel: string
	) => (() => void) | void
	/**
	 * Called once with `queueDepth`, to register a gauge; the returned function
	 * runs on `dispose()`.
	 */
	onQueueDepth?: (
		queueDepth: () => number,
		metricLabel: string
	) => (() => void) | void
}

export type RedisConcurrencyLimit = {
	<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T>
	tripCooldown: (retryAfterMs: number) => Promise<void>
	/** Callers in this process waiting for a slot or a start, e.g. for a gauge. */
	queueDepth: () => number
	/** Drop this limiter's timers. See `createRedisConcurrencyLimit`. */
	dispose: () => void
}

/**
 * Redis semaphore shared by every process. Returns `withLimit(run)` - at most
 * `max` callbacks in flight for `key`.
 *
 * A held slot is heartbeated for as long as `run` lasts, so `slotTtlMs` is a
 * crash-detection window rather than a run budget: slots leaked by a killed pod
 * free themselves within one TTL, while slow-but-alive work keeps its slot.
 *
 * `maxStartsPerSecond` is a separate sliding 1s window of *starts*. Use it when
 * the provider quota is requests-per-second (Cloudflare Quick Actions) so
 * in-flight concurrency can sit higher than the start rate.
 *
 * `tripCooldown` writes a shared pause from an upstream `Retry-After` so every
 * process backs off together instead of stampeding into 429s.
 *
 * Waiters inside one process queue locally and are handed to Redis in a single
 * batched call, so a pod with hundreds of callers costs the same Redis traffic
 * as one with a handful.
 *
 * When Redis itself is unreachable for `failOpenAfterMs` the limiter gives up
 * and runs uncapped. Callers guard a third-party quota; degrading to the
 * provider's own rate limit beats hanging every caller until Redis returns.
 * That verdict is shared per limiter: once tripped, later calls degrade
 * immediately while a background probe watches for Redis to come back.
 *
 * `onWait` and `onQueueDepth` feed metrics under `metricLabel`. A limiter
 * minted per tenant or per customer host should share one pool label rather
 * than default to its key, or every key ever touched leaves a permanent
 * series. Call `dispose()` when such a limiter is discarded; it also runs the
 * unregister function `onQueueDepth` returned.
 *
 * @example
 * const withLimit = createRedisConcurrencyLimit({
 *   key: 'openai',
 *   max: 20,
 *   slotTtlMs: 30_000,
 *   send: (command, args) => redis.getClient().send(command, args)
 * })
 * const reply = await withLimit(() => openai.chat(request), signal)
 */
export function createRedisConcurrencyLimit(
	input: RedisConcurrencyLimitOptions
): RedisConcurrencyLimit {
	if (!Number.isInteger(input.max) || input.max < 1)
		throw new Error(`max must be a positive integer, got ${input.max}`)
	const logger = input.logger ?? console
	const metricLabel = input.metricLabel ?? input.key
	const commandTimeoutMs = input.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
	const send = withCommandTimeout(input.send, commandTimeoutMs)
	const ttlMs = String(input.slotTtlMs)
	const renewEveryMs = Math.max(100, Math.floor(input.slotTtlMs / 3))
	const failOpenAfterMs = input.failOpenAfterMs ?? DEFAULT_FAIL_OPEN_AFTER_MS
	const maxStartsPerSecond = input.maxStartsPerSecond

	// Hash tags keep the multi-key scripts on one slot under Redis Cluster.
	// Renaming the inflight key means a rolling deploy briefly enforces the cap
	// twice over; that resolves within one `slotTtlMs`.
	const inflightKey = `{${input.key}}:inflight`
	const startsKey = `{${input.key}}:starts`
	const cooldownKey = `{${input.key}}:cooldown`

	const acquireScript = createLuaScript(send, ACQUIRE_SCRIPT)
	const startScript = createLuaScript(send, START_SCRIPT)
	const renewScript = createLuaScript(send, RENEW_SCRIPT)
	const tripScript = createLuaScript(send, TRIP_COOLDOWN_SCRIPT)

	const lastFailureLogAtMs = new Map<string, number>()

	function logFailure(message: string, error: unknown) {
		const nowMs = Date.now()
		if (
			nowMs - (lastFailureLogAtMs.get(message) ?? 0) <
			FAILURE_LOG_THROTTLE_MS
		)
			return
		lastFailureLogAtMs.set(message, nowMs)
		logger.warn(message, { key: input.key, error })
	}

	// ---------------------------------------------------------------- breaker

	let firstFailureAtMs: number | null = null
	let degraded = false
	let probeTimer: ReturnType<typeof setTimeout> | null = null

	function scheduleProbe() {
		if (probeTimer) return
		probeTimer = setTimeout(() => {
			probeTimer = null
			void probeRedis()
		}, BREAKER_PROBE_INTERVAL_MS)
		unref(probeTimer)
	}

	/** A zero-token acquire reads the cap without taking a slot. */
	async function probeRedis() {
		try {
			await acquireScript(
				[inflightKey, cooldownKey],
				[String(input.max), ttlMs]
			)
			noteRedisSuccess()
		} catch (error) {
			logFailure('Redis concurrency probe failed', error)
			scheduleProbe()
		}
	}

	function noteRedisSuccess() {
		firstFailureAtMs = null
		if (!degraded) return
		degraded = false
		if (probeTimer) {
			clearTimeout(probeTimer)
			probeTimer = null
		}
		logger.warn('Redis reachable again, concurrency limiting re-enabled', {
			key: input.key
		})
	}

	/** True once Redis has been down long enough that callers should run uncapped. */
	function noteRedisFailure(error: unknown) {
		logFailure('Redis concurrency command failed, retrying', error)
		if (degraded) return true
		firstFailureAtMs ??= Date.now()
		if (Date.now() - firstFailureAtMs < failOpenAfterMs) return false
		degraded = true
		scheduleProbe()
		logger.warn('Redis unreachable, running without a concurrency slot', {
			key: input.key
		})
		return true
	}

	// ------------------------------------------------------------------- pump

	type Waiter = { token: string; settle: (grantedSlot: boolean) => void }

	/**
	 * One loop per limiter drains a local FIFO: waiters are batched into a single
	 * script call, granted in order, and the remainder waits out the hint the
	 * script returned. Jitter keeps the fleet from retrying in lockstep after a
	 * shared cooldown expires.
	 */
	function createPump(
		stage: ConcurrencyLimitStage,
		maxBatch: number,
		grant: (tokens: string[]) => Promise<GrantReply>
	) {
		const queue: Waiter[] = []
		let running = false
		let wakeSleeper: (() => void) | null = null

		// Deliberately not unref'd: a caller is awaiting this sleep, so it has to
		// hold the event loop open the way `Bun.sleep` would.
		function sleep(ms: number) {
			return new Promise<void>((resolve) => {
				const timer = setTimeout(() => {
					wakeSleeper = null
					resolve()
				}, ms)
				wakeSleeper = () => {
					wakeSleeper = null
					clearTimeout(timer)
					resolve()
				}
			})
		}

		function settleAll(grantedSlot: boolean) {
			for (const waiter of queue.splice(0)) waiter.settle(grantedSlot)
		}

		async function loop() {
			running = true
			try {
				// Callers usually arrive as a synchronous burst (one `map` over a page
				// list). Yielding once lets the whole burst land in the first batch.
				await Promise.resolve()
				while (queue.length > 0) {
					let reply: GrantReply
					try {
						reply = await grant(
							queue.slice(0, maxBatch).map((waiter) => waiter.token)
						)
						noteRedisSuccess()
					} catch (error) {
						if (noteRedisFailure(error)) {
							settleAll(false)
							continue
						}
						await sleep(POLL_MS + jitterMs())
						continue
					}

					for (const waiter of queue.splice(0, reply.granted))
						waiter.settle(true)
					if (queue.length === 0) break
					await sleep((reply.waitMs || POLL_MS) + jitterMs())
				}
			} finally {
				running = false
			}
		}

		return {
			depth: () => queue.length,
			/** Resolves true once the token holds a slot, false when failing open. */
			acquire(token: string) {
				const stopWait = input.onWait?.(stage, metricLabel)
				const granted = new Promise<boolean>((resolve) => {
					queue.push({ token, settle: resolve })
				})
				// Deliberately no wake here: a burst of arrivals must not turn the
				// poll interval into a spin. Only a freed slot cuts the wait short.
				if (!running) void loop()
				return stopWait ? granted.finally(stopWait) : granted
			},
			/** Retry now - a slot this process held just came free. */
			wake() {
				wakeSleeper?.()
			}
		}
	}

	const slotPump = createPump('slot', input.max, async (tokens) =>
		parseGrantReply(
			await acquireScript(
				[inflightKey, cooldownKey],
				[String(input.max), ttlMs, ...tokens]
			)
		)
	)

	const startPump =
		maxStartsPerSecond === undefined
			? null
			: createPump('start', maxStartsPerSecond, async (tokens) =>
					parseGrantReply(
						await startScript(
							[startsKey, cooldownKey],
							[String(maxStartsPerSecond), String(START_WINDOW_MS), ...tokens]
						)
					)
				)

	const queueDepth = () => slotPump.depth() + (startPump?.depth() ?? 0)
	let unregisterQueueDepth = input.onQueueDepth?.(queueDepth, metricLabel)

	// -------------------------------------------------------------- heartbeat

	const heldTokens = new Set<string>()
	let heartbeatTimer: ReturnType<typeof setTimeout> | null = null

	function scheduleHeartbeat() {
		if (heartbeatTimer || heldTokens.size === 0) return
		heartbeatTimer = setTimeout(() => {
			heartbeatTimer = null
			void renewHeldSlots()
		}, renewEveryMs)
		unref(heartbeatTimer)
	}

	/** One call covers every slot this process holds, however many are in flight. */
	async function renewHeldSlots() {
		const tokens = [...heldTokens]
		for (let index = 0; index < tokens.length; index += MAX_RENEW_BATCH) {
			try {
				await renewScript(
					[inflightKey],
					[ttlMs, ...tokens.slice(index, index + MAX_RENEW_BATCH)]
				)
				noteRedisSuccess()
			} catch (error) {
				logFailure('Failed to renew Redis concurrency slots', error)
			}
		}
		scheduleHeartbeat()
	}

	// ---------------------------------------------------------------- release

	let pendingReleases: string[] = []
	let releaseFlush: Promise<void> | null = null

	/** Slots freed in the same tick leave in one `ZREM`. */
	function release(token: string) {
		pendingReleases.push(token)
		releaseFlush ??= (async () => {
			await Promise.resolve()
			const tokens = pendingReleases
			pendingReleases = []
			releaseFlush = null
			try {
				// Redis drops the sorted set once the last member leaves, so no
				// explicit key cleanup is needed here.
				await send('ZREM', [inflightKey, ...tokens])
				noteRedisSuccess()
			} catch (error) {
				logFailure('Failed to release Redis concurrency slot', error)
			}
			slotPump.wake()
		})()
		return releaseFlush
	}

	async function tripCooldown(retryAfterMs: number) {
		const waitMs = Math.min(
			MAX_COOLDOWN_MS,
			Math.max(0, Math.ceil(retryAfterMs))
		)
		if (waitMs === 0) return
		try {
			await tripScript([cooldownKey], [String(waitMs)])
		} catch (error) {
			logFailure('Failed to trip Redis rate-limit cooldown', error)
		}
	}

	/** Abort promptly; a Redis grant already in flight must still be released. */
	async function waitForGrant(
		pending: Promise<boolean>,
		signal: AbortSignal | undefined,
		lateGrant: () => void
	) {
		if (!signal) return pending
		let aborted = false
		let abort: (() => void) | undefined
		try {
			return await Promise.race([
				pending.then((granted) => {
					if (aborted && granted) lateGrant()
					return granted
				}),
				new Promise<never>((_, reject) => {
					abort = () => {
						aborted = true
						reject(signal.reason)
					}
					signal.addEventListener('abort', abort, { once: true })
					if (signal.aborted) abort()
				})
			])
		} finally {
			if (abort) signal.removeEventListener('abort', abort)
		}
	}

	async function withRedisConcurrencyLimit<T>(
		run: () => Promise<T>,
		signal?: AbortSignal
	) {
		signal?.throwIfAborted()
		if (degraded) return run()

		const token = createToken()
		const granted = await waitForGrant(slotPump.acquire(token), signal, () => {
			void release(token)
		})
		if (!granted) {
			signal?.throwIfAborted()
			return run()
		}

		heldTokens.add(token)
		scheduleHeartbeat()
		try {
			// A start token is never released - it ages out of the sliding window.
			if (startPump)
				await waitForGrant(startPump.acquire(createToken()), signal, () => {})
			signal?.throwIfAborted()
			return await run()
		} finally {
			heldTokens.delete(token)
			await release(token)
		}
	}

	/**
	 * Only for limiters that are created on demand. Callers hold no slot by the
	 * time they discard one - `withRedisConcurrencyLimit` awaits its release
	 * before it resolves - so there is nothing left to heartbeat.
	 */
	function dispose() {
		unregisterQueueDepth?.()
		unregisterQueueDepth = undefined
		if (probeTimer) {
			clearTimeout(probeTimer)
			probeTimer = null
		}
		if (heartbeatTimer) {
			clearTimeout(heartbeatTimer)
			heartbeatTimer = null
		}
	}

	return Object.assign(withRedisConcurrencyLimit, {
		tripCooldown,
		queueDepth,
		dispose
	})
}
