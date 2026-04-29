export type RunFunction = () => Promise<unknown> | unknown

export type Queue<Element, Options> = {
	size: number
	filter: (options: Readonly<Partial<Options>>) => Element[]
	dequeue: () => Element | undefined
	enqueue: (run: Element, options?: Partial<Options>) => void
	setPriority: (id: string, priority: number) => void
	remove?: (id: string) => void
}

export type TaskOptions = {
	readonly signal?: AbortSignal | undefined
}

type TimeoutOptions = {
	timeout?: number
}

export type QueueAddOptions = {
	readonly priority?: number
	id?: string
} & TaskOptions &
	TimeoutOptions

export type Options<
	QueueType extends Queue<RunFunction, QueueOptions> = PriorityQueue,
	QueueOptions extends QueueAddOptions = QueueAddOptions
> = {
	readonly concurrency?: number
	readonly autoStart?: boolean
	readonly queueClass?: new () => QueueType
	readonly intervalCap?: number
	readonly interval?: number
	readonly carryoverIntervalCount?: boolean
	readonly carryoverConcurrencyCount?: boolean
	readonly strict?: boolean
} & TimeoutOptions

type Task<TaskResultType> =
	| ((options: TaskOptions) => PromiseLike<TaskResultType>)
	| ((options: TaskOptions) => TaskResultType)

type EventMap = {
	active: []
	idle: []
	empty: []
	add: []
	next: []
	completed: [unknown]
	error: [unknown]
	pendingZero: []
	rateLimit: []
	rateLimitCleared: []
}

type EventName = keyof EventMap
type Listener<Event extends EventName> = (
	...arguments_: EventMap[Event]
) => void

export class TimeoutError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'TimeoutError'
	}
}

export type PriorityQueueOptions = {
	priority?: number
} & QueueAddOptions

export class PriorityQueue implements Queue<RunFunction, PriorityQueueOptions> {
	readonly #queue: Array<PriorityQueueOptions & { run: RunFunction }> = []

	enqueue(run: RunFunction, options: Partial<PriorityQueueOptions> = {}): void {
		const element = {
			priority: options.priority ?? 0,
			id: options.id,
			run
		}

		const index = this.#queue.findIndex(
			(item) => item.priority! < element.priority
		)

		if (index === -1) {
			this.#queue.push(element)
			return
		}

		this.#queue.splice(index, 0, element)
	}

	dequeue(): RunFunction | undefined {
		return this.#queue.shift()?.run
	}

	filter(options: Readonly<Partial<PriorityQueueOptions>>): RunFunction[] {
		return this.#queue
			.filter((item) =>
				Object.entries(options).every(
					([key, value]) => item[key as keyof PriorityQueueOptions] === value
				)
			)
			.map((item) => item.run)
	}

	setPriority(id: string, priority: number): void {
		const index = this.#queue.findIndex((item) => item.id === id)

		if (index === -1) {
			throw new ReferenceError(
				`No promise function with the id "${id}" exists in the queue.`
			)
		}

		const [item] = this.#queue.splice(index, 1)
		this.enqueue(item!.run, { ...item, priority })
	}

	remove(id: string): void {
		const index = this.#queue.findIndex((item) => item.id === id)

		if (index !== -1) {
			this.#queue.splice(index, 1)
		}
	}

	get size(): number {
		return this.#queue.length
	}
}

export default class PQueue<
	QueueType extends Queue<RunFunction, EnqueueOptionsType> = PriorityQueue,
	EnqueueOptionsType extends QueueAddOptions = QueueAddOptions
