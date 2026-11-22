// Runtime RPC contract shared by the server plugin and the terminal UI.
import { Rpc } from '@opencode/plugin/rpc'
import { TICKET_STATUSES, type TicketStatus, type TicketSummary } from './core/schema'
import type { TicketDetail } from './core/service'

const statusSchema = {
	type: 'string',
	enum: [...TICKET_STATUSES],
} as const

const summarySchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		id: { type: 'string' },
		title: { type: 'string' },
		status: statusSchema,
		labels: { type: 'array', items: { type: 'string' } },
		parent: { anyOf: [{ type: 'string' }, { type: 'null' }] },
		blocked_by: { type: 'array', items: { type: 'string' } },
		ready: { type: 'boolean' },
		blocked: { type: 'boolean' },
	},
	required: ['id', 'title', 'status', 'labels', 'parent', 'blocked_by', 'ready', 'blocked'],
} as const

const ticketSchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		...summarySchema.properties,
		body: { type: 'string' },
		children: { type: 'array', items: { type: 'string' } },
		blocks: { type: 'array', items: { type: 'string' } },
	},
	required: [...summarySchema.required, 'body', 'children', 'blocks'],
} as const

const errorSchema = {
	type: 'object',
	additionalProperties: false,
	properties: { message: { type: 'string' } },
	required: ['message'],
} as const

export const TicketsRpc = Rpc.define({
	id: 'ceski23.opencode-tickets.rpc',
	methods: {
		listTickets: {
			input: { type: 'object', additionalProperties: false, properties: {} },
			output: {
				type: 'object',
				additionalProperties: false,
				properties: { tickets: { type: 'array', items: summarySchema } },
				required: ['tickets'],
			},
			errors: { invalid_storage: errorSchema },
		},
		getTicket: {
			input: {
				type: 'object',
				additionalProperties: false,
				properties: { id: { type: 'string' } },
				required: ['id'],
			},
			output: {
				type: 'object',
				additionalProperties: false,
				properties: {
					ticket: ticketSchema,
					parent: { anyOf: [summarySchema, { type: 'null' }] },
					children: { type: 'array', items: summarySchema },
					blockers: { type: 'array', items: summarySchema },
					blocks: { type: 'array', items: summarySchema },
				},
				required: ['ticket', 'parent', 'children', 'blockers', 'blocks'],
			},
			errors: { not_found: errorSchema, invalid_storage: errorSchema },
		},
	},
	events: {},
})

export type ListTicketsResult = { tickets: TicketSummary[] }

export type GetTicketResult = TicketDetail

export type TicketRpcOptions = {
	location?: { directory: string; workspaceID?: string }
	headers?: Record<string, string>
}

export type TicketsRpcClient = {
	listTickets(input?: Record<string, never>, options?: TicketRpcOptions): Promise<ListTicketsResult>
	getTicket(input: { id: string }, options?: TicketRpcOptions): Promise<GetTicketResult>
}

export type { TicketStatus, TicketSummary }
