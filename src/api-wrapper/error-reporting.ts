import type { ApiError } from './errors'
import type { ApiClientConfig } from './types'
import type { ApiErrorContext } from './shared'
import { defaultRedactContext } from './redaction'

type ErrorHookConfig = Pick<
	ApiClientConfig<never, never>,
	'logger' | 'onError' | 'redact'
>

export function applyErrorContextRedaction(
	ctx: ApiErrorContext,
	config: Pick<ApiClientConfig<never, never>, 'redact'>
): ApiErrorContext {
	const base = defaultRedactContext(ctx)
	return config.redact ? config.redact(base) : base
}

export async function reportApiError(
	err: ApiError,
	config: ErrorHookConfig
): Promise<ApiError> {
	err.context = applyErrorContextRedaction(err.context, config)
	try {
		await config.onError?.(err)
	} catch {
		// ignore hook errors
	}
	config.logger?.error?.(err)
	return err
}
