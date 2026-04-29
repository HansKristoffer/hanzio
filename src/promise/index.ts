export type BackgroundPromiseOptions = {
	onError?: (error: unknown) => void
	onSuccess?: () => void
	scheduler?: (callback: () => void) => void
}

export type Success<T> = {
	data: T
	error: null
}

export type Failure<E> = {
	data: null
	error: E
}

export type Result<T, E = Error> = Success<T> | Failure<E>

export function isSuccess<T, E>(result: Result<T, E>): result is Success<T> {
	return result.error === null
}

export function isFailure<T, E>(result: Result<T, E>): result is Failure<E> {
	return result.error !== null
}

export function unwrapResult<T, E>(result: Result<T, E>): T {
	if (isSuccess(result)) return result.data
	throw result.error
}

export function backgroundPromise<T>(
	promiseFactory: () => Promise<T>,
	options: BackgroundPromiseOptions = {}
): void {
	const run = () => {
		promiseFactory()
			.then(() => options.onSuccess?.())
			.catch((error: unknown) => options.onError?.(error))
	}

	if (options.scheduler) {
		options.scheduler(run)
		return
	}

	run()
}

export function backgroundPromiseSync<T>(
	promiseFactory: () => Promise<T>,
	options: BackgroundPromiseOptions = {}
): void {
	backgroundPromise(promiseFactory, {
		...options,
		scheduler: options.scheduler ?? queueMicrotask
	})
}

export function promiseTimeout(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function tryCatch<T, E = Error>(
	promise: Promise<T>
): Promise<Result<T, E>> {
	try {
		const data = await promise
		return { data, error: null }
	} catch (error) {
		return { data: null, error: error as E }
	}
}
