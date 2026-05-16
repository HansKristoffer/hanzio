export function calculateSizeInMb(data: unknown): number {
	let bytes: number
	if (data === undefined || data === null) {
		bytes = 0
	} else if (data instanceof Blob) {
		bytes = data.size
	} else if (typeof FormData !== 'undefined' && data instanceof FormData) {
		bytes = 0
		data.forEach((value) => {
			if (value instanceof Blob) bytes += value.size
			else bytes += new TextEncoder().encode(String(value)).length
		})
	} else if (typeof data === 'string') {
		bytes = new TextEncoder().encode(data).length
	} else {
		bytes = new TextEncoder().encode(JSON.stringify(data) ?? '').length
	}
	return bytes / (1024 * 1024)
}
