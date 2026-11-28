import { Plugin } from '@opencode/plugin'
import type { Context } from '@opencode/plugin/promise/plugin'
import type { Info as ToolInfo } from '@opencode/plugin/promise/tool'
import { z } from 'zod'
import { TicketError, errorMessage } from './core/errors'
import { parseTicketsOptions, resolveTicketsDirectory } from './core/paths'
import { buildReminder } from './core/reminder'
import { TICKET_STATUSES, type DerivedTicket } from './core/schema'
import { MAX_SEARCH_LIMIT, type TicketSearchFilters } from './core/search'
import { TicketService, type UpdateTicketInput } from './core/service'
import { TicketStorage } from './core/storage'
import { TicketsRpc } from './rpc'

const statusSchema = z.enum(TICKET_STATUSES)

const createInputSchema = z
	.object({
		title: z.string(),
		body: z.string().optional(),
		labels: z.array(z.string()).optional(),
		parent: z.union([z.string(), z.null()]).optional().describe('Parent ID or null.'),
		blocked_by: z.array(z.string()).optional(),
	})
	.strict()

const updateInputSchema = z
	.object({
		id: z.string(),
		title: z.string().optional(),
		status: statusSchema.optional(),
		parent: z.union([z.string(), z.null()]).optional(),
		body: z.string().optional(),
		append_body: z.string().optional(),
		labels: z.array(z.string()).optional(),
		add_labels: z.array(z.string()).optional(),
		remove_labels: z.array(z.string()).optional(),
		blocked_by: z.array(z.string()).optional(),
		add_blocked_by: z.array(z.string()).optional(),
		remove_blocked_by: z.array(z.string()).optional(),
	})
	.strict()

const searchInputSchema = z
	.object({
		query: z.string().optional(),
		id: z.string().optional(),
		status: statusSchema.optional(),
		labels: z.array(z.string()).optional(),
		parent: z.union([z.string(), z.null()]).optional(),
		blocked_by: z.string().optional(),
		ready: z.boolean().optional(),
		limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
		offset: z.number().int().min(0).optional(),
	})
	.strict()

const idInputSchema = z
	.object({
		id: z.string(),
	})
	.strict()

const ticketSummarySchema = z.object({
	id: z.string(),
	title: z.string(),
	status: statusSchema,
	labels: z.array(z.string()),
	parent: z.union([z.string(), z.null()]),
	blocked_by: z.array(z.string()),
	ready: z.boolean(),
	blocked: z.boolean(),
})

const ticketDetailOutputSchema = z.object({
	id: z.string(),
	title: z.string(),
	status: statusSchema,
	labels: z.array(z.string()),
	parent: z.union([z.string(), z.null()]),
	blocked_by: z.array(z.string()),
	body: z.string(),
	children: z.array(z.string()),
	blocks: z.array(z.string()),
	ready: z.boolean(),
	blocked: z.boolean(),
})

const updateOutputSchema = z.object({
	id: z.string(),
	title: z.string(),
	status: statusSchema,
	labels: z.array(z.string()),
	parent: z.union([z.string(), z.null()]),
	blocked_by: z.array(z.string()),
	children: z.array(z.string()),
	blocks: z.array(z.string()),
	ready: z.boolean(),
	blocked: z.boolean(),
	changed: z.array(z.string()),
	bodyLength: z.number().int(),
	bodyTail: z.string().optional(),
})

const deleteOutputSchema = z.object({
	id: z.string(),
	deleted: z.literal(true),
	message: z.string(),
})

const ticketSearchEntrySchema = ticketSummarySchema.extend({
	bodyPreview: z.string(),
})

const searchOutputSchema = z.object({
	total: z.number().int(),
	limit: z.number().int(),
	offset: z.number().int(),
	tickets: z.array(ticketSearchEntrySchema),
})

function toolResult<T>(output: T): { output: T; content: string } {
	return { output, content: JSON.stringify(output, null, 2) }
}

