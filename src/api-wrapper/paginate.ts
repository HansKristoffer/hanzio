export type PaginateOptions = {
	/** Stop after this many pages (default: no limit). */
	maxPages?: number
	/** Checked before each page fetch; throws `signal.reason` when aborted. */
	signal?: AbortSignal
}

/**
 * Yields pages until `getNext` returns `null`/`undefined`. The first call to
 * `fetchPage` gets `undefined` as cursor. Pages are fetched lazily, so
 * breaking out of `for await` stops further requests.
 */
export async function* paginate<TPage, TCursor>(
	fetchPage: (cursor: TCursor | undefined) => Promise<TPage>,
	getNext: (page: TPage) => TCursor | null | undefined,
	options: PaginateOptions = {}
): AsyncGenerator<TPage, void, undefined> {
	const { maxPages = Number.POSITIVE_INFINITY, signal } = options
	let cursor: TCursor | undefined
	for (let count = 0; count < maxPages; count++) {
		signal?.throwIfAborted()
		const page = await fetchPage(cursor)
		yield page
		const next = getNext(page)
		if (next == null) return
		cursor = next
	}
}
