import type { z } from 'zod'
import type { ApiEndpoint } from './types'

/**
 * Defines an endpoint with full inference, as an alternative to
 * `satisfies ApiEndpoint`: `resFormatter` must return what `resSchema`
 * accepts, and a literal `path` types its `:params` (making `reqParams`
 * required when there's no `reqParamsSchema`).
 *
 * @example
 * export const usersGet = defineEndpoint({
 *   method: 'GET',
 *   path: '/users/:userId',
 *   resSchema: User
 * })
 */
export function defineEndpoint<const TEndpoint extends ApiEndpoint>(
	endpoint: TEndpoint & {
		resFormatter?: (
			data: unknown,
			headers: Record<string, string>
		) => z.input<TEndpoint['resSchema']>
	}
): TEndpoint {
	return endpoint
}
