import { SecretLoadError } from './errors'

export type SecretRequestOptions = {
	readonly timeoutMs?: number
	readonly signal?: AbortSignal
}

/** One deadline includes authentication, retries, body reads, and validation. */
export async function withSecretDeadline<T>(
	options: SecretRequestOptions,
	operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
	const timeoutMs = options.timeoutMs ?? 30_000

	if (
		!Number.isFinite(timeoutMs) ||
		timeoutMs <= 0 ||
		timeoutMs > 2_147_483_647
	) {
		throw new SecretLoadError(
			'CONFIGURATION',
			'Secret timeoutMs must be a positive finite timer duration.'
		)
	}

	// Normalize caller cancellation so arbitrary abort reasons cannot leak secrets.
	const controller = new AbortController()
	const cancel = () =>
		controller.abort(
			new SecretLoadError('ABORTED', 'Secret loading was cancelled.')
		)

	if (options.signal?.aborted) {
		cancel()
	} else {
		options.signal?.addEventListener('abort', cancel, { once: true })
	}

	const timer = setTimeout(
		() =>
			controller.abort(
				new SecretLoadError(
					'TIMEOUT',
					`Secret loading timed out after ${timeoutMs}ms.`
				)
			),
		timeoutMs
	)
	let rejectOnAbort: () => void = () => {}

	try {
		const aborted = new Promise<never>((_, reject) => {
			rejectOnAbort = () => reject(controller.signal.reason)
			controller.signal.addEventListener('abort', rejectOnAbort, { once: true })
		})

		if (controller.signal.aborted) {
			throw controller.signal.reason
		}

		// Reject promptly even if a custom loader ignores the abort signal.
		return await Promise.race([operation(controller.signal), aborted])
	} finally {
		// Neither completed loads nor failures should retain listeners or timers.
		clearTimeout(timer)
		options.signal?.removeEventListener('abort', cancel)
		controller.signal.removeEventListener('abort', rejectOnAbort)
	}
}
