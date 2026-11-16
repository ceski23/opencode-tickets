import { TicketError } from './errors'
import { deriveAll, summarizeTicket, validateGraph } from './graph'
import {
	assertTicketId,
	normalizeBody,
	normalizeLabels,
	normalizeStatus,
	normalizeTicketIds,
	normalizeTitle,
	type DerivedTicket,
	type Ticket,
	type TicketStatus,
	type TicketSummary,
} from './schema'
import { searchTickets, type TicketSearchFilters, type TicketSearchResult } from './search'
import { TicketStorage } from './storage'

export type CreateTicketInput = {
	title: string
	body?: string
	labels?: string[]
	parent?: string | null
	blocked_by?: string[]
}

export type UpdateTicketInput = {
	title?: string
	status?: TicketStatus
	labels?: string[]
	parent?: string | null
	body?: string
	append_body?: string
	add_labels?: string[]
	remove_labels?: string[]
	blocked_by?: string[]
	add_blocked_by?: string[]
	remove_blocked_by?: string[]
}

export type TicketDetail = {
	ticket: DerivedTicket
	parent: TicketSummary | null
	children: TicketSummary[]
	blockers: TicketSummary[]
	blocks: TicketSummary[]
}

const UPDATE_KEYS = new Set<keyof UpdateTicketInput>([
	'title',
	'status',
	'labels',
	'parent',
	'body',
	'append_body',
	'add_labels',
	'remove_labels',
	'blocked_by',
	'add_blocked_by',
	'remove_blocked_by',
])

const CREATE_KEYS = new Set<keyof CreateTicketInput>(['title', 'body', 'labels', 'parent', 'blocked_by'])

/**
 * The single ticket service used by the agent tools, the context reminder, and
 * the TUI RPC handlers. Every operation loads and validates the whole
 * collection first, then validates its complete proposed graph before writing.
 */
export class TicketService {
	readonly storage: TicketStorage

	constructor(root: string, storage?: TicketStorage) {
		this.storage = storage ?? new TicketStorage(root)
	}

	async list(): Promise<DerivedTicket[]> {
		return this.loadDerived()
	}

	async get(id: string): Promise<DerivedTicket> {
		const ticketId = assertTicketId(id)
		const tickets = await this.loadDerived()
		const ticket = tickets.find(candidate => candidate.id === ticketId)
		if (!ticket) throw new TicketError('not_found', `Ticket ${ticketId} does not exist.`)
		return ticket
	}

	async detail(id: string): Promise<TicketDetail> {
		const ticketId = assertTicketId(id)
		const all = await this.loadDerived()
		const byId = new Map(all.map(candidate => [candidate.id, candidate]))
		const ticket = byId.get(ticketId)
		if (!ticket) throw new TicketError('not_found', `Ticket ${ticketId} does not exist.`)
		const summarize = (summaryId: string): TicketSummary => {
			const found = byId.get(summaryId)
			if (!found) throw new TicketError('invalid_storage', `Ticket ${summaryId} disappeared while loading.`)
			return summarizeTicket(found)
		}
		return {
			ticket,
			parent: ticket.parent === null ? null : summarize(ticket.parent),
			children: ticket.children.map(summarize),
			blockers: ticket.blocked_by.map(summarize),
			blocks: ticket.blocks.map(summarize),
		}
	}

	async create(input: CreateTicketInput): Promise<DerivedTicket> {
		this.validateCreateShape(input)
		const title = normalizeTitle(input.title)
		const body = input.body === undefined ? '' : normalizeBody(input.body)
		const labels = input.labels === undefined ? [] : normalizeLabels(input.labels)
		const parent =
			input.parent === undefined || input.parent === null ? null : assertTicketId(input.parent, 'parent')
		const blockedBy = input.blocked_by === undefined ? [] : normalizeTicketIds(input.blocked_by, 'blocked_by')

		const tickets = await this.loadDerived()
		const id = await this.allocateId(tickets)
		const ticket: Ticket = {
			id,
			title,
			status: 'open',
			labels,
			parent,
			blocked_by: blockedBy,
			body,
		}
		const next: Ticket[] = [...tickets.map(stripDerived), ticket]
		validateGraph(next)
		await this.storage.write(ticket, { overwrite: false })
		return findByDerivedId(deriveAll(next), id)
	}

