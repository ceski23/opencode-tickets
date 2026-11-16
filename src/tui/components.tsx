import { createTextAttributes, type RGBA } from '@opentui/core'
import { createMemo, For, Show } from 'solid-js'
import type { TicketSummary } from '../core/schema'
import type { GetTicketResult } from '../rpc'
import { statusLabel, statusMarker, TREE_SYMBOLS, treePrefix, type TicketFilter, type TreeRow } from '../tui-model'
import { TREE_PANE_WIDTH } from './constants'
import { onPrimaryMouseDown } from './events'
import { readinessColor, readinessLabel, selectionBackground, statusColor, type TuiTheme } from './theme'

type Counts = { open: number; inProgress: number; closed: number }

export function TicketsHeader(props: {
	theme: TuiTheme
	total: number
	counts: Counts
	filter: TicketFilter
	onFilter: (filter: TicketFilter) => void
}) {
	return (
		<box
			flexDirection="row"
			flexShrink={0}
			backgroundColor={props.theme.background.raised.high}
			paddingLeft={2}
			paddingRight={2}
			paddingTop={1}
			paddingBottom={1}
		>
			<text
				fg={props.theme.text.base}
				selectable={false}
			>
				Tickets
			</text>
			<box flexGrow={1} />
			<HeaderFilter
				theme={props.theme}
				label="all"
				count={props.total}
				active={props.filter === 'all'}
				color={props.theme.text.base}
				onSelect={() => props.onFilter('all')}
			/>
			<text
				fg={props.theme.text.faint}
				selectable={false}
			>
				{' '}
				|{' '}
			</text>
			<HeaderFilter
				theme={props.theme}
				label="open"
				count={props.counts.open}
				active={props.filter === 'open'}
				color={props.theme.text.muted}
				onSelect={() => props.onFilter('open')}
			/>
			<text
				fg={props.theme.text.faint}
				selectable={false}
			>
				{' '}
				|{' '}
			</text>
			<HeaderFilter
				theme={props.theme}
				label="active"
				count={props.counts.inProgress}
				active={props.filter === 'in_progress'}
				color={props.theme.text.feedback.info.base}
				onSelect={() => props.onFilter('in_progress')}
			/>
			<text
				fg={props.theme.text.faint}
				selectable={false}
			>
				{' '}
				|{' '}
			</text>
			<HeaderFilter
				theme={props.theme}
				label="closed"
				count={props.counts.closed}
				active={props.filter === 'closed'}
				color={props.theme.text.feedback.success.base}
				onSelect={() => props.onFilter('closed')}
			/>
		</box>
	)
}

function HeaderFilter(props: {
	theme: TuiTheme
	label: string
	count: number
	active: boolean
	color: RGBA
	onSelect: () => void
}) {
	return (
		<text
			fg={props.active ? props.theme.hue.accent[500] : props.color}
			attributes={createTextAttributes({ bold: props.active, underline: props.active })}
			selectable={false}
			onMouseDown={onPrimaryMouseDown(props.onSelect, true)}
		>
			{props.label} {props.count}
		</text>
	)
}

export function TicketsTree(props: {
	theme: TuiTheme
	rows: readonly TreeRow[]
	selected: string | null
	loading: boolean
	hasTickets: boolean
	onSelect: (id: string) => void
	onToggle: (id: string) => void
}) {
	return (
		<box
			flexDirection="column"
			width={TREE_PANE_WIDTH}
			flexShrink={0}
			minHeight={0}
			border={['right']}
			borderColor={props.theme.border.base}
			paddingRight={1}
		>
			<Show when={props.loading && !props.hasTickets}>
				<box
					flexDirection="column"
					paddingTop={2}
					paddingBottom={2}
				>
					<text fg={props.theme.text.muted}>Loading tickets...</text>
				</box>
			</Show>

			<Show when={!props.loading && !props.hasTickets}>
				<box
					flexDirection="column"
					paddingTop={2}
					paddingBottom={2}
				>
					<text fg={props.theme.text.base}>No tickets yet.</text>
					<text fg={props.theme.text.muted}>Ask the agent to create one with the ticket create tool.</text>
				</box>
			</Show>

			<Show when={!props.loading && props.hasTickets && props.rows.length === 0}>
				<box
					flexDirection="column"
					paddingTop={2}
					paddingBottom={2}
				>
					<text fg={props.theme.text.muted}>No tickets match this filter.</text>
				</box>
			</Show>

			<Show when={props.rows.length > 0}>
				<scrollbox
					flexGrow={1}
					flexShrink={1}
					minHeight={0}
					flexDirection="column"
					scrollY={true}
				>
					<box
						flexDirection="column"
						flexShrink={0}
						paddingTop={1}
						paddingBottom={1}
					>
						<For each={props.rows}>
							{row => (
								<TicketRow
									row={row}
									selected={props.selected === row.ticket.id}
									theme={props.theme}
									onSelect={props.onSelect}
									onToggle={props.onToggle}
								/>
							)}
						</For>
					</box>
				</scrollbox>
			</Show>
		</box>
	)
}

