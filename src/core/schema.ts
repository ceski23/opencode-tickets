import matter from 'gray-matter'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { TicketError } from './errors'

export type TicketStatus = 'open' | 'in_progress' | 'closed'

export type Ticket = {
	id: string
	title: string
	status: TicketStatus
	labels: string[]
	parent: string | null
	blocked_by: string[]
	body: string
}

export type DerivedTicket = Ticket & {
	children: string[]
	blocks: string[]
	ready: boolean
	blocked: boolean
}

export type TicketSummary = {
	id: string
	title: string
	status: TicketStatus
	labels: string[]
	parent: string | null
	blocked_by: string[]
	ready: boolean
	blocked: boolean
}

export const TICKET_STATUSES = ['open', 'in_progress', 'closed'] as const

export const TICKET_ID_PATTERN = /^TK-[1-9]\d*$/

const TICKET_ID_HINT = 'a ticket ID like "TK-1"'

export const FRONTMATTER_KEYS = ['id', 'title', 'status', 'labels', 'parent', 'blocked_by'] as const

// oxlint-disable-next-line no-control-regex -- Ticket titles are validated for control characters.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export function isTicketStatus(value: unknown): value is TicketStatus {
	return typeof value === 'string' && (TICKET_STATUSES as readonly string[]).includes(value)
}

export function isTicketId(value: unknown): value is string {
	return typeof value === 'string' && TICKET_ID_PATTERN.test(value)
}

export function compareTicketIds(a: string, b: string): number {
	const left = /^TK-(\d+)$/.exec(a)
	const right = /^TK-(\d+)$/.exec(b)
	if (left && right) return Number(left[1]) - Number(right[1])
	return a < b ? -1 : a > b ? 1 : 0
}

export function assertTicketId(value: unknown, field = 'id'): string {
	if (!isTicketId(value)) {
		throw new TicketError('invalid_id', `Invalid ${field} ${JSON.stringify(value)}: expected ${TICKET_ID_HINT}.`)
	}
	return value
}

export function normalizeTitle(value: unknown): string {
	if (typeof value !== 'string') {
		throw new TicketError('invalid_input', 'Ticket title must be a string.')
	}
	const title = value.trim()
	if (title.length === 0) {
		throw new TicketError('invalid_input', 'Ticket title must not be empty.')
	}
	if (title.includes('\n') || title.includes('\r') || CONTROL_CHARACTERS.test(title)) {
		throw new TicketError('invalid_input', 'Ticket title must be a single line without control characters.')
	}
	return title
}

export function normalizeStatus(value: unknown): TicketStatus {
	if (!isTicketStatus(value)) {
		throw new TicketError(
			'invalid_input',
			`Invalid status ${JSON.stringify(value)}: expected one of ${TICKET_STATUSES.join(', ')}.`,
		)
	}
	return value
}

export function normalizeLabels(value: unknown, field = 'labels'): string[] {
	if (!Array.isArray(value)) {
		throw new TicketError('invalid_input', `${field} must be an array of strings.`)
	}
	const result: string[] = []
	for (const entry of value) {
		if (typeof entry !== 'string') {
			throw new TicketError('invalid_input', `${field} must contain only strings.`)
		}
		const label = entry.trim()
		if (label.length === 0) {
			throw new TicketError('invalid_input', `${field} must not contain empty labels.`)
		}
		if (!result.includes(label)) result.push(label)
	}
	return result
}

export function normalizeTicketIds(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) {
		throw new TicketError('invalid_input', `${field} must be an array of ticket IDs.`)
	}
	const result: string[] = []
	for (const entry of value) {
		const id = assertTicketId(entry, field)
		if (!result.includes(id)) result.push(id)
	}
	return result
}

export function normalizeNewlines(value: string): string {
	return value.replace(/\r\n?/g, '\n')
}

export function normalizeBody(value: unknown): string {
	if (typeof value !== 'string') {
		throw new TicketError('invalid_input', 'Ticket body must be a string.')
	}
	return normalizeNewlines(value).replace(/^\n+/, '').replace(/\n+$/, '')
}