	async update(id: string, changes: UpdateTicketInput): Promise<DerivedTicket> {
		const ticketId = assertTicketId(id)
		this.validateUpdateShape(changes)

		const tickets = await this.loadDerived()
		const current = tickets.find(ticket => ticket.id === ticketId)
		if (!current) throw new TicketError('not_found', `Ticket ${ticketId} does not exist.`)

		const next: Ticket = {
			id: current.id,
			title: current.title,
			status: current.status,
			labels: [...current.labels],
			parent: current.parent,
			blocked_by: [...current.blocked_by],
			body: current.body,
		}

		if (changes.title !== undefined) next.title = normalizeTitle(changes.title)
		if (changes.status !== undefined) next.status = normalizeStatus(changes.status)
		if (changes.parent !== undefined) {
			next.parent = changes.parent === null ? null : assertTicketId(changes.parent, 'parent')
		}
		if (changes.body !== undefined) next.body = normalizeBody(changes.body)
		if (changes.append_body !== undefined) {
			const appended = normalizeBody(changes.append_body).replace(/^\n+/, '').replace(/\n+$/, '')
			if (appended.length > 0) {
				const existing = next.body.replace(/\n+$/, '')
				next.body = existing.length === 0 ? appended : `${existing}\n\n${appended}`
			}
		}

		if (changes.labels !== undefined) next.labels = normalizeLabels(changes.labels)
		if (changes.add_labels !== undefined) {
			for (const label of normalizeLabels(changes.add_labels, 'add_labels')) {
				if (!next.labels.includes(label)) next.labels.push(label)
			}
		}
		if (changes.remove_labels !== undefined) {
			const removing = normalizeLabels(changes.remove_labels, 'remove_labels')
			next.labels = next.labels.filter(label => !removing.includes(label))
		}

		if (changes.blocked_by !== undefined) {
			next.blocked_by = normalizeTicketIds(changes.blocked_by, 'blocked_by')
		}
		if (changes.add_blocked_by !== undefined) {
			for (const blocker of normalizeTicketIds(changes.add_blocked_by, 'add_blocked_by')) {
				if (!next.blocked_by.includes(blocker)) next.blocked_by.push(blocker)
			}
		}
		if (changes.remove_blocked_by !== undefined) {
			const removing = normalizeTicketIds(changes.remove_blocked_by, 'remove_blocked_by')
			next.blocked_by = next.blocked_by.filter(blocker => !removing.includes(blocker))
		}

		const proposed = tickets.map(stripDerived)
		const index = proposed.findIndex(ticket => ticket.id === ticketId)
		proposed[index] = next
		validateGraph(proposed)
		await this.storage.write(next)
		return findByDerivedId(deriveAll(proposed), ticketId)
	}

	async delete(id: string): Promise<{ id: string; deleted: true }> {
		const ticketId = assertTicketId(id)
		const tickets = await this.loadDerived()
		const ticket = tickets.find(candidate => candidate.id === ticketId)
		if (!ticket) throw new TicketError('not_found', `Ticket ${ticketId} does not exist.`)

		const references = tickets
			.filter(
				candidate =>
					candidate.id !== ticketId &&
					(candidate.parent === ticketId || candidate.blocked_by.includes(ticketId)),
			)
			.map(candidate => {
				const relationships: string[] = []
				if (candidate.parent === ticketId) relationships.push('parent')
				if (candidate.blocked_by.includes(ticketId)) relationships.push('blocked_by')
				return `${candidate.id} (${relationships.join(', ')})`
			})

		if (references.length > 0) {
			throw new TicketError(
				'referenced',
				`Cannot delete ${ticketId}: it is referenced by ${references.join(', ')}. Unlink those references first.`,
				{ details: references },
			)
		}

		await this.storage.remove(ticketId)
		return { id: ticketId, deleted: true }
	}

	async search(filters: TicketSearchFilters = {}): Promise<TicketSearchResult> {
		const tickets = await this.loadDerived()
		return searchTickets(tickets, filters)
	}

