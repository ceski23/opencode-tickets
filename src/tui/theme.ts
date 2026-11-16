import type { Context } from '@opencode/plugin/tui/context'
import { RGBA } from '@opentui/core'
import type { TicketStatus } from '../core/schema'
import type { GetTicketResult } from '../rpc'

export type TuiTheme = Context['theme']

/**
 * Selected list rows need a highlight that visibly matches the accent-colored
 * left border. Theme action states can resolve to the plain surface color, so
 * derive a tint from the accent instead.
 */
export function selectionBackground(theme: TuiTheme): RGBA {
	const [ar, ag, ab] = theme.hue.accent[500].toInts()
	const [br, bg, bb] = theme.background.base.toInts()
	const amount = 0.22
	return RGBA.fromInts(
		Math.round(br + (ar - br) * amount),
		Math.round(bg + (ag - bg) * amount),
		Math.round(bb + (ab - bb) * amount),
	)
}

export function statusColor(status: TicketStatus, theme: TuiTheme, variant: 'marker' | 'title' = 'marker'): RGBA {
	switch (status) {
		case 'open':
			return variant === 'title' ? theme.text.base : theme.text.muted
		case 'in_progress':
			return theme.text.feedback.info.base
		case 'closed':
			return variant === 'title' ? theme.text.faint : theme.text.feedback.success.base
	}
}

export function readinessLabel(result: GetTicketResult): string {
	const ticket = result.ticket
	if (ticket.status === 'closed') return 'closed'
	if (ticket.ready) return 'ready'
	if (ticket.blocked) return 'blocked'
	return 'not ready'
}

export function readinessColor(result: GetTicketResult, theme: TuiTheme): RGBA {
	if (result.ticket.status === 'closed') return theme.text.faint
	if (result.ticket.ready) return theme.text.feedback.success.base
	if (result.ticket.blocked) return theme.text.feedback.error.base
	return theme.text.muted
}