function parseError(file: string, message: string): TicketError {
	return new TicketError('invalid_storage', `${file}: ${message}`)
}

const matterOptions = {
	engines: {
		yaml: {
			parse: (input: string): object => parseYaml(input, { uniqueKeys: true }),
			stringify: (data: object): string => stringifyYaml(data, { lineWidth: 0 }),
		},
	},
}

/**
 * Parse one ticket file. The filename, when supplied, must equal `<id>.md`.
 * All failures are `invalid_storage` errors with the file name in the message.
 */
export function parseTicketFile(raw: string, filename?: string): Ticket {
	const file = filename ?? 'ticket'
	const text = normalizeNewlines(raw.replace(/^\uFEFF/, ''))
	if (!/^---[ \t]*\n/.test(text)) {
		throw parseError(file, 'missing YAML frontmatter (the file must start with a --- line).')
	}
	if (!/^---[ \t]*$/m.test(text.slice(text.indexOf('\n') + 1))) {
		throw parseError(file, 'unterminated YAML frontmatter (missing the closing --- line).')
	}
	let data: unknown
	let content: string
	try {
		const parsed = matter(text, matterOptions)
		data = parsed.data
		content = parsed.content
	} catch (error) {
		throw parseError(file, `invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`)
	}

	if (typeof data !== 'object' || data === null || Array.isArray(data)) {
		throw parseError(file, 'frontmatter must be a YAML mapping with ticket fields.')
	}

	const record = data as Record<string, unknown>
	const unknownKeys = Object.keys(record).filter(key => !(FRONTMATTER_KEYS as readonly string[]).includes(key))
	if (unknownKeys.length > 0) {
		throw parseError(
			file,
			`unknown frontmatter field${unknownKeys.length === 1 ? '' : 's'}: ${unknownKeys.join(', ')}.`,
		)
	}

	const id = record.id
	if (!isTicketId(id)) {
		throw parseError(file, `invalid ticket id ${JSON.stringify(id)}: expected ${TICKET_ID_HINT}.`)
	}
	if (filename !== undefined && filename !== `${id}.md`) {
		throw parseError(file, `filename must match the ticket ID: expected "${id}.md".`)
	}

	let title: string
	try {
		title = normalizeTitle(record.title)
	} catch (error) {
		throw parseError(file, `invalid title: ${error instanceof Error ? error.message : String(error)}`)
	}

	if (!isTicketStatus(record.status)) {
		throw parseError(
			file,
			`invalid status ${JSON.stringify(record.status)}: expected one of ${TICKET_STATUSES.join(', ')}.`,
		)
	}

	let labels: string[] = []
	if (record.labels !== undefined) {
		try {
			labels = normalizeLabels(record.labels)
		} catch (error) {
			throw parseError(file, error instanceof Error ? error.message : String(error))
		}
	}

	let parent: string | null = null
	if (record.parent !== undefined && record.parent !== null) {
		if (!isTicketId(record.parent)) {
			throw parseError(file, `invalid parent ${JSON.stringify(record.parent)}: expected a ticket ID or null.`)
		}
		parent = record.parent
	}

	let blockedBy: string[] = []
	if (record.blocked_by !== undefined) {
		try {
			blockedBy = normalizeTicketIds(record.blocked_by, 'blocked_by')
		} catch (error) {
			throw parseError(file, error instanceof Error ? error.message : String(error))
		}
	}

	return {
		id,
		title,
		status: record.status,
		labels,
		parent,
		blocked_by: blockedBy,
		body: normalizeBody(content),
	}
}

export function serializeTicket(ticket: Ticket): string {
	const metadata = {
		id: ticket.id,
		title: ticket.title,
		status: ticket.status,
		labels: ticket.labels,
		parent: ticket.parent,
		blocked_by: ticket.blocked_by,
	}
	const body = normalizeBody(ticket.body)
	const result = matter.stringify({ content: body ? `\n${body}` : '' }, metadata, matterOptions)
	return body ? result : result.slice(0, -1)
}
