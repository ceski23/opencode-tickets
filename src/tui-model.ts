import Fuse from 'fuse.js'
import { compareTicketIds, type TicketStatus } from './core/schema'

export type TicketListItem = {
	id: string
	title: string
	body?: string
	status: TicketStatus
	labels: string[]
	parent: string | null
	blocked_by: string[]
	ready: boolean
	blocked: boolean
}

export type TreeRow = {
	ticket: TicketListItem
	depth: number
	/** Whether this row is the last child of its parent. */
	last: boolean
	/** For each ancestor level: whether that ancestor was the last sibling. */
	ancestorLast: boolean[]
	hasChildren: boolean
	expanded: boolean
}

export type TicketFilter = 'all' | TicketStatus

export const TREE_ROW_WIDTH = 40

/**
 * Status markers stay text-first so the tree remains readable if a glyph is
 * missing. A few common Nerd Font symbols are used for chrome and indicators.
 */
export const TREE_SYMBOLS = {
	open: '[ ]',
	inProgress: '[~]',
	closed: '[x]',
	blocked: '\uf023',
	expanded: '\uf078',
	collapsed: '\uf054',
	selection: '▌',
} as const

export function statusMarker(status: TicketStatus): string {
	switch (status) {
		case 'open':
			return TREE_SYMBOLS.open
		case 'in_progress':
			return TREE_SYMBOLS.inProgress
		case 'closed':
			return TREE_SYMBOLS.closed
	}
}

export function statusLabel(status: TicketStatus): string {
	switch (status) {
		case 'open':
			return 'Open'
		case 'in_progress':
			return 'In progress'
		case 'closed':
			return 'Closed'
	}
}

/**
 * Build the visible rows of the parent tree. Siblings are ordered by ID and
 * collapsed subtrees are omitted. Invalid references are treated as roots so
 * the browser cannot lose a ticket; the server reports storage errors first.
 */
export function buildTreeRows(tickets: readonly TicketListItem[], expanded: ReadonlySet<string>): TreeRow[] {
	const byId = new Map(tickets.map(ticket => [ticket.id, ticket]))
	const children = new Map<string, TicketListItem[]>()
	const roots: TicketListItem[] = []

	for (const ticket of tickets) {
		if (ticket.parent !== null && byId.has(ticket.parent)) {
			const list = children.get(ticket.parent) ?? []
			list.push(ticket)
			children.set(ticket.parent, list)
		} else {
			roots.push(ticket)
		}
	}

	const sort = (list: TicketListItem[]): TicketListItem[] => list.sort((a, b) => compareTicketIds(a.id, b.id))
	sort(roots)
	for (const list of children.values()) sort(list)

	const rows: TreeRow[] = []
	const visited = new Set<string>()

	const walk = (ticket: TicketListItem, depth: number, last: boolean, ancestorLast: boolean[]): void => {
		if (visited.has(ticket.id)) return
		visited.add(ticket.id)
		const childList = children.get(ticket.id) ?? []
		const isExpanded = expanded.has(ticket.id)
		rows.push({
			ticket,
			depth,
			last,
			ancestorLast,
			hasChildren: childList.length > 0,
			expanded: isExpanded,
		})
		if (!isExpanded) return
		childList.forEach((child, index) => {
			walk(child, depth + 1, index === childList.length - 1, depth === 0 ? [] : [...ancestorLast, last])
		})
	}

	roots.forEach((ticket, index) => walk(ticket, 0, index === roots.length - 1, []))
	return rows
}

export function treePrefix(row: TreeRow): string {
	if (row.depth === 0) return ''
	let prefix = ''
	for (let level = 0; level < row.depth - 1; level += 1) {
		prefix += row.ancestorLast[level] ? '   ' : '│  '
	}
	prefix += row.last ? '└─ ' : '├─ '
	return prefix
}

export function parentIdsWithChildren(tickets: readonly TicketListItem[]): string[] {
	const parents = new Set(tickets.map(ticket => ticket.parent).filter((id): id is string => id !== null))
	return tickets
		.filter(ticket => parents.has(ticket.id))
		.map(ticket => ticket.id)
		.sort(compareTicketIds)
}

export function ticketCounts(tickets: readonly TicketListItem[]): {
	open: number
	inProgress: number
	closed: number
} {
	return {
		open: tickets.filter(ticket => ticket.status === 'open').length,
		inProgress: tickets.filter(ticket => ticket.status === 'in_progress').length,
		closed: tickets.filter(ticket => ticket.status === 'closed').length,
	}
}