function TicketRow(props: {
	row: TreeRow
	selected: boolean
	theme: TuiTheme
	onSelect: (id: string) => void
	onToggle: (id: string) => void
}) {
	const ticket = props.row.ticket
	const background = createMemo(() =>
		props.selected ? selectionBackground(props.theme) : props.theme.background.base,
	)
	const titleAttributes = createMemo(() =>
		createTextAttributes({
			bold: props.selected,
			strikethrough: ticket.status === 'closed',
		}),
	)

	return (
		<box
			flexDirection="row"
			height={1}
			flexShrink={0}
			backgroundColor={background()}
			onMouseDown={onPrimaryMouseDown(() => props.onSelect(ticket.id))}
		>
			<text
				fg={props.selected ? props.theme.hue.accent[500] : undefined}
				flexShrink={0}
				selectable={false}
			>
				{props.selected ? TREE_SYMBOLS.selection : ' '}
			</text>
			<text
				fg={statusColor(ticket.status, props.theme)}
				flexShrink={0}
				selectable={false}
			>
				{statusMarker(ticket.status)}
				{props.row.depth === 0 ? '' : ' '}
			</text>
			<text
				fg={props.theme.text.muted}
				flexShrink={0}
				selectable={false}
			>
				{treePrefix(props.row)}
			</text>
			<Show when={props.row.hasChildren}>
				<box
					flexShrink={0}
					onMouseDown={onPrimaryMouseDown(() => props.onToggle(ticket.id), true)}
				>
					<text
						fg={props.theme.text.muted}
						selectable={false}
					>
						{props.row.expanded ? TREE_SYMBOLS.expanded : TREE_SYMBOLS.collapsed}{' '}
					</text>
				</box>
			</Show>
			<Show when={ticket.blocked}>
				<text
					fg={props.theme.text.feedback.error.base}
					flexShrink={0}
					selectable={false}
				>
					{TREE_SYMBOLS.blocked}{' '}
				</text>
			</Show>
			<text
				fg={props.theme.text.muted}
				flexShrink={0}
				selectable={false}
			>
				{props.selected ? <b>{ticket.id} </b> : `${ticket.id} `}
			</text>
			<text
				fg={statusColor(ticket.status, props.theme, 'title')}
				attributes={titleAttributes()}
				wrapMode="none"
				truncate
				flexGrow={1}
				flexShrink={1}
				minWidth={0}
				selectable={false}
			>
				{ticket.title}
			</text>
		</box>
	)
}

