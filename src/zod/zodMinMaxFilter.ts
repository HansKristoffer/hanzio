import { z } from 'zod'

/**
 * Creates a `{ min?, max? }` filter schema for any comparable value schema,
 * e.g. `createMinMaxFilter(z.coerce.date())`.
 */
export function createMinMaxFilter<T extends z.ZodType>(schema: T) {
	return z.object({ min: schema.optional(), max: schema.optional() })
}

export const zodMinMaxFilter = createMinMaxFilter(z.number())

export type ZodMinMaxFilter = z.infer<typeof zodMinMaxFilter>

export type MinMaxFilter<T> = { min?: T; max?: T }

function toRange<T>(
	filter: MinMaxFilter<T> | undefined,
	lower: string,
	upper: string
): Record<string, T> | undefined {
	if (!filter) return undefined

	const hasMin = filter.min !== undefined
	const hasMax = filter.max !== undefined

	if (!hasMin && !hasMax) return undefined

	return {
		...(hasMin && { [lower]: filter.min as T }),
		...(hasMax && { [upper]: filter.max as T })
	}
}

/**
 * Maps a min/max filter to a generic `gte`/`lte` range object (e.g. ORM-friendly).
 * Returns `undefined` if both bounds are undefined.
 */
export function toGteLteFilter<T>(
	filter: MinMaxFilter<T> | undefined
): { gte?: T; lte?: T } | undefined {
	return toRange(filter, 'gte', 'lte')
}

/**
 * Exclusive variant of `toGteLteFilter`, mapping min/max to `gt`/`lt`.
 */
export function toGtLtFilter<T>(
	filter: MinMaxFilter<T> | undefined
): { gt?: T; lt?: T } | undefined {
	return toRange(filter, 'gt', 'lt')
}