	private async loadDerived(): Promise<DerivedTicket[]> {
		const tickets = await this.storage.loadAll()
		validateGraph(tickets)
		return deriveAll(tickets)
	}

	private validateCreateShape(input: CreateTicketInput): void {
		const record = input as Record<string, unknown>
		if (record.title === undefined) {
			throw new TicketError('invalid_input', 'Create requires a title.')
		}
		if (record.id !== undefined) {
			throw new TicketError('invalid_input', 'Create does not accept an id; IDs are generated by the plugin.')
		}
		if (record.status !== undefined) {
			throw new TicketError('invalid_input', 'Create does not accept a status; new tickets start as open.')
		}
		const unknown = Object.keys(record).filter(
			key => record[key] !== undefined && !CREATE_KEYS.has(key as keyof CreateTicketInput),
		)
		if (unknown.length > 0) {
			throw new TicketError(
				'invalid_input',
				`Unknown create field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`,
			)
		}
	}

	private validateUpdateShape(changes: UpdateTicketInput): void {
		const unknown = Object.keys(changes).filter(
			key =>
				changes[key as keyof UpdateTicketInput] !== undefined &&
				!UPDATE_KEYS.has(key as keyof UpdateTicketInput),
		)
		if (unknown.length > 0) {
			throw new TicketError(
				'invalid_input',
				`Unknown update field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`,
			)
		}

		const has = (key: keyof UpdateTicketInput): boolean => changes[key] !== undefined
		if (![...UPDATE_KEYS].some(has)) {
			throw new TicketError('invalid_input', 'Update requires at least one field to change.')
		}

		if (has('body') && has('append_body')) {
			throw new TicketError('conflict', 'Use either body or append_body, not both.')
		}
		if (has('labels') && (has('add_labels') || has('remove_labels'))) {
			throw new TicketError('conflict', 'Use either labels or add_labels/remove_labels, not both.')
		}
		if (has('blocked_by') && (has('add_blocked_by') || has('remove_blocked_by'))) {
			throw new TicketError('conflict', 'Use either blocked_by or add_blocked_by/remove_blocked_by, not both.')
		}

		this.rejectOverlap(changes.add_labels, changes.remove_labels, 'add_labels', 'remove_labels', normalizeLabels)
		this.rejectOverlap(
			changes.add_blocked_by,
			changes.remove_blocked_by,
			'add_blocked_by',
			'remove_blocked_by',
			normalizeTicketIds,
		)
	}

	private rejectOverlap(
		add: string[] | undefined,
		remove: string[] | undefined,
		addField: string,
		removeField: string,
		normalize: (values: unknown, field: string) => string[],
	): void {
		if (add === undefined || remove === undefined) return
		const additions = normalize(add, addField)
		const removals = normalize(remove, removeField)
		const overlap = additions.filter(value => removals.includes(value))
		if (overlap.length > 0) {
			throw new TicketError(
				'conflict',
				`Cannot both add and remove ${addField === 'add_labels' ? 'label' : 'blocker'}${overlap.length === 1 ? '' : 's'}: ${overlap.join(', ')}.`,
			)
		}
	}

	private async allocateId(tickets: readonly Ticket[]): Promise<string> {
		let highest = 0
		for (const ticket of tickets) {
			const match = /^TK-(\d+)$/.exec(ticket.id)
			if (match) highest = Math.max(highest, Number(match[1]))
		}
		let id = `TK-${highest + 1}`
		while (await this.storage.exists(id)) {
			highest += 1
			id = `TK-${highest + 1}`
		}
		return id
	}
}

function stripDerived(ticket: DerivedTicket): Ticket {
	return {
		id: ticket.id,
		title: ticket.title,
		status: ticket.status,
		labels: [...ticket.labels],
		parent: ticket.parent,
		blocked_by: [...ticket.blocked_by],
		body: ticket.body,
	}
}

function findByDerivedId(tickets: DerivedTicket[], id: string): DerivedTicket {
	const ticket = tickets.find(candidate => candidate.id === id)
	if (!ticket) throw new TicketError('not_found', `Ticket ${id} does not exist.`)
	return ticket
}