export function filterTickets(tickets: readonly TicketListItem[], filter: TicketFilter, query = ''): TicketListItem[] {
	const filtered = filter === 'all' ? [...tickets] : tickets.filter(ticket => ticket.status === filter)
	const term = query.trim()
	if (!term) return filtered
	const matches = new Fuse(filtered, {
		ignoreLocation: true,
		threshold: 0.3,
		keys: ['id', 'title', 'labels', 'body'],
	}).search(term)
	return matches.map(match => match.item)
}

/** During search, expand matching parent rows without changing the saved tree state. */
export function ticketRows(
	tickets: readonly TicketListItem[],
	filter: TicketFilter,
	query: string,
	expanded: ReadonlySet<string>,
): TreeRow[] {
	const visible = filterTickets(tickets, filter, query)
	return buildTreeRows(visible, query.trim() ? new Set(parentIdsWithChildren(visible)) : expanded)
}

export function revealTicket(
	tickets: readonly TicketListItem[],
	id: string,
	filter: TicketFilter,
	expanded: ReadonlySet<string>,
): { filter: TicketFilter; expanded: Set<string> } {
	const byId = new Map(tickets.map(ticket => [ticket.id, ticket]))
	const ticket = byId.get(id)
	const nextFilter = ticket && filter !== 'all' && ticket.status !== filter ? 'all' : filter
	const nextExpanded = new Set(expanded)
	const seen = new Set<string>()
	let parent = ticket?.parent
	while (parent && !seen.has(parent)) {
		seen.add(parent)
		const ancestor = byId.get(parent)
		if (!ancestor || (nextFilter !== 'all' && ancestor.status !== nextFilter)) break
		nextExpanded.add(parent)
		parent = ancestor.parent
	}
	return { filter: nextFilter, expanded: nextExpanded }
}

export function reconcileSelection(rows: readonly TreeRow[], currentId: string | null): string | null {
	if (currentId !== null && rows.some(row => row.ticket.id === currentId)) return currentId
	return rows[0]?.ticket.id ?? null
}

export function moveSelection(rows: readonly TreeRow[], currentId: string | null, delta: number): string | null {
	if (rows.length === 0) return null
	const index = currentId === null ? -1 : rows.findIndex(row => row.ticket.id === currentId)
	const next = Math.max(0, Math.min(rows.length - 1, index === -1 ? 0 : index + delta))
	return rows[next]?.ticket.id ?? null
}

export function expandTarget(
	rows: readonly TreeRow[],
	currentId: string | null,
): { kind: 'toggle' | 'select'; id: string } | null {
	const row = rows.find(candidate => candidate.ticket.id === currentId)
	if (!row || !row.hasChildren) return null
	if (!row.expanded) return { kind: 'toggle', id: row.ticket.id }
	const index = rows.indexOf(row)
	const child = rows.slice(index + 1).find(candidate => candidate.depth === row.depth + 1)
	return child ? { kind: 'select', id: child.ticket.id } : null
}

export function collapseTarget(
	rows: readonly TreeRow[],
	currentId: string | null,
): { kind: 'toggle' | 'select'; id: string } | null {
	const row = rows.find(candidate => candidate.ticket.id === currentId)
	if (!row) return null
	if (row.expanded) return { kind: 'toggle', id: row.ticket.id }
	const parent = row.ticket.parent
	if (parent !== null && rows.some(candidate => candidate.ticket.id === parent)) {
		return { kind: 'select', id: parent }
	}
	return null
}

/**
 * RPC clients reject with plain `{ type, message, data }` objects rather than
 * Error instances. Format those without leaking `[object Object]` into the UI.
 */
export function formatRpcError(cause: unknown): string {
	if (cause instanceof Error) return cause.message
	if (typeof cause === 'object' && cause !== null) {
		const record = cause as Record<string, unknown>
		const message = typeof record.message === 'string' ? record.message : undefined
		const type = typeof record.type === 'string' ? record.type : undefined
		if (message !== undefined && message.length > 0) {
			return type === 'rpc.unavailable'
				? `${message} (the server may still be loading the plugin; press r to retry)`
				: message
		}
		if (type !== undefined) return type
		try {
			return JSON.stringify(cause)
		} catch {
			return 'Unknown ticket RPC error.'
		}
	}
	return String(cause)
}
