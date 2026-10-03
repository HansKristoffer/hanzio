import type { z } from 'zod'
import type { ApiEndpoint, CheckResponseContext } from './types'

/**
 * Defines an endpoint with full inference, as an alternative to
 * `satisfies ApiEndpoint`: `resFormatter` must return what `resSchema`
 * accepts, `checkResponse` receives the parsed `resSchema` output, and a
 * literal `path` types its `:params` (making `reqParams` required when
 * there's no `reqParamsSchema`).
 *
 * @example
 * export const usersGet = defineEndpoint({
 *   method: 'GET',
 *   path: '/users/:userId',
 *   resSchema: User
 * })
 */
// `TRes` is inferred from `resSchema` before the callbacks are typed, and the
// constraint omits `checkResponse` so its untyped `ApiEndpoint` signature
// doesn't override the one below.
export function defineEndpoint<
	const TEndpoint extends Omit<ApiEndpoint, 'checkResponse'>,
	TRes extends z.ZodType = TEndpoint['resSchema']
>(
	endpoint: TEndpoint & {
		resSchema: TRes
		resFormatter?: (
			data: unknown,
			headers: Record<string, string>
		) => z.input<TRes>
		checkResponse?:
			| ((
					data: z.output<TRes>,
					context: CheckResponseContext
			  ) => void | Promise<void>)
			| false
	}
): TEndpoint {
	return endpoint
}