export function TicketsDetail(props: {
	theme: TuiTheme
	result: GetTicketResult | null
	loading: boolean
	error: string | null
	empty: boolean
	syntax: ReturnType<typeof import('@opencode/theme/tui').generateSyntax>
	onSelect: (id: string) => void
}) {
	return (
		<box
			flexDirection="column"
			flexGrow={1}
			flexShrink={1}
			minWidth={0}
			minHeight={0}
			paddingLeft={2}
		>
			<Show
				when={props.result}
				fallback={
					<DetailPlaceholder
						theme={props.theme}
						loading={props.loading}
						error={props.error}
						empty={props.empty}
					/>
				}
			>
				{(result: () => GetTicketResult) => {
					const ticket = () => result().ticket
					return (
						<box
							flexDirection="column"
							flexGrow={1}
							minHeight={0}
						>
							<scrollbox
								flexGrow={1}
								flexShrink={1}
								minHeight={0}
								flexDirection="column"
								scrollY={true}
							>
								<box
									flexDirection="column"
									flexShrink={0}
									paddingTop={1}
									paddingBottom={1}
								>
									<text
										fg={props.theme.text.base}
										wrapMode="word"
									>
										{ticket().title}
									</text>
									<text
										fg={props.theme.text.muted}
										wrapMode="word"
									>
										{ticket().id} | {statusLabel(ticket().status)}
									</text>
									<text
										fg={readinessColor(result(), props.theme)}
										wrapMode="word"
									>
										{readinessLabel(result())}
									</text>

									<box
										flexDirection="column"
										flexShrink={0}
										paddingTop={1}
									>
										<Show when={ticket().labels.length > 0}>
											<DetailLine
												theme={props.theme}
												label="Labels"
												value={ticket().labels.join(', ')}
												color={props.theme.text.base}
											/>
										</Show>
										<Show when={result().parent}>
											{(parent: () => TicketSummary) => (
												<DetailTicket
													theme={props.theme}
													label="Parent"
													item={parent()}
													onSelect={props.onSelect}
												/>
											)}
										</Show>
										<Show when={result().children.length > 0}>
											<DetailList
												theme={props.theme}
												label="Children"
												items={result().children}
												color={props.theme.text.base}
												onSelect={props.onSelect}
											/>
										</Show>
										<Show when={result().blockers.length > 0}>
											<DetailList
												theme={props.theme}
												label="Blocked by"
												items={result().blockers}
												color={props.theme.text.feedback.error.base}
												danger
												showStatus
												onSelect={props.onSelect}
											/>
										</Show>
										<Show when={result().blocks.length > 0}>
											<DetailList
												theme={props.theme}
												label="Blocks"
												items={result().blocks}
												color={props.theme.text.base}
												onSelect={props.onSelect}
											/>
										</Show>
									</box>

									<text
										fg={props.theme.text.faint}
										wrapMode="word"
									>
										Read-only. Changes are made by the agent.
									</text>

									<box
										flexDirection="column"
										paddingTop={1}
									>
										<Show
											when={ticket().body.length > 0}
											fallback={<text fg={props.theme.text.faint}>(No Markdown body.)</text>}
										>
											<markdown
												content={ticket().body}
												syntaxStyle={props.syntax}
												fg={props.theme.text.base}
											/>
										</Show>
									</box>
								</box>
							</scrollbox>
						</box>
					)
				}}
			</Show>
		</box>
	)
}

function DetailPlaceholder(props: { theme: TuiTheme; loading: boolean; error: string | null; empty: boolean }) {
	return (
		<box
			flexDirection="column"
			flexGrow={1}
			paddingTop={2}
			paddingBottom={2}
		>
			<Show when={props.error !== null}>
				<box flexDirection="column">
					<text fg={props.theme.text.feedback.error.base}>Could not load ticket</text>
					<text fg={props.theme.text.feedback.error.muted}>{props.error}</text>
				</box>
			</Show>
			<Show when={props.error === null && props.loading}>
				<text fg={props.theme.text.muted}>Loading ticket...</text>
			</Show>
			<Show when={props.error === null && !props.loading}>
				<text fg={props.theme.text.faint}>
					{props.empty ? 'No ticket selected.' : 'Select a ticket to read it here.'}
				</text>
			</Show>
		</box>
	)
}

function DetailLine(props: { label: string; value: string; color: RGBA; theme: TuiTheme }) {
	return (
		<box
			flexDirection="column"
			flexShrink={0}
			paddingBottom={1}
		>
			<text fg={props.theme.text.muted}>{props.label}</text>
			<text
				fg={props.color}
				wrapMode="word"
			>
				{props.value}
			</text>
		</box>
	)
}

function DetailTicket(props: { label: string; item: TicketSummary; theme: TuiTheme; onSelect: (id: string) => void }) {
	return (
		<box
			flexDirection="column"
			flexShrink={0}
			paddingBottom={1}
		>
			<text fg={props.theme.text.muted}>{props.label}</text>
			<TicketLink
				item={props.item}
				theme={props.theme}
				color={props.theme.text.base}
				onSelect={props.onSelect}
			/>
		</box>
	)
}

