import type { Context } from '@opencode/plugin/tui/context'
import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { statusMarker, TREE_SYMBOLS, ticketCounts, type TicketListItem } from '../tui-model'
import { TICKETS_REFRESH_MS } from './constants'
import { onPrimaryMouseDown, onPrimaryMouseUp } from './events'
import { ticketsRpc } from './rpc'
import { statusColor, type TuiTheme } from './theme'

export function TicketsSidebar(props: { context: Context; onOpen: () => void }) {
	const context = props.context
	const theme = context.theme
	const rpc = ticketsRpc(context)

	const [tickets, setTickets] = createSignal<TicketListItem[]>([])
	const [failed, setFailed] = createSignal(false)
	const [sidebar, updateSidebar] = context.storage.store('sidebar', {
		initial: { open: true },
	})

	let request = 0
	let disposed = false

	onCleanup(() => {
		disposed = true
	})

	const open = () => sidebar.open
	const toggle = (): void => {
		if (!open()) void load()
		void updateSidebar(draft => {
			draft.open = !draft.open
		}).catch(() => {})
	}

	const load = async (): Promise<void> => {
		const current = ++request
		try {
			const result = await rpc.list()
			if (disposed || current !== request) return
			setTickets(result.tickets)
			setFailed(false)
		} catch {
			if (disposed || current !== request) return
			setFailed(true)
		}
	}

	onMount(() => {
		void load()
		const timer = setInterval(() => {
			if (open()) void load()
		}, TICKETS_REFRESH_MS)
		onCleanup(() => clearInterval(timer))
	})

	const counts = createMemo(() => ticketCounts(tickets()))
	const outstanding = createMemo(() => tickets().filter(ticket => ticket.status !== 'closed'))
	const highlighted = createMemo(() =>
		[
			...tickets().filter(ticket => ticket.status === 'in_progress'),
			...tickets().filter(ticket => ticket.status === 'open'),
		].slice(0, 5),
	)
	const remaining = createMemo(() => outstanding().length - highlighted().length)

	return (
		<Show when={failed() || tickets().length > 0}>
			<box
				flexDirection="column"
				flexShrink={0}
				paddingTop={1}
			>
				<box
					flexDirection="row"
					onMouseDown={onPrimaryMouseDown(toggle, true)}
				>
					<text
						fg={theme.text.base}
						selectable={false}
					>
						<b>{open() ? TREE_SYMBOLS.expanded : TREE_SYMBOLS.collapsed} Tickets</b>
					</text>
					<box flexGrow={1} />
					<text
						fg={theme.text.muted}
						selectable={false}
					>
						{counts().open} open | {counts().inProgress} active
					</text>
				</box>

				<Show when={open()}>
					<box
						flexDirection="column"
						onMouseUp={onPrimaryMouseUp(props.onOpen, true)}
					>
						<Show
							when={!failed()}
							fallback={
								<text
									fg={theme.text.feedback.warning.muted}
									selectable={false}
								>
									Tickets unavailable
								</text>
							}
						>
							<For each={highlighted()}>
								{ticket => (
									<SidebarTicketRow
										ticket={ticket}
										theme={theme}
									/>
								)}
							</For>
						</Show>

						<Show when={remaining() > 0}>
							<text
								fg={theme.text.faint}
								selectable={false}
							>
								and {remaining()} more
							</text>
						</Show>
					</box>
				</Show>
			</box>
		</Show>
	)
}

function SidebarTicketRow(props: { ticket: TicketListItem; theme: TuiTheme }) {
	const color = statusColor(props.ticket.status, props.theme)

	return (
		<box
			flexDirection="row"
			flexShrink={0}
			width="100%"
		>
			<text
				fg={color}
				flexShrink={0}
				selectable={false}
			>
				{statusMarker(props.ticket.status)}{' '}
			</text>
			<text
				fg={props.theme.text.muted}
				flexShrink={0}
				selectable={false}
			>
				{props.ticket.id}{' '}
			</text>
			<text
				fg={color}
				wrapMode="none"
				truncate
				flexGrow={1}
				flexShrink={1}
				minWidth={0}
				selectable={false}
			>
				{props.ticket.title}
			</text>
		</box>
	)
}
