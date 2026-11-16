import Fuse from 'fuse.js'
import { TicketError } from './errors'
import { summarizeTicket } from './graph'
import {
	assertTicketId,
	compareTicketIds,
	isTicketStatus,
	normalizeLabels,
	normalizeNewlines,
	TICKET_STATUSES,
	type DerivedTicket,
	type TicketStatus,
	type TicketSummary,
} from './schema'

export type TicketSearchFilters = {
	query?: string
	id?: string
	status?: TicketStatus
	labels?: string[]
	parent?: string | null
	blocked_by?: string
	ready?: boolean
	limit?: number
	offset?: number
}

export type TicketSearchEntry = TicketSummary & {
	bodyPreview: string
}

export type TicketSearchResult = {
	total: number
	limit: number
	offset: number
	tickets: TicketSearchEntry[]
}

export const DEFAULT_SEARCH_LIMIT = 50
export const MAX_SEARCH_LIMIT = 200

const PREVIEW_LENGTH = 200

/** First useful paragraph, stripped of headings and simple Markdown. */
export function previewBody(body: string): string {
	const text = normalizeNewlines(body)
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/^#{1,6}\s+.*$/gm, '')
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/[`*_~]/g, '')
		.replace(/^\s*[-+*]\s+/gm, '')
		.replace(/\s+/g, ' ')
		.trim()

	if (text.length <= PREVIEW_LENGTH) return text
	return `${text.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…`
}

const ID_TOKEN = /\bTK-\d+\b/gi
const FULL_ID_QUERY = /^TK-\d+$/i

/**
 * A full ID query is handled before this function and returns only that ticket.
 * For mixed queries, exact IDs still rank ahead of text; remaining matches use
 * Fuse over the text fields, weighted title > labels > body.
 */
function rankByQuery(tickets: readonly DerivedTicket[], query: string): DerivedTicket[] {
	const byId = new Map(tickets.map(ticket => [ticket.id, ticket]))
	const idMatches = [...new Set((query.match(ID_TOKEN) ?? []).map(token => token.toUpperCase()))]
		.map(token => byId.get(token))
		.filter((ticket): ticket is DerivedTicket => ticket !== undefined)
		.sort((a, b) => compareTicketIds(a.id, b.id))
	const seen = new Set(idMatches.map(ticket => ticket.id))

	const fuse = new Fuse(tickets, {
		includeScore: true,
		ignoreLocation: true,
		threshold: 0.3,
		minMatchCharLength: 1,
		keys: [
			{ name: 'title', weight: 3 },
			{ name: 'labels', weight: 2 },
			{ name: 'body', weight: 1 },
		],
	})

	const textMatches = fuse
		.search(query)
		.filter(result => !seen.has(result.item.id))
		.sort((a, b) => (a.score ?? 0) - (b.score ?? 0) || compareTicketIds(a.item.id, b.item.id))
		.map(result => result.item)

	return [...idMatches, ...textMatches]
}

function matchesFilters(
	ticket: DerivedTicket,
	filters: TicketSearchFilters,
	labels: readonly string[] | undefined,
): boolean {
	if (filters.id !== undefined && ticket.id !== filters.id) return false
	if (filters.status !== undefined && ticket.status !== filters.status) return false
	if (labels !== undefined && !labels.every(label => ticket.labels.includes(label))) return false
	if (filters.parent !== undefined) {
		if (filters.parent === null ? ticket.parent !== null : ticket.parent !== filters.parent) return false
	}
	if (filters.blocked_by !== undefined && !ticket.blocked_by.includes(filters.blocked_by)) {
		return false
	}
	if (filters.ready !== undefined && ticket.ready !== filters.ready) return false
	return true
}

export function searchTickets(
	tickets: readonly DerivedTicket[],
	filters: TicketSearchFilters = {},
): TicketSearchResult {
	const query = filters.query
	if (query !== undefined && typeof query !== 'string') {
		throw new TicketError('invalid_input', 'Search query must be a string.')
	}
	if (filters.status !== undefined && !isTicketStatus(filters.status)) {
		throw new TicketError('invalid_input', `Invalid status filter: expected one of ${TICKET_STATUSES.join(', ')}.`)
	}
	const labels = filters.labels === undefined ? undefined : normalizeLabels(filters.labels, 'labels')
	if (filters.id !== undefined) assertTicketId(filters.id, 'id')
	if (filters.parent !== undefined && filters.parent !== null) assertTicketId(filters.parent, 'parent')
	if (filters.blocked_by !== undefined) assertTicketId(filters.blocked_by, 'blocked_by')
	if (filters.ready !== undefined && typeof filters.ready !== 'boolean') {
		throw new TicketError('invalid_input', 'ready must be a boolean.')
	}

	const limit = filters.limit ?? DEFAULT_SEARCH_LIMIT
	if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
		throw new TicketError('invalid_input', `limit must be an integer from 1 to ${MAX_SEARCH_LIMIT}.`)
	}
	const offset = filters.offset ?? 0
	if (!Number.isInteger(offset) || offset < 0) {
		throw new TicketError('invalid_input', 'offset must be a nonnegative integer.')
	}

	const filtered = tickets.filter(ticket => matchesFilters(ticket, filters, labels))
	const trimmedQuery = query?.trim() ?? ''
	const matches =
		trimmedQuery.length === 0
			? [...filtered].sort((a, b) => compareTicketIds(a.id, b.id))
			: FULL_ID_QUERY.test(trimmedQuery)
				? filtered.filter(ticket => ticket.id === trimmedQuery.toUpperCase())
				: rankByQuery(filtered, trimmedQuery)

	return {
		total: matches.length,
		limit,
		offset,
		tickets: matches.slice(offset, offset + limit).map(ticket => ({
			...summarizeTicket(ticket),
			bodyPreview: previewBody(ticket.body),
		})),
	}
}