function DetailList(props: {
	label: string
	items: readonly TicketSummary[]
	color: RGBA
	theme: TuiTheme
	danger?: boolean
	showStatus?: boolean
	onSelect: (id: string) => void
}) {
	return (
		<box
			flexDirection="column"
			flexShrink={0}
			paddingBottom={1}
		>
			<text fg={props.theme.text.muted}>{props.label}</text>
			<For each={props.items}>
				{item => {
					const resolved = props.showStatus === true && item.status === 'closed'
					return (
						<TicketLink
							item={item}
							theme={props.theme}
							color={resolved ? props.theme.text.muted : props.color}
							danger={props.danger === true && !resolved}
							marker={props.showStatus === true ? statusMarker(item.status) : undefined}
							onSelect={props.onSelect}
						/>
					)
				}}
			</For>
		</box>
	)
}

function TicketLink(props: {
	item: TicketSummary
	theme: TuiTheme
	color: RGBA
	danger?: boolean
	marker?: string
	onSelect: (id: string) => void
}) {
	const linkColor = () => (props.danger ? props.theme.text.feedback.error.base : props.theme.hue.accent[500])

	return (
		<box
			flexDirection="row"
			onMouseDown={onPrimaryMouseDown(() => props.onSelect(props.item.id), true)}
		>
			<text
				fg={props.theme.text.muted}
				flexShrink={0}
				selectable={false}
			>
				-{' '}
			</text>
			<Show when={props.marker !== undefined}>
				<text
					fg={props.color}
					flexShrink={0}
					selectable={false}
				>
					{props.marker}{' '}
				</text>
			</Show>
			<text
				fg={linkColor()}
				attributes={createTextAttributes({ underline: true })}
				flexShrink={0}
				selectable={false}
			>
				{props.item.id}
			</text>
			<text
				fg={props.color}
				wrapMode="word"
				flexGrow={1}
				flexShrink={1}
				minWidth={0}
				selectable={false}
			>
				{' '}
				{props.item.title}
			</text>
		</box>
	)
}

export function TicketsFooter(props: { theme: TuiTheme; surface: TuiTheme }) {
	return (
		<box
			flexDirection="column"
			flexShrink={0}
			backgroundColor={props.theme.background.raised.high}
			paddingLeft={2}
			paddingRight={2}
			paddingTop={1}
			paddingBottom={1}
		>
			<box
				flexDirection="row"
				flexShrink={0}
			>
				<LegendItem
					theme={props.surface}
					symbol={TREE_SYMBOLS.open}
					label="open"
					color={props.surface.text.muted}
				/>
				<LegendItem
					theme={props.surface}
					symbol={TREE_SYMBOLS.inProgress}
					label="active"
					color={props.surface.text.feedback.info.base}
				/>
				<LegendItem
					theme={props.surface}
					symbol={TREE_SYMBOLS.closed}
					label="closed"
					color={props.surface.text.feedback.success.base}
				/>
				<LegendItem
					theme={props.surface}
					symbol={TREE_SYMBOLS.blocked}
					label="blocked"
					color={props.surface.text.feedback.error.base}
				/>
			</box>
			<box
				flexDirection="row"
				flexShrink={0}
			>
				<KeyHint
					theme={props.surface}
					keys="↑↓"
					label="move"
				/>
				<KeyHint
					theme={props.surface}
					keys="→"
					label="expand"
				/>
				<KeyHint
					theme={props.surface}
					keys="←"
					label="collapse"
				/>
				<KeyHint
					theme={props.surface}
					keys="o"
					label="open file"
				/>
				<KeyHint
					theme={props.surface}
					keys="r"
					label="refresh"
				/>
				<KeyHint
					theme={props.surface}
					keys="Esc"
					label="close"
				/>
			</box>
		</box>
	)
}

function LegendItem(props: { theme: TuiTheme; symbol: string; label: string; color: RGBA }) {
	return (
		<box
			flexDirection="row"
			flexShrink={0}
		>
			<text
				fg={props.color}
				selectable={false}
			>
				{props.symbol}
			</text>
			<text
				fg={props.theme.text.faint}
				selectable={false}
			>
				{` ${props.label}   `}
			</text>
		</box>
	)
}

function KeyHint(props: { theme: TuiTheme; keys: string; label: string }) {
	return (
		<box
			flexDirection="row"
			flexShrink={0}
		>
			<text
				fg={props.theme.hue.accent[500]}
				selectable={false}
			>
				{props.keys}
			</text>
			<text
				fg={props.theme.text.faint}
				selectable={false}
			>
				{` ${props.label}   `}
			</text>
		</box>
	)
}
