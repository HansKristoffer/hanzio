import { z } from 'zod'

export const zodMinMaxFilter = z.object({
	min: z.number().optional(),
	max: z.number().optional()
})

export type ZodMinMaxFilter = z.infer<typeof zodMinMaxFilter>

/**
 * Maps a min/max filter to a generic `gte`/`lte` range object (e.g. ORM-friendly).
 * Returns `undefined` if both bounds are undefined.
 */
export function toGteLteFilter(
	filter: ZodMinMaxFilter | undefined
): { gte?: number; lte?: number } | undefined {
	if (!filter) return undefined

	const hasMin = filter.min !== undefined
	const hasMax = filter.max !== undefined

	if (!hasMin && !hasMax) return undefined

	return {
		...(hasMin && { gte: filter.min }),
		...(hasMax && { lte: filter.max })
	}
}
