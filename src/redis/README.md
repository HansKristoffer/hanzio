---
description: Bun Redis client that reconnects and shares subscriptions, plus a fleet-wide concurrency limiter built on Lua scripts.
---

# hanzio/redis

For Bun servers. The client wraps `Bun.RedisClient`; the limiter takes any
`send(command, args)` function, so it also works with other clients.

```ts
import {
	createLuaScript,
	createManagedRedis,
	createRedisConcurrencyLimit
} from 'hanzio/redis'
```

## Managed client

```ts
export const redis = createManagedRedis({
	url: () => getSecret('REDIS_URL'),
	onError: (error, { role, stage, channel }) =>
		captureException(error, 'redis', { role, stage, channel })
})

await redis.getClient().set('key', 'value')

const unsubscribe = await redis.subscribe('orders', (message, channel) => {
	handle(JSON.parse(message))
})
await unsubscribe()

redis.getStats() // { channelCount, channels, isConnected, isSubscriberConnected }
redis.close() // on shutdown
```

- `getClient()` returns one shared command connection. Both connections retry
  forever (Bun gives up after about 20 seconds by default) and queue commands
  while offline. If Bun closes one permanently, the next call builds a new one.
- `subscribe` shares one Redis `SUBSCRIBE` per channel, however many handlers
  listen. The channel is unsubscribed when its last handler leaves. After a
  reconnect, or a replaced subscriber connection, every channel is subscribed
  again. A failed `SUBSCRIBE` rejects and leaves nothing behind.
- `onError` receives every failure: a connection that closed unexpectedly
  (`stage: 'close'`), a failed subscribe, resubscribe or unsubscribe, and a
  handler that threw. It defaults to `console.error`. It is not throttled, so
  throttle error tracking yourself if a Redis outage would flood it.
- `close()` closes both connections. Errors caused by the close itself, such as
  an in-flight unsubscribe rejected with "Connection closed", are not reported.
- `createClient(url, options)` replaces `new Bun.RedisClient(url, options)`,
  for example in tests.

## Concurrency limiter

`createRedisConcurrencyLimit` is a semaphore shared by every process: at most
`max` callbacks run at once for `key`.

```ts
const withOpenAiSlot = createRedisConcurrencyLimit({
	key: 'openai',
	max: 20,
	slotTtlMs: 30_000,
	maxStartsPerSecond: 10, // optional: also cap starts in a sliding 1s window
	send: (command, args) => redis.getClient().send(command, args)
})

const reply = await withOpenAiSlot(() => openai.chat(request), signal)

// After a 429 with Retry-After, pause every process together:
await withOpenAiSlot.tripCooldown(retryAfterMs)
```

- Redis owns the clock (`TIME`), so drifting pod clocks cannot evict a slot
  that is still held.
- A held slot is renewed for as long as the callback runs. `slotTtlMs` is how
  quickly a crashed process's slots free themselves, not a time limit.
- Waiters in one process queue locally and are granted in one batched script
  call, so Redis traffic follows the cap, not the number of waiters.
- If Redis has been unreachable for `failOpenAfterMs` (15s) the limiter runs
  callbacks uncapped, and later calls skip Redis until a background probe sees
  it again. Commands time out after `commandTimeoutMs` (3s).
- Aborting `signal` stops waiting; a slot granted at the same moment is
  released.
- Keys use a hash tag (`{key}:inflight`), so the scripts work on Redis Cluster.

Metrics and logs are hooks:

```ts
const withLimit = createRedisConcurrencyLimit({
	...options,
	logger, // logger.warn(message, { key, error }), throttled; defaults to console
	metricLabel: 'openai', // defaults to key
	onWait: (stage, label) => {
		const timer = waitHistogram.startTimer({ pool: label, stage })
		return () => timer.stop()
	},
	onQueueDepth: (queueDepth, label) => queueDepthGauge.register(label, queueDepth)
})
```

A limiter created per tenant or per host should share one `metricLabel`, not
default to its key, and must be `dispose()`d when discarded. `dispose()` runs
the function `onQueueDepth` returned, so the gauge stops reading the limiter.

## Lua scripts

`createLuaScript(send, source)` sends a script by SHA (`EVALSHA`) and falls back
to `EVAL` when Redis has forgotten it after a restart or `SCRIPT FLUSH`.

```ts
const increment = createLuaScript(send, `return redis.call('INCRBY', KEYS[1], ARGV[1])`)
await increment(['counter'], ['2'])
```
