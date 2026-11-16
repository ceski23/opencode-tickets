import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DerivedTicket, Ticket, TicketStatus } from '../src/core/schema'

export async function withTempProject<T>(run: (root: string) => Promise<T>): Promise<T> {
	const root = await mkdtemp(join(tmpdir(), 'opencode-tickets-'))
	try {
		return await run(root)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
}

export function id(number: number): string {
	return `TK-${number}`
}

export function ticket(partial: Partial<Ticket> & Pick<Ticket, 'id' | 'title'>): Ticket {
	return {
		status: 'open',
		labels: [],
		parent: null,
		blocked_by: [],
		body: '',
		...partial,
	}
}

export function derived(
	partial: Partial<DerivedTicket> & Pick<DerivedTicket, 'id' | 'title' | 'status'>,
): DerivedTicket {
	return {
		labels: [],
		parent: null,
		blocked_by: [],
		body: '',
		children: [],
		blocks: [],
		ready: partial.status === 'open' && (partial.blocked_by?.length ?? 0) === 0,
		blocked: false,
		...partial,
	}
}

export function statuses(count: number, status: TicketStatus): DerivedTicket[] {
	return Array.from({ length: count }, (_, index) =>
		derived({ id: id(index + 1), title: `Ticket ${index + 1}`, status }),
	)
}
