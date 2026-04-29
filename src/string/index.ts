export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonObject
	| JsonArray
export type JsonObject = { [key: string]: JsonValue | undefined }
export type JsonArray = Array<JsonValue | undefined>

export function extractNumber(
	value: string | null | undefined
): number | undefined {
	if (!value?.trim()) return undefined

	const cleanedValue = value.replace(/[^\d.,-]/g, '')
	if (!cleanedValue) return undefined

	const parsedNumber = Number.parseFloat(cleanedValue)
	return Number.isNaN(parsedNumber) ? undefined : parsedNumber
}

export function generateId(input: JsonValue | undefined): string {
	const data = normalizeIdInput(input)
	let hash = 0

	for (let index = 0; index < data.length; index++) {
		const char = data.charCodeAt(index)
		hash = (hash << 5) - hash + char
		hash |= 0
	}

	return Math.abs(hash).toString(16).padStart(8, '0')
}

export function slugify(value: string): string {
	const source =
		'àáâäæãåāăąçćčđďèéêëēėęěğǵḧîïíīįìłḿñńǹňôöòóœøōõṕŕřßśšşșťțûüùúūǘůűųẃẍÿýžźż·/_,:;'
	const replacement =
		'aaaaaaaaaacccddeeeeeeeegghiiiiiilmnnnnooooooooprrsssssttuuuuuuuuuwxyyzzz------'
	const specialCharacterPattern = new RegExp(source.split('').join('|'), 'g')

	return value
		.toString()
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(specialCharacterPattern, (character) =>
			replacement.charAt(source.indexOf(character))
		)
		.replace(/&/g, '-and-')
		.replace(/[^\w-]+/g, '')
		.replace(/--+/g, '-')
		.replace(/^-+/, '')
		.replace(/-+$/, '')
}

function normalizeIdInput(input: JsonValue | undefined): string {
	if (input === undefined) return 'undefined'
	if (input === null) return 'null'
	if (typeof input === 'string') {
		return decodeURIComponent(input).split('&').sort().join('&')
	}
	if (typeof input === 'number' || typeof input === 'boolean') {
		return input.toString()
	}
	return JSON.stringify(sortJsonValue(input))
}

function sortJsonValue(value: JsonValue | undefined): JsonValue | null {
	if (value === undefined) return null

	if (Array.isArray(value)) {
		return value.map((item) => sortJsonValue(item))
	}

	if (typeof value === 'object' && value !== null) {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, itemValue]) => itemValue !== undefined)
				.sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
				.map(([key, itemValue]) => [key, sortJsonValue(itemValue)])
		)
	}

	return value
}
