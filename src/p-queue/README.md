---
description: Promise queue with concurrency, priority, timeout, cancellation, and rate-limit controls.
---

# hanzio/p-queue

`hanzio/p-queue` is a small dependency-free promise queue inspired by
`p-queue`. Use it when you need to run async work with bounded concurrency,
priority ordering, basic rate limiting, or queue lifecycle hooks.

```ts
import PQueue from 'hanzio/p-queue'

const queue = new PQueue({ concurrency: 2 })

const results = await Promise.all([
	queue.add(async () => fetchUser('1')),
	queue.add(async () => fetchUser('2')),
	queue.add(async () => fetchUser('3'))
])

await queue.onIdle()
```

## Common Usage

### Limit Concurrency

```ts
const queue = new PQueue({ concurrency: 3 })

for (const id of userIds) {
	queue.add(async () => syncUser(id))
}

await queue.onIdle()
```

Only three tasks run at the same time. Queued tasks start as running tasks
finish.

### Add Multiple Tasks

```ts
const results = await queue.addAll([
	async () => 'first',
	async () => 'second'
])
```

`addAll` resolves results in the same order as the input functions.

### Pause And Resume

```ts
const queue = new PQueue({ autoStart: false })

queue.add(async () => syncUser('1'))
queue.add(async () => syncUser('2'))

queue.start()
await queue.onIdle()
```

Use `pause()` to stop starting new queued tasks. Running tasks continue.

```ts
queue.pause()
queue.start()
```

### Priority

Higher priority tasks run first. Tasks with the same priority keep FIFO order.

```ts
const queue = new PQueue({ concurrency: 1, autoStart: false })

queue.add(async () => 'low', { priority: 0, id: 'low' })
queue.add(async () => 'high', { priority: 10, id: 'high' })

queue.start()
```

You can update queued task priority by id before it starts:

```ts
queue.setPriority('low', 20)
```

### Timeout

Timeouts begin when the task starts running, not while it is waiting in the
queue.

```ts
import PQueue, { TimeoutError } from 'hanzio/p-queue'

const queue = new PQueue({ timeout: 1000 })

try {
	await queue.add(async () => slowTask())
} catch (error) {
	if (error instanceof TimeoutError) {
		console.log('Task timed out')
	}
}
```

Override the timeout per task:

```ts
await queue.add(async () => slowTask(), { timeout: 5000 })
```

### Cancellation

Pass an `AbortSignal` to remove a queued task or reject a running task. The task
also receives the same signal.

```ts
const controller = new AbortController()

const promise = queue.add(
	async ({ signal }) => {
		const response = await fetch(url, { signal })
		return response.json()
	},
	{ signal: controller.signal }
)

controller.abort(new Error('Cancelled'))
await promise
```

### Rate Limiting

Use `intervalCap` and `interval` to limit how many tasks start during a time
window.

```ts
const queue = new PQueue({
	concurrency: 5,
	intervalCap: 10,
	interval: 1000
})
```

Enable `strict` to use a sliding window instead of a fixed window.

```ts
const queue = new PQueue({
	intervalCap: 10,
	interval: 1000,
	strict: true
})
```

## Waiting For Queue State

```ts
await queue.onEmpty()
await queue.onIdle()
await queue.onPendingZero()
await queue.onSizeLessThan(10)
await queue.onRateLimit()
await queue.onRateLimitCleared()
```

- `onEmpty()` resolves when there are no queued tasks waiting to start.
- `onIdle()` resolves when there are no queued or running tasks.
- `onPendingZero()` resolves when all currently running tasks finish.
- `onSizeLessThan(limit)` resolves when `queue.size < limit`.
- `onRateLimit()` resolves when the queue becomes rate-limited.
- `onRateLimitCleared()` resolves when rate limiting clears.

## Events

```ts
queue.on('active', () => {
	console.log('A task started')
})

queue.on('completed', (result) => {
	console.log('Task completed', result)
})

queue.on('error', (error) => {
	console.error('Task failed', error)
})
```

Supported events:

- `add`
- `active`
- `completed`
- `error`
- `empty`
- `idle`
- `pendingZero`
- `next`
- `rateLimit`
- `rateLimitCleared`

Use `off(event, listener)` to remove a listener.

## State

```ts
queue.size
queue.pending
queue.isPaused
queue.isRateLimited
queue.isSaturated
queue.runningTasks
queue.concurrency = 5
queue.timeout = 2000
```

- `size` is the number of queued tasks waiting to start.
- `pending` is the number of running tasks.
- `runningTasks` returns task metadata for currently running tasks.
- `clear()` removes queued tasks but does not cancel tasks already running.

## Exports

```ts
import PQueue, {
	PriorityQueue,
	TimeoutError,
	type Options,
	type Queue,
	type QueueAddOptions,
	type TaskOptions
} from 'hanzio/p-queue'
```