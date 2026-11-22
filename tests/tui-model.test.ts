import { describe, expect, it } from 'vitest'
import {
	TREE_SYMBOLS,
	buildTreeRows,
	filterTickets,
	formatRpcError,
	parentIdsWithChildren,
	revealTicket,
	statusMarker,
	statusLabel,
	ticketCounts,
	ticketRows,
	treePrefix,
	type TicketListItem,
} from '../src/tui-model'
import { id } from './helpers'

function item(partial: Partial<TicketListItem> & Pick<TicketListItem, 'id' | 'title'>): TicketListItem {
	return {
		status: 'open',
		labels: [],
		parent: null,
		blocked_by: [],
		ready: true,
		blocked: false,
		...partial,
	}
}

const tickets: TicketListItem[] = [
	item({ id: id(5), title: 'Root B' }),
	item({ id: id(1), title: 'Root A' }),
	item({ id: id(3), title: 'Child B', parent: id(1) }),
	item({ id: id(2), title: 'Child A', parent: id(1) }),
	item({ id: id(4), title: 'Grandchild', parent: id(2), status: 'in_progress' }),
	item({ id: id(6), title: 'Closed root', status: 'closed', parent: id(999) }),
]

describe('buildTreeRows', () => {
	it('shows only roots and sorted siblings when collapsed', () => {
		const rows = buildTreeRows(tickets, new Set())
		expect(rows.map(row => row.ticket.id)).toEqual([id(1), id(5), id(6)])
		expect(rows.map(row => row.hasChildren)).toEqual([true, false, false])
		expect(rows.every(row => row.depth === 0)).toBe(true)
	})

	it('nests expanded children in ID order with depth and last flags', () => {
		const rows = buildTreeRows(tickets, new Set([id(1), id(2)]))
		expect(rows.map(row => [row.ticket.id, row.depth, row.last])).toEqual([
			[id(1), 0, false],
			[id(2), 1, false],
			[id(4), 2, true],
			[id(3), 1, true],
			[id(5), 0, false],
			[id(6), 0, true],
		])
	})

	it('omits descendants of collapsed nodes', () => {
		const rows = buildTreeRows(tickets, new Set([id(1)]))
		expect(rows.map(row => row.ticket.id)).toEqual([id(1), id(2), id(3), id(5), id(6)])
	})

	it('keeps a ticket with a missing parent as a root', () => {
		const rows = buildTreeRows([item({ id: id(1), title: 'Orphan', parent: id(9) })], new Set())
		expect(rows).toHaveLength(1)
		expect(rows[0]?.depth).toBe(0)
	})
})

describe('tree helpers', () => {
	it('fuzzy searches IDs, titles and labels while composing with status', () => {
		const list = [...tickets, item({ id: id(7), title: 'Coffee service', labels: ['espresso'] })]
		expect(filterTickets(list, 'all', 'cofee').map(ticket => ticket.id)).toContain(id(7))
		expect(filterTickets(list, 'all', 'tk-7').map(ticket => ticket.id)).toContain(id(7))
		expect(filterTickets(list, 'all', 'espresso').map(ticket => ticket.id)).toContain(id(7))
		expect(filterTickets(list, 'closed', 'coffee')).toEqual([])
		expect(filterTickets(list, 'all', '  ')).toEqual(list)
		expect(filterTickets(list, 'all', 'zzzzzzzzzzzz')).toEqual([])
	})

	it('reveals matching descendants without changing collapsed state', () => {
		const expanded = new Set<string>()
		expect(ticketRows(tickets, 'all', 'child', expanded).map(row => row.ticket.id)).toContain(id(4))
		expect([...expanded]).toEqual([])
		expect(ticketRows(tickets, 'all', '', expanded).map(row => row.ticket.id)).toEqual([id(1), id(5), id(6)])
	})

	it('searches full bodies and respects status and collapsed trees', () => {
		const list = [
			item({ id: id(1), title: 'Parent' }),
			item({
				id: id(2),
				title: 'Child',
				parent: id(1),
				status: 'in_progress',
				body: `${'x '.repeat(100)}Moonlight espresso`,
			}),
		]
		const expanded = new Set<string>()
		expect(ticketRows(list, 'all', 'moonligt espresso', expanded).map(row => row.ticket.id)).toEqual([id(2)])
		expect(ticketRows(list, 'open', 'moonlight espresso', expanded)).toEqual([])
		expect(ticketRows(list, 'all', '', expanded).map(row => row.ticket.id)).toEqual([id(1)])
	})

	it('renders tree prefixes for branches and last children', () => {
		const rows = buildTreeRows(tickets, new Set([id(1), id(2)]))
		expect(treePrefix(rows[0]!)).toBe('')
		expect(treePrefix(rows[1]!)).toBe('├─ ')
		expect(treePrefix(rows[2]!)).toBe('│  └─ ')
		expect(treePrefix(rows[3]!)).toBe('└─ ')
	})

	it('finds parents with children in sorted order', () => {
		expect(parentIdsWithChildren(tickets)).toEqual([id(1), id(2)])
	})

	it('counts statuses', () => {
		expect(ticketCounts(tickets)).toEqual({ open: 4, inProgress: 1, closed: 1 })
	})

	it('reveals a linked descendant and clears an incompatible filter', () => {
		const state = revealTicket(tickets, id(4), 'open', new Set())
		expect(state.filter).toBe('all')
		expect([...state.expanded]).toEqual([id(2), id(1)])
		expect(buildTreeRows(filterTickets(tickets, state.filter), state.expanded).map(row => row.ticket.id)).toContain(
			id(4),
		)
	})

	it('reveals a linked child without changing a compatible filter', () => {
		const state = revealTicket(tickets, id(2), 'open', new Set())
		expect(state.filter).toBe('open')
		expect(state.expanded.has(id(1))).toBe(true)
		expect(buildTreeRows(filterTickets(tickets, state.filter), state.expanded).map(row => row.ticket.id)).toContain(
			id(2),
		)
	})

	it('maps statuses to markers and readable labels', () => {
		expect(statusMarker('open')).toBe(TREE_SYMBOLS.open)
		expect(statusMarker('in_progress')).toBe(TREE_SYMBOLS.inProgress)
		expect(statusMarker('closed')).toBe(TREE_SYMBOLS.closed)
		expect(statusLabel('open')).toBe('Open')
		expect(statusLabel('in_progress')).toBe('In progress')
		expect(statusLabel('closed')).toBe('Closed')
		expect(TREE_SYMBOLS.blocked.length).toBeGreaterThan(0)
	})
})

describe('formatRpcError', () => {
	it('prints the message from a plain RPC rejection object', () => {
		expect(formatRpcError({ type: 'invalid_storage', message: 'Ticket file is invalid.', data: {} })).toBe(
			'Ticket file is invalid.',
		)
	})

	it('adds a retry hint when the RPC is still unavailable', () => {
		const message = formatRpcError({
			type: 'rpc.unavailable',
			message: 'RPC is unavailable: ceski23.opencode-tickets.rpc',
		})
		expect(message).toContain('RPC is unavailable: ceski23.opencode-tickets.rpc')
		expect(message).toContain('press r to retry')
	})

	it('handles Error instances', () => {
		expect(formatRpcError(new Error('network down'))).toBe('network down')
	})

	it('falls back to the error type or a string form', () => {
		expect(formatRpcError({ type: 'not_found' })).toBe('not_found')
		expect(formatRpcError({ code: 7 })).toBe('{"code":7}')
		expect(formatRpcError('plain failure')).toBe('plain failure')
	})
})