export function createTicketTools(service: TicketService): {
	search: ToolInfo<typeof searchInputSchema, typeof searchOutputSchema>
	get: ToolInfo<typeof idInputSchema, typeof ticketDetailOutputSchema>
	create: ToolInfo<typeof createInputSchema, typeof ticketDetailOutputSchema>
	update: ToolInfo<typeof updateInputSchema, typeof updateOutputSchema>
	delete: ToolInfo<typeof idInputSchema, typeof deleteOutputSchema>
} {
	const search: ToolInfo<typeof searchInputSchema, typeof searchOutputSchema> = {
		name: 'search',
		description:
			'Search tickets (no bodies). Filters: query, id, status, labels, parent, blocked_by, ready, limit, offset. ' +
			'Use ticket.get for the body.',
		input: searchInputSchema,
		output: searchOutputSchema,
		options: { namespace: 'ticket', pinned: true },
		async execute(raw: unknown) {
			const input = raw as TicketSearchFilters
			const result = await service.search(input)
			return toolResult(result)
		},
	}

	const get: ToolInfo<typeof idInputSchema, typeof ticketDetailOutputSchema> = {
		name: 'get',
		description: 'Read one ticket: full body, relationships, readiness.',
		input: idInputSchema,
		output: ticketDetailOutputSchema,
		options: { namespace: 'ticket', pinned: true },
		async execute(raw: unknown) {
			const input = raw as z.infer<typeof idInputSchema>
			requireId(input.id, 'ticket.get')
			const ticket = await service.get(input.id)
			return toolResult(ticket)
		},
	}

	const create: ToolInfo<typeof createInputSchema, typeof ticketDetailOutputSchema> = {
		name: 'create',
		description: 'Create a ticket. Starts open.',
		input: createInputSchema,
		output: ticketDetailOutputSchema,
		options: { namespace: 'ticket' },
		async execute(raw: unknown) {
			const input = raw as z.infer<typeof createInputSchema>
			const ticket = await service.create(input)
			return toolResult(ticket)
		},
	}

	const update: ToolInfo<typeof updateInputSchema, typeof updateOutputSchema> = {
		name: 'update',
		description:
			'Update by id. body replaces; append_body appends. status closes. ' + 'Use ticket.get for the body.',
		input: updateInputSchema,
		output: updateOutputSchema,
		options: { namespace: 'ticket', pinned: true },
		async execute(raw: unknown) {
			const input = raw as z.infer<typeof updateInputSchema>
			const { id, ...changes } = input
			requireId(id, 'ticket.update')
			const ticket = await service.update(id, changes)
			return toolResult(updateResult(ticket, changes))
		},
	}

	const remove: ToolInfo<typeof idInputSchema, typeof deleteOutputSchema> = {
		name: 'delete',
		description: 'Delete a ticket. Refused while referenced.',
		input: idInputSchema,
		output: deleteOutputSchema,
		options: { namespace: 'ticket' },
		async execute(raw: unknown) {
			const input = raw as z.infer<typeof idInputSchema>
			requireId(input.id, 'ticket.delete')
			const result = await service.delete(input.id)
			return toolResult({ ...result, message: `Deleted ticket ${result.id}.` })
		},
	}

	return { search, get, create, update, delete: remove }
}

const BODY_TAIL_LENGTH = 200

const UPDATE_FIELD_ALIASES: Record<string, string> = {
	append_body: 'body',
	add_labels: 'labels',
	remove_labels: 'labels',
	add_blocked_by: 'blocked_by',
	remove_blocked_by: 'blocked_by',
}

const INCREMENTAL_ARRAY_FIELDS = new Set(['add_labels', 'remove_labels', 'add_blocked_by', 'remove_blocked_by'])

type UpdateResult = Omit<DerivedTicket, 'body'> & {
	changed: string[]
	bodyLength: number
	bodyTail?: string
}

