import type { Context } from '@opencode/plugin/tui/context'
// Keep this module .tsx: OpenCode's plugin runtime resolves "solid-js" for
// plain .ts modules to the server build, which is a different non-reactive
// runtime than the one used by the JSX renderer. Everything reactive must be
// created in a module compiled by the JSX pipeline.
import { createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import type { GetTicketResult } from '../rpc'
import {
	collapseTarget,
	expandTarget,
	formatRpcError,
	moveSelection,
	parentIdsWithChildren,
	reconcileSelection,
	revealTicket,
	ticketCounts,
	ticketRows,
	type TicketFilter,
	type TicketListItem,
} from '../tui-model'
import { ticketsRpc } from './rpc'

/**
 * Owns ticket loading, selection, filtering, and tree navigation for the
 * dialog. Keeping this out of the JSX makes the request and selection rules
 * testable and leaves the component as a composition root.
 */
export function useTicketBrowser(context: Context) {
	const rpc = ticketsRpc(context)
	const [tickets, setTickets] = createSignal<TicketListItem[]>([])
	const [filter, setFilter] = createSignal<TicketFilter>('all')
	const [query, setQuery] = createSignal('')
	const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
	const [selected, setSelected] = createSignal<string | null>(null)
	const [loading, setLoading] = createSignal(true)
	const [error, setError] = createSignal<string | null>(null)
	const [detail, setDetail] = createSignal<GetTicketResult | null>(null)
	const [detailError, setDetailError] = createSignal<string | null>(null)
	const [detailLoading, setDetailLoading] = createSignal(false)

	let hydrated = false
	let detailRequest = 0
	let listRequest = 0
	let disposed = false

	onCleanup(() => {
		disposed = true
	})

	const rows = createMemo(() => ticketRows(tickets(), filter(), query(), expanded()))
	const counts = createMemo(() => ticketCounts(tickets()))

	const clearDetail = (): void => {
		detailRequest += 1
		setDetail(null)
		setDetailError(null)
		setDetailLoading(false)
	}

	const loadDetail = async (id: string): Promise<void> => {
		const request = ++detailRequest
		setDetailLoading(true)
		setDetailError(null)
		try {
			const result = await rpc.get(id)
			if (disposed || request !== detailRequest) return
			setDetail(result)
		} catch (cause) {
			if (disposed || request !== detailRequest) return
			setDetail(null)
			setDetailError(formatRpcError(cause))
		} finally {
			if (!disposed && request === detailRequest) setDetailLoading(false)
		}
	}

	const select = (id: string): void => {
		if (!query().trim() || !rows().some(row => row.ticket.id === id)) {
			setQuery('')
			const reveal = revealTicket(tickets(), id, filter(), expanded())
			setFilter(reveal.filter)
			setExpanded(reveal.expanded)
		}
		if (selected() === id && detail() !== null) return
		setSelected(id)
		setDetail(null)
		setDetailError(null)
		void loadDetail(id)
	}

	const refreshDetail = (id: string): void => {
		setDetail(null)
		setDetailError(null)
		void loadDetail(id)
	}

	const loadList = async (): Promise<boolean> => {
		const request = ++listRequest
		setLoading(true)
		setError(null)
		try {
			const result = await rpc.list(true)
			if (disposed || request !== listRequest) return false

			const nextTickets = result.tickets
			const parents = new Set(parentIdsWithChildren(nextTickets))
			const nextExpanded = new Set([...expanded()].filter(id => parents.has(id)))
			if (!hydrated) {
				for (const id of parents) nextExpanded.add(id)
				hydrated = true
			}

			setTickets(nextTickets)
			setExpanded(nextExpanded)

			const nextSelected = reconcileSelection(
				ticketRows(nextTickets, filter(), query(), nextExpanded),
				selected(),
			)
			setSelected(nextSelected)
			if (nextSelected === null) clearDetail()
			else refreshDetail(nextSelected)
			return true
		} catch (cause) {
			if (disposed || request !== listRequest) return false
			setTickets([])
			setError(formatRpcError(cause))
			setSelected(null)
			clearDetail()
			return false
		} finally {
			if (!disposed && request === listRequest) setLoading(false)
		}
	}

	const changeFilter = (next: TicketFilter): void => {
		if (filter() === next) return
		setFilter(next)
		const nextRows = ticketRows(tickets(), next, query(), expanded())
		const nextSelected = reconcileSelection(nextRows, selected())
		if (nextSelected === selected() && detail() !== null) return
		setSelected(nextSelected)
		if (nextSelected === null) clearDetail()
		else refreshDetail(nextSelected)
	}

	const changeQuery = (next: string): void => {
		setQuery(next)
		const nextSelected = reconcileSelection(ticketRows(tickets(), filter(), next, expanded()), selected())
		if (nextSelected === selected()) return
		setSelected(nextSelected)
		if (nextSelected === null) clearDetail()
		else refreshDetail(nextSelected)
	}

	const toggle = (id: string): void => {
		if (query().trim()) return
		const next = new Set(expanded())
		if (next.has(id)) next.delete(id)
		else next.add(id)
		setExpanded(next)
		if (
			selected() !== null &&
			!ticketRows(tickets(), filter(), query(), next).some(row => row.ticket.id === selected())
		) {
			select(id)
		}
	}

	const move = (delta: number): void => {
		const id = moveSelection(rows(), selected(), delta)
		if (id !== null) select(id)
	}

	const expand = (): void => {
		const target = expandTarget(rows(), selected())
		if (target === null) return
		if (target.kind === 'toggle') toggle(target.id)
		else select(target.id)
	}

	const collapse = (): void => {
		const target = collapseTarget(rows(), selected())
		if (target === null) return
		if (target.kind === 'toggle') toggle(target.id)
		else select(target.id)
	}

	const refresh = (): void => {
		void loadList()
	}

	// Load after the dialog's reactive owner is mounted. Starting this during
	// component setup can resolve before the tree subscribes to the signals and
	// leaves the dialog showing its first (empty) snapshot forever.
	onMount(() => {
		void loadList()
	})

	return {
		tickets,
		filter,
		query,
		selected,
		loading,
		error,
		detail,
		detailError,
		detailLoading,
		rows,
		counts,
		select,
		changeFilter,
		changeQuery,
		toggle,
		move,
		expand,
		collapse,
		refresh,
	}
}
