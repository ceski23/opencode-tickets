import type { Context } from '@opencode/plugin/tui/context'
import { TicketsRpc, type GetTicketResult, type ListTicketsResult, type TicketsRpcClient } from '../rpc'

export type TicketsRpcConnection = {
	list: () => Promise<ListTicketsResult>
	get: (id: string) => Promise<GetTicketResult>
}

function withTimeout<T>(promise: Promise<T>, ms = 10_000): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('Ticket RPC timed out.')), ms)
		promise.then(
			value => {
				clearTimeout(timer)
				resolve(value)
			},
			error => {
				clearTimeout(timer)
				reject(error)
			},
		)
	})
}

/**
 * The client's RPC method types are intentionally looser than our contract.
 * Keep the single unavoidable cast here so every TUI consumer shares it.
 */
export function ticketsRpc(context: Context): TicketsRpcConnection {
	const location = () => context.location ?? context.data.location.default()
	const options = () => {
		const current = location()
		return {
			location: {
				directory: current.directory,
				...(current.workspaceID === undefined ? {} : { workspaceID: current.workspaceID }),
			},
		}
	}
	const client = () => context.client.rpc(TicketsRpc) as unknown as TicketsRpcClient

	return {
		list: () => withTimeout(client().listTickets({}, options())),
		get: id => withTimeout(client().getTicket({ id }, options())),
	}
}