/** Keep content writes verifiable without echoing the complete body. */
function updateResult(ticket: DerivedTicket, changes: UpdateTicketInput): UpdateResult {
	const { body, ...summary } = ticket
	const changed = [
		...new Set(
			Object.entries(changes)
				.filter(
					([field, value]) =>
						!(INCREMENTAL_ARRAY_FIELDS.has(field) && Array.isArray(value) && value.length === 0),
				)
				.map(([field]) => UPDATE_FIELD_ALIASES[field] ?? field),
		),
	].sort()

	const result: UpdateResult = {
		...summary,
		changed,
		bodyLength: body.length,
	}
	if (changed.includes('body')) result.bodyTail = bodyTail(body)
	return result
}

function bodyTail(body: string): string {
	if (body.length <= BODY_TAIL_LENGTH) return body
	return `…${body.slice(-BODY_TAIL_LENGTH)}`
}

function requireId(id: string | undefined, label: string): asserts id is string {
	if (id === undefined) {
		throw new Error(`${label} requires an id.`)
	}
}

function asRpcMessage(error: unknown): string {
	if (error instanceof TicketError) return error.message
	return errorMessage(error)
}

export async function setupPlugin(ctx: Context): Promise<() => Promise<void>> {
	const options = parseTicketsOptions(ctx.options)
	const directory = resolveTicketsDirectory({
		storage: options.storage,
		locationDirectory: ctx.location.directory,
		projectId: ctx.location.project?.id,
	})
	const storage = new TicketStorage(ctx.location.directory, directory)
	const service = new TicketService(ctx.location.directory, storage)
	const registrations: Array<{ dispose: () => Promise<void> }> = []

	try {
		registrations.push(
			await ctx.tool.transform(editor => {
				const tools = createTicketTools(service)
				editor.namespace({
					name: 'ticket',
					description: 'search, get, create, update, delete',
				})
				editor.add(tools.search)
				editor.add(tools.get)
				editor.add(tools.create)
				editor.add(tools.update)
				editor.add(tools.delete)
			}),
		)

		registrations.push(
			await ctx.session.hook('context', async event => {
				try {
					const reminder = buildReminder(await service.list())
					if (reminder !== null) event.system.push({ type: 'text', text: reminder })
				} catch (error) {
					console.error(
						`[@ceski23/opencode-tickets] Could not read tickets for the context reminder: ${errorMessage(error)}`,
					)
				}
			}),
		)

		registrations.push(
			await ctx.rpc.register(TicketsRpc, {
				async listTickets(input, context) {
					try {
						const tickets = await service.list()
						return {
							directory: storage.directory,
							tickets: tickets.map(ticket => ({
								id: ticket.id,
								title: ticket.title,
								status: ticket.status,
								labels: ticket.labels,
								parent: ticket.parent,
								blocked_by: ticket.blocked_by,
								ready: ticket.ready,
								blocked: ticket.blocked,
								...((input as { includeBodies?: boolean } | undefined)?.includeBodies
									? { body: ticket.body }
									: {}),
							})),
						}
					} catch (error) {
						const message = asRpcMessage(error)
						return context.error('invalid_storage', message, { message })
					}
				},
				async getTicket(input: unknown, context) {
					try {
						const detail = await service.detail((input as { id: string }).id)
						return {
							ticket: detail.ticket,
							parent: detail.parent,
							children: detail.children,
							blockers: detail.blockers,
							blocks: detail.blocks,
						}
					} catch (error) {
						if (
							error instanceof TicketError &&
							(error.code === 'not_found' || error.code === 'invalid_id')
						) {
							return context.error('not_found', error.message, { message: error.message })
						}
						const message = asRpcMessage(error)
						return context.error('invalid_storage', message, { message })
					}
				},
			}),
		)
	} catch (error) {
		for (const registration of registrations.reverse()) {
			await registration.dispose().catch(() => undefined)
		}
		throw error
	}

	return async () => {
		for (const registration of registrations.reverse()) {
			await registration.dispose().catch(() => undefined)
		}
	}
}

export default Plugin.define({
	id: 'ceski23.opencode-tickets.server',
	setup: setupPlugin,
})
