import { TicketError } from './errors'
import { compareTicketIds, type DerivedTicket, type Ticket, type TicketSummary } from './schema'

/**
 * Validate every graph invariant before any ticket is written. The caller sees
 * one error that lists all problems, rather than one problem per attempt.
 */
export function validateGraph(tickets: readonly Ticket[]): void {
	const issues: string[] = []
	const byId = new Map<string, Ticket>()

	for (const ticket of tickets) {
		if (byId.has(ticket.id)) issues.push(`Duplicate ticket ID "${ticket.id}".`)
		byId.set(ticket.id, ticket)
	}

	for (const ticket of tickets) {
		if (ticket.parent !== null) {
			if (ticket.parent === ticket.id) {
				issues.push(`Ticket ${ticket.id} cannot be its own parent.`)
			} else if (!byId.has(ticket.parent)) {
				issues.push(`Ticket ${ticket.id} references missing parent "${ticket.parent}".`)
			}
		}
		for (const blocker of ticket.blocked_by) {
			if (blocker === ticket.id) {
				issues.push(`Ticket ${ticket.id} cannot block itself.`)
			} else if (!byId.has(blocker)) {
				issues.push(`Ticket ${ticket.id} references missing blocker "${blocker}".`)
			}
		}
	}

	issues.push(...findCycles(tickets, ticket => (ticket.parent === null ? [] : [ticket.parent]), 'Parent'))
	issues.push(...findCycles(tickets, ticket => ticket.blocked_by, 'Blocking'))

	if (issues.length > 0) {
		const unique = [...new Set(issues)]
		throw new TicketError(
			'invalid_storage',
			`Ticket relationships are invalid:\n${unique.map(issue => `- ${issue}`).join('\n')}`,
			{ details: unique },
		)
	}
}

function findCycles(
	tickets: readonly Ticket[],
	edges: (ticket: Ticket) => readonly string[],
	kind: 'Parent' | 'Blocking',
): string[] {
	const byId = new Map(tickets.map(ticket => [ticket.id, ticket]))
	const state = new Map<string, 0 | 1 | 2>()
	const stack: string[] = []
	const issues: string[] = []

	const visit = (id: string): void => {
		state.set(id, 1)
		stack.push(id)
		const ticket = byId.get(id)
		if (ticket) {
			for (const next of edges(ticket)) {
				if (!byId.has(next)) continue
				const nextState = state.get(next) ?? 0
				if (nextState === 0) {
					visit(next)
				} else if (nextState === 1) {
					const start = stack.indexOf(next)
					const cycle = [...stack.slice(Math.max(start, 0)), next]
					issues.push(`${kind} cycle detected: ${cycle.join(' -> ')}.`)
				}
			}
		}
		stack.pop()
		state.set(id, 2)
	}

	for (const ticket of tickets) {
		if ((state.get(ticket.id) ?? 0) === 0) visit(ticket.id)
	}
	return issues
}

/**
 * Compute reverse relationships and readiness. These values are never stored.
 */
export function deriveAll(tickets: readonly Ticket[]): DerivedTicket[] {
	const byId = new Map(tickets.map(ticket => [ticket.id, ticket]))
	const children = new Map<string, string[]>()
	const blocks = new Map<string, string[]>()

	for (const ticket of tickets) {
		if (ticket.parent !== null) {
			const list = children.get(ticket.parent) ?? []
			list.push(ticket.id)
			children.set(ticket.parent, list)
		}
		for (const blocker of ticket.blocked_by) {
			const list = blocks.get(blocker) ?? []
			list.push(ticket.id)
			blocks.set(blocker, list)
		}
	}

	return tickets.map(ticket => {
		const blocked = ticket.blocked_by.some(id => byId.get(id)?.status !== 'closed')
		return {
			...ticket,
			children: (children.get(ticket.id) ?? []).sort(compareTicketIds),
			blocks: (blocks.get(ticket.id) ?? []).sort(compareTicketIds),
			ready: ticket.status === 'open' && !blocked,
			blocked,
		}
	})
}

export function summarizeTicket(ticket: DerivedTicket): TicketSummary {
	return {
		id: ticket.id,
		title: ticket.title,
		status: ticket.status,
		labels: [...ticket.labels],
		parent: ticket.parent,
		blocked_by: [...ticket.blocked_by],
		ready: ticket.ready,
		blocked: ticket.blocked,
	}
}