> {
	readonly #listeners = new Map<EventName, Set<Listener<EventName>>>()
	#queue: QueueType
	readonly #queueClass: new () => QueueType
	#pending = 0
	#concurrency: number
	#isPaused: boolean
	readonly #intervalCap: number
	readonly #interval: number
	readonly #carryoverIntervalCount: boolean
	readonly #strict: boolean
	#intervalCount = 0
	#intervalEnd = 0
	#intervalTimer?: ReturnType<typeof setTimeout>
	#strictTimestamps: number[] = []
	#rateLimited = false
	#idCounter = 1n
	readonly #runningTasks = new Map<
		symbol,
		{
			id?: string
			priority: number
			startTime: number
			timeout?: number
		}
	>()
	timeout?: number

	constructor(options: Options<QueueType, EnqueueOptionsType> = {}) {
		const {
			concurrency = Number.POSITIVE_INFINITY,
			autoStart = true,
			queueClass = PriorityQueue as unknown as new () => QueueType,
			intervalCap = Number.POSITIVE_INFINITY,
			interval = 0,
			carryoverIntervalCount,
			carryoverConcurrencyCount,
			strict = false,
			timeout
		} = options

		if (!(typeof concurrency === 'number' && concurrency >= 1)) {
			throw new TypeError('Expected `concurrency` to be a number from 1 and up')
		}

		if (!(typeof intervalCap === 'number' && intervalCap >= 1)) {
			throw new TypeError('Expected `intervalCap` to be a number from 1 and up')
		}

		if (
			!(
				typeof interval === 'number' &&
				Number.isFinite(interval) &&
				interval >= 0
			)
		) {
			throw new TypeError('Expected `interval` to be a finite number >= 0')
		}

		if (strict && interval === 0) {
			throw new TypeError('The `strict` option requires a non-zero `interval`')
		}

		if (strict && intervalCap === Number.POSITIVE_INFINITY) {
			throw new TypeError('The `strict` option requires a finite `intervalCap`')
		}

		if (timeout !== undefined && !(Number.isFinite(timeout) && timeout > 0)) {
			throw new TypeError('Expected `timeout` to be a positive finite number')
		}

		this.#queueClass = queueClass
		this.#queue = new queueClass()
		this.#concurrency = concurrency
		this.#isPaused = !autoStart
		this.#intervalCap = intervalCap
		this.#interval = interval
		this.#carryoverIntervalCount =
			carryoverIntervalCount ?? carryoverConcurrencyCount ?? false
		this.#strict = strict
		this.timeout = timeout
	}

	on<Event extends EventName>(event: Event, listener: Listener<Event>): this {
		const listeners = this.#listeners.get(event) ?? new Set()
		listeners.add(listener as Listener<EventName>)
		this.#listeners.set(event, listeners)
		return this
	}

	off<Event extends EventName>(event: Event, listener: Listener<Event>): this {
		this.#listeners.get(event)?.delete(listener as Listener<EventName>)
		return this
	}

	emit<Event extends EventName>(
		event: Event,
		...arguments_: EventMap[Event]
	): boolean {
		const listeners = this.#listeners.get(event)

		if (!listeners || listeners.size === 0) {
			return false
		}

		for (const listener of [...listeners]) {
			listener(...(arguments_ as EventMap[EventName]))
		}

		return true
	}

	get concurrency(): number {
		return this.#concurrency
	}

	set concurrency(newConcurrency: number) {
		if (!(typeof newConcurrency === 'number' && newConcurrency >= 1)) {
			throw new TypeError('Expected `concurrency` to be a number from 1 and up')
		}

		this.#concurrency = newConcurrency
		this.#processQueue()
	}

	get size(): number {
		return this.#queue.size
	}

	sizeBy(options: Readonly<Partial<EnqueueOptionsType>>): number {
		return this.#queue.filter(options).length
	}

	get pending(): number {
		return this.#pending
	}

	get isPaused(): boolean {
		return this.#isPaused
	}

	get isRateLimited(): boolean {
		this.#updateRateLimitState()
		return this.#rateLimited
	}

	get isSaturated(): boolean {
		return (
			(this.#pending >= this.#concurrency && this.#queue.size > 0) ||
			(this.isRateLimited && this.#queue.size > 0)
		)
	}

	get runningTasks(): ReadonlyArray<{
		readonly id?: string
		readonly priority: number
		readonly startTime: number
		readonly timeout?: number
	}> {
		return [...this.#runningTasks.values()].map((task) => ({ ...task }))
	}

	setPriority(id: string, priority: number): void {
		if (typeof priority !== 'number' || !Number.isFinite(priority)) {
			throw new TypeError('Expected `priority` to be a finite number')
		}

		this.#queue.setPriority(id, priority)
	}

	async add<TaskResultType>(
		function_: Task<TaskResultType>,
		options: Partial<EnqueueOptionsType> = {}
	): Promise<TaskResultType> {
		const taskOptions = {
			timeout: this.timeout,
			...options,
			id: options.id ?? (this.#idCounter++).toString()
		} as Partial<EnqueueOptionsType> & Required<Pick<QueueAddOptions, 'id'>>

		return new Promise<TaskResultType>((resolve, reject) => {
			const taskSymbol = Symbol(taskOptions.id)
			let didRun = false
			let queuedAbortHandler: (() => void) | undefined
			let runningAbortHandler: (() => void) | undefined

			const cleanupQueuedAbort = () => {
				if (queuedAbortHandler) {
					taskOptions.signal?.removeEventListener('abort', queuedAbortHandler)
					queuedAbortHandler = undefined
				}
			}

			const run = async () => {
				didRun = true
				cleanupQueuedAbort()
				this.#pending++
				this.#runningTasks.set(taskSymbol, {
					id: taskOptions.id,
					priority: taskOptions.priority ?? 0,
					startTime: Date.now(),
					timeout: taskOptions.timeout
				})

				try {
					taskOptions.signal?.throwIfAborted()
					const operation = Promise.resolve(
						function_({ signal: taskOptions.signal })
					)
					const result = await this.#withTimeoutAndAbort(
						operation,
						taskOptions,
						(listener) => {
							runningAbortHandler = listener
						}
					)
					resolve(result)
					this.emit('completed', result)
				} catch (error) {
					reject(error)
					this.emit('error', error)
				} finally {
					if (runningAbortHandler) {
						taskOptions.signal?.removeEventListener(
							'abort',
							runningAbortHandler
						)
					}

					this.#runningTasks.delete(taskSymbol)
					queueMicrotask(() => {
						this.#next()
					})
				}
			}

			if (taskOptions.signal?.aborted) {
				reject(taskOptions.signal.reason)
				return
			}

			if (taskOptions.signal) {
				queuedAbortHandler = () => {
					if (didRun) {
						return
					}

					this.#queue.remove?.(taskOptions.id)
					reject(taskOptions.signal?.reason)
					this.emit('next')
					this.#tryToStartAnother()
				}
				taskOptions.signal.addEventListener('abort', queuedAbortHandler, {
					once: true
				})
			}

			this.#queue.enqueue(run, taskOptions)
			this.emit('add')
			this.#processQueue()
		})
	}

	async addAll<TaskResultsType>(
		functions: ReadonlyArray<Task<TaskResultsType>>,
		options?: Partial<EnqueueOptionsType>
	): Promise<TaskResultsType[]> {
		return Promise.all(
			functions.map(async (function_) => this.add(function_, options))
		)
	}

	start(): this {
		if (!this.#isPaused) {
			return this
		}

		this.#isPaused = false
		this.#processQueue()
		return this
	}

	pause(): void {
		this.#isPaused = true
	}

	clear(): void {
		this.#queue = new this.#queueClass()
		this.#clearIntervalTimer()
		this.#updateRateLimitState()
		this.emit('empty')

		if (this.#pending === 0) {
			this.emit('idle')
		}

		this.emit('next')
	}

	async onEmpty(): Promise<void> {
		if (this.#queue.size === 0) {
			return
		}

		await this.#onEvent('empty')
	}

	async onIdle(): Promise<void> {
		if (this.#queue.size === 0 && this.#pending === 0) {
			return
		}

		await this.#onEvent('idle')
	}

	async onPendingZero(): Promise<void> {
		if (this.#pending === 0) {
			return
		}

		await this.#onEvent('pendingZero')
	}

	async onRateLimit(): Promise<void> {
		if (this.isRateLimited) {
			return
		}

		await this.#onEvent('rateLimit')
	}

	async onRateLimitCleared(): Promise<void> {
		if (!this.isRateLimited) {
			return
		}

		await this.#onEvent('rateLimitCleared')
	}

	onError(): Promise<never> {
		return new Promise<never>((_resolve, reject) => {
			const listener = (error: unknown) => {
				this.off('error', listener)
				reject(error)
			}

			this.on('error', listener)
		})
	}

	async onSizeLessThan(limit: number): Promise<void> {
		if (this.#queue.size < limit) {
			return
		}

		await this.#onEvent('next', () => this.#queue.size < limit)
	}

	async #onEvent(event: EventName, filter?: () => boolean): Promise<void> {
		return new Promise((resolve) => {
			const listener = () => {
				if (filter && !filter()) {
					return
				}

				this.off(event, listener)
				resolve()
			}

			this.on(event, listener)
		})
	}

	async #withTimeoutAndAbort<TaskResultType>(
		operation: Promise<TaskResultType>,
		options: Partial<EnqueueOptionsType>,
		setAbortListener: (listener: () => void) => void
	): Promise<TaskResultType> {
		const races: Array<Promise<TaskResultType>> = [operation]
		let timeoutId: ReturnType<typeof setTimeout> | undefined

		if (options.timeout) {
			races.push(
				new Promise<never>((_resolve, reject) => {
					timeoutId = setTimeout(() => {
						reject(
							new TimeoutError(`Task timed out after ${options.timeout}ms`)
						)
					}, options.timeout)
				})
			)
		}

		if (options.signal) {
			races.push(
				new Promise<never>((_resolve, reject) => {
					const listener = () => {
						reject(options.signal?.reason)
					}

					setAbortListener(listener)
					options.signal?.addEventListener('abort', listener, { once: true })
				})
			)
		}

		try {
			return await Promise.race(races)
		} finally {
			if (timeoutId) {
				clearTimeout(timeoutId)
			}
		}
	}

	#next(): void {
		this.#pending--

		if (this.#pending === 0) {
			this.emit('pendingZero')
		}

		this.#processQueue()
		this.emit('next')
	}

	#processQueue(): void {
		while (this.#tryToStartAnother()) {}
		this.#updateRateLimitState()
	}

	#tryToStartAnother(): boolean {
		if (this.#queue.size === 0) {
			this.#clearIntervalTimer()
			this.emit('empty')

			if (this.#pending === 0) {
				this.emit('idle')
			}

			return false
		}

		if (
			this.#isPaused ||
			this.#pending >= this.#concurrency ||
			!this.#doesIntervalAllowAnother()
		) {
			return false
		}

		const job = this.#queue.dequeue()

		if (!job) {
			return false
		}

		this.#consumeIntervalSlot()
		this.emit('active')
		job()
		return true
	}

	#doesIntervalAllowAnother(): boolean {
		if (
			this.#intervalCap === Number.POSITIVE_INFINITY ||
			this.#interval === 0
		) {
			return true
		}

		const now = Date.now()

		if (this.#strict) {
			this.#strictTimestamps = this.#strictTimestamps.filter(
				(timestamp) => now - timestamp < this.#interval
			)

			if (this.#strictTimestamps.length < this.#intervalCap) {
				return true
			}

			this.#scheduleIntervalResume(
				this.#interval - (now - this.#strictTimestamps[0]!)
			)
			return false
		}

		if (this.#intervalEnd === 0 || now >= this.#intervalEnd) {
			this.#intervalCount = this.#carryoverIntervalCount ? this.#pending : 0
			this.#intervalEnd = now + this.#interval
		}

		if (this.#intervalCount < this.#intervalCap) {
			return true
		}

		this.#scheduleIntervalResume(this.#intervalEnd - now)
		return false
	}

	#consumeIntervalSlot(): void {
		if (
			this.#intervalCap === Number.POSITIVE_INFINITY ||
			this.#interval === 0
		) {
			return
		}

		if (this.#strict) {
			this.#strictTimestamps.push(Date.now())
			return
		}

		this.#intervalCount++
	}

	#scheduleIntervalResume(delay: number): void {
		if (this.#intervalTimer) {
			return
		}

		this.#intervalTimer = setTimeout(
			() => {
				this.#intervalTimer = undefined
				this.#processQueue()
			},
			Math.max(0, delay)
		)
	}

	#clearIntervalTimer(): void {
		if (this.#intervalTimer) {
			clearTimeout(this.#intervalTimer)
			this.#intervalTimer = undefined
		}
	}

	#updateRateLimitState(): void {
		const previous = this.#rateLimited
		const isRateLimited =
			this.#queue.size > 0 &&
			this.#intervalCap !== Number.POSITIVE_INFINITY &&
			this.#interval > 0 &&
			!this.#doesIntervalAllowAnother()

		this.#rateLimited = isRateLimited

		if (previous !== isRateLimited) {
			this.emit(isRateLimited ? 'rateLimit' : 'rateLimitCleared')
		}
	}
}
