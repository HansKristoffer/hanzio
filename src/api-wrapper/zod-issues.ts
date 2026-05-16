import { ZodError } from 'zod'

export type FormattedZodIssue = {
	path: string
	pathArray: (string | number)[]
	code: string
	message: string
	expected?: string
	received?: string
	value?: unknown
	valuePreview?: string
	extra?: Record<string, unknown>
}

export function formatZodIssues(
	error: ZodError,
	rawData: unknown
): FormattedZodIssue[] {
	return error.issues.map((issue) => {
		const pathArray = [...issue.path] as (string | number)[]
		const path = formatIssuePath(pathArray)
		const value = getValueAtPath(rawData, pathArray)
		const valuePreview = value === undefined ? undefined : previewValue(value)

		const raw = issue as unknown as Record<string, unknown>
		const expected =
			typeof raw.expected === 'string' ? (raw.expected as string) : undefined
		const received =
			typeof raw.received === 'string'
				? (raw.received as string)
				: value !== undefined
					? typeofVerbose(value)
					: undefined

		const known = new Set([
			'code',
			'path',
			'message',
			'expected',
			'received',
			'fatal'
		])
		const extra: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(raw)) {
			if (!known.has(k) && v !== undefined) extra[k] = v
		}

		return {
			path,
			pathArray,
			code: issue.code,
			message: issue.message,
			expected,
			received,
			value,
			valuePreview,
			extra: Object.keys(extra).length > 0 ? extra : undefined
		}
	})
}

export function renderIssueSummary(issues: FormattedZodIssue[]): string {
	if (issues.length === 0) return '(no issues reported)'
	return issues
		.map((issue, idx) => {
			const parts: string[] = []
			parts.push(`  [${idx + 1}] ${issue.path}: ${issue.message}`)
			if (issue.expected || issue.received) {
				const exp = issue.expected ? `expected ${issue.expected}` : ''
				const rec = issue.received ? `received ${issue.received}` : ''
				parts.push(`      (${[exp, rec].filter(Boolean).join(', ')})`)
			}
			if (issue.valuePreview !== undefined) {
				parts.push(`      value: ${issue.valuePreview}`)
			}
			if (issue.extra) {
				for (const [k, v] of Object.entries(issue.extra)) {
					parts.push(`      ${k}: ${previewValue(v, 120)}`)
				}
			}
			return parts.join('\n')
		})
		.join('\n')
}

function formatIssuePath(pathArray: (string | number)[]): string {
	if (pathArray.length === 0) return '<root>'
	let out = ''
	for (const segment of pathArray) {
		if (typeof segment === 'number') {
			out += `[${segment}]`
		} else if (/^[A-Za-z_$][\w$]*$/.test(segment)) {
			out += out === '' ? segment : `.${segment}`
		} else {
			out += `[${JSON.stringify(segment)}]`
		}
	}
	return out
}

function getValueAtPath(
	data: unknown,
	pathArray: (string | number)[]
): unknown {
	let current: unknown = data
	for (const segment of pathArray) {
		if (current === null || current === undefined) return undefined
		if (typeof current !== 'object') return undefined
		current = (current as Record<string | number, unknown>)[segment]
	}
	return current
}

function typeofVerbose(value: unknown): string {
	if (value === null) return 'null'
	if (Array.isArray(value)) return 'array'
	return typeof value
}

export function previewValue(value: unknown, maxLen = 200): string {
	let str: string
	try {
		if (value === undefined) str = 'undefined'
		else if (typeof value === 'string') str = JSON.stringify(value)
		else str = JSON.stringify(value)
	} catch {
		str = String(value)
	}
	if (str === undefined) str = String(value)
	if (str.length > maxLen) str = `${str.slice(0, maxLen)}…`
	return str
}

export function makeJsonParseZodError(error: unknown, text: string): ZodError {
	const message =
		error instanceof Error
			? `Response body was not valid JSON: ${error.message}`
			: 'Response body was not valid JSON'
	const preview = text.length > 200 ? `${text.slice(0, 200)}…` : text
	return new ZodError([
		{
			code: 'custom',
			path: [],
			message: `${message} (body preview: ${JSON.stringify(preview)})`,
			input: text
		} as never
	])
}

export function tryParseJson(body: string): unknown {
	if (!body) return undefined
	try {
		return JSON.parse(body)
	} catch {
		return undefined
	}
}
