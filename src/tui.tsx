import { join } from 'node:path'
import { Plugin } from '@opencode/plugin/tui'
import type { Context } from '@opencode/plugin/tui/context'
import { generateSyntax } from '@opencode/theme/tui'
import openFile from 'open'
import { createMemo, onCleanup, Show } from 'solid-js'
import { useTicketBrowser } from './tui/browser.tsx'
import { TicketsDetail, TicketsFooter, TicketsHeader, TicketsTree } from './tui/components'
import { DIALOG_HEIGHT_RESERVE, DIALOG_MAX_HEIGHT, DIALOG_MIN_HEIGHT } from './tui/constants'
import { TicketsSidebar } from './tui/sidebar'

export default Plugin.define({
	id: 'opencode-local-tickets',
	setup(context) {
		let open = false

		const openTickets = (): void => {
			if (open) return
			open = true
			// The native backdrop intentionally ignores the first click while text is
			// selected. Opening the browser must not inherit the sidebar click's
			// selection, or dismissing it would take two clicks.
			context.renderer.clearSelection()
			context.ui.dialog.show(
				() => <TicketsDialog context={context} />,
				() => {
					open = false
				},
			)
			// show() starts a new dialog at the default size and position, so the
			// presentation options must be applied after it.
			context.ui.dialog.set({ size: 'xlarge', centered: true })
		}

		context.keymap.layer(() => ({
			mode: 'global',
			priority: 10,
			commands: [
				{
					id: 'tickets.open',
					title: 'Tickets',
					description: "Browse the project's local ticket tree.",
					group: 'Plugins',
					palette: true,
					slash: { name: 'tickets' },
					run: openTickets,
				},
			],
		}))

		return context.ui.slot({
			prepend: 'sidebar.content',
			render: () => (
				<TicketsSidebar
					context={context}
					onOpen={openTickets}
				/>
			),
		})
	},
})

export function TicketsDialog(props: { context: Context }) {
	const context = props.context
	const theme = context.theme.surface('dialog')
	const footerTheme = context.theme.surface('dialog.footer')
	const browser = useTicketBrowser(context)

	const syntax = generateSyntax(theme, context.renderer.nativeScene)
	onCleanup(() => {
		void context.renderer.idle().then(() => syntax.destroy())
	})

	const dialogMaxHeight = createMemo(() =>
		Math.max(
			DIALOG_MIN_HEIGHT,
			Math.min(DIALOG_MAX_HEIGHT, (context.renderer.height || 30) - DIALOG_HEIGHT_RESERVE),
		),
	)

	context.keymap.layer(() => ({
		mode: 'global',
		priority: 30,
		commands: [
			{
				id: 'tickets.move-up',
				title: 'Tickets: move up',
				bind: 'up',
				enabled: () => !browser.loading() && browser.error() === null,
				run: () => browser.move(-1),
			},
			{
				id: 'tickets.move-down',
				title: 'Tickets: move down',
				bind: 'down',
				enabled: () => !browser.loading() && browser.error() === null,
				run: () => browser.move(1),
			},
			{
				id: 'tickets.expand',
				title: 'Tickets: expand or enter child',
				bind: 'right',
				enabled: () => !browser.loading() && browser.error() === null,
				run: browser.expand,
			},
			{
				id: 'tickets.collapse',
				title: 'Tickets: collapse or go to parent',
				bind: 'left',
				enabled: () => !browser.loading() && browser.error() === null,
				run: browser.collapse,
			},
			{
				id: 'tickets.close',
				title: 'Tickets: close',
				description: 'Close the ticket browser and return to the previous screen.',
				bind: 'escape',
				run: () => context.ui.dialog.clear(),
			},
			{
				id: 'tickets.open-file',
				title: 'Tickets: open file',
				description: "Open the selected ticket's Markdown file in the default editor.",
				bind: 'o',
				enabled: () => browser.selected() !== null && browser.error() === null,
				run: () => {
					const id = browser.selected()
					if (id === null) return
					const location = context.location ?? context.data.location.default()
					const file = join(location.directory, '.opencode', 'tickets', `${id}.md`)
					void openFile(file).catch(() => {})
				},
			},
			{
				id: 'tickets.refresh',
				title: 'Tickets: refresh',
				bind: 'r',
				run: browser.refresh,
			},
		],
	}))

	return (
		<box
			flexDirection="column"
			width="100%"
			maxHeight={dialogMaxHeight()}
			flexShrink={0}
			alignSelf="stretch"
			marginTop={-1}
			backgroundColor={theme.background.base}
		>
			<TicketsHeader
				theme={theme}
				total={browser.tickets().length}
				counts={browser.counts()}
				filter={browser.filter()}
				onFilter={browser.changeFilter}
			/>

			<Show when={browser.error() !== null}>
				<box
					flexDirection="column"
					flexGrow={1}
					paddingLeft={2}
					paddingRight={2}
					paddingTop={1}
					paddingBottom={1}
				>
					<text fg={theme.text.feedback.error.base}>Could not load tickets</text>
					<text fg={theme.text.feedback.error.muted}>{browser.error()}</text>
					<text fg={theme.text.muted}>
						Check the ticket files under .opencode/tickets, then press r to retry.
					</text>
				</box>
			</Show>

			<Show when={browser.error() === null}>
				<box
					flexDirection="row"
					flexGrow={1}
					flexShrink={1}
					minHeight={0}
					paddingLeft={2}
					paddingRight={2}
				>
					<TicketsTree
						theme={theme}
						rows={browser.rows()}
						selected={browser.selected()}
						loading={browser.loading()}
						hasTickets={browser.tickets().length > 0}
						onSelect={browser.select}
						onToggle={browser.toggle}
					/>
					<TicketsDetail
						theme={theme}
						result={browser.detail()}
						loading={browser.detailLoading()}
						error={browser.detailError()}
						empty={!browser.loading() && browser.tickets().length === 0}
						syntax={syntax}
						onSelect={browser.select}
					/>
				</box>
			</Show>

			<TicketsFooter
				theme={theme}
				surface={footerTheme}
			/>
		</box>
	)
}
