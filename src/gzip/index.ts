import pako from 'pako'

export function compressString(input: string): string {
	// Convert string to Uint8Array
	const uint8Array = new TextEncoder().encode(input)

	// Compress the Uint8Array
	const compressed = pako.deflate(uint8Array)

	// Convert compressed Uint8Array to base64 string for storage
	return btoa(
		String.fromCharCode.apply(null, compressed as unknown as number[])
	)
}

export function decompressString(compressedString: string): string {
	// Convert base64 string back to Uint8Array
	const compressedData = new Uint8Array(
		atob(compressedString)
			.split('')
			.map((char) => char.charCodeAt(0))
	)

	// Decompress the Uint8Array
	const decompressed = pako.inflate(compressedData)

	// Convert Uint8Array back to string
	return new TextDecoder().decode(decompressed)
}
