import type { ApiError } from './errors'
import type { ApiClientConfig } from './types'
import type { ApiErrorContext } from './shared'
import { apiErrorLogAttributes, describeApiError } from './describe'
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
	const rawUrl = err.context.url
	err.context = applyErrorContextRedaction(err.context, config)
	// Messages were built from the raw URL; keep redacted query values out of them.
	if (rawUrl && rawUrl !== err.context.url) {
		err.message = err.message.split(rawUrl).join(err.context.url)
	}
	try {
		await config.onError?.(err)
	} catch {
		// ignore hook errors
	}
	config.logger?.error?.(describeApiError(err), apiErrorLogAttributes(err))
	return err
}
