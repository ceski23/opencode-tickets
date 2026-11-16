import { describe, expect, it } from 'vitest'
import { TicketService } from '../src/core/service'
import { createTicketTools } from '../src/index'
import { withTempProject } from './helpers'

type CallableTool = {
	name: string
	description: string
	execute: (input: any, context: any) => Promise<any>
}

async function callRaw(tool: CallableTool, input: unknown): Promise<any> {
	return tool.execute(input, {})
}

async function call(tool: CallableTool, input: unknown): Promise<any> {
	return JSON.parse((await callRaw(tool, input)).content)
}

describe('agent tools', () => {
	it('registers the five ticket tools', async () => {
		await withTempProject(async root => {
			const tools = createTicketTools(new TicketService(root))
			expect(Object.values(tools).map(tool => tool.name)).toEqual(['search', 'get', 'create', 'update', 'delete'])
			expect(Object.values(tools).map(tool => tool.name)).toHaveLength(5)
		})
	})

	it('declares Standard Schema input and output', async () => {
		await withTempProject(async root => {
			const tools = createTicketTools(new TicketService(root))
			for (const tool of Object.values(tools)) {
				expect(tool.input).toHaveProperty('~standard')
				expect(tool.output).toHaveProperty('~standard')
			}
		})
	})

	it('reads a full ticket through ticket_get', async () => {
		await withTempProject(async root => {
			const tools = createTicketTools(new TicketService(root))
			const created = await call(tools.create, { title: 'Read me', body: '## Spec' })

			const fetched = await call(tools.get, { id: created.id })
			expect(fetched.id).toBe(created.id)
			expect(fetched.body).toBe('## Spec')
			expect(fetched.children).toEqual([])
			expect(fetched.ready).toBe(true)
		})
	})

	it('creates, gets, updates, searches, and deletes', async () => {
		await withTempProject(async root => {
			const tools = createTicketTools(new TicketService(root))

			const created = await call(tools.create, {
				title: 'Implement login',
				body: '## Steps\n\n1. Do it.',
				labels: ['feature'],
			})
			expect(created.id).toMatch(/^TK-\d+$/)
			expect(created.ready).toBe(true)
			expect(created.body).toBe('## Steps\n\n1. Do it.')

			const fetched = await call(tools.get, { id: created.id })
			expect(fetched.body).toContain('Do it')
			expect(fetched.children).toEqual([])

			const updated = await call(tools.update, {
				id: created.id,
				status: 'in_progress',
				labels: ['feature', 'backend'],
				append_body: 'Working on it.',
			})
			const expectedBody = '## Steps\n\n1. Do it.\n\nWorking on it.'
			expect(updated.status).toBe('in_progress')
			expect(updated).not.toHaveProperty('body')
			expect(updated.changed).toEqual(['body', 'labels', 'status'])
			expect(updated.bodyLength).toBe(expectedBody.length)
			expect(updated.bodyTail).toBe(expectedBody)

			const afterUpdate = await call(tools.get, { id: created.id })
			expect(afterUpdate.body).toBe(expectedBody)
			expect(afterUpdate.labels).toEqual(['feature', 'backend'])

			const search = await call(tools.search, { labels: ['feature'], status: 'in_progress' })
			expect(search.total).toBe(1)
			expect(search.tickets[0].id).toBe(created.id)
			expect(search.tickets[0]).not.toHaveProperty('body')
			expect(search.tickets[0].bodyPreview).toBe('1. Do it. Working on it.')

			const deleted = await call(tools.delete, { id: created.id })
			expect(deleted).toEqual({ id: created.id, deleted: true, message: `Deleted ticket ${created.id}.` })
			await expect(call(tools.get, { id: created.id })).rejects.toThrow(/does not exist/)
		})
	})

	it('closes a ticket with a replacement body in one update', async () => {
		await withTempProject(async root => {
			const tools = createTicketTools(new TicketService(root))
			const created = await call(tools.create, {
				title: 'Ship it',
				body: '## Acceptance criteria\n\n- [ ] Tests pass.',
			})

			const closedBody = '## Acceptance criteria\n\n- [x] Tests pass.\n\n## Outcome\n\nShipped.'
			const closed = await call(tools.update, {
				id: created.id,
				status: 'closed',
				body: closedBody,
			})
			expect(closed.status).toBe('closed')
			expect(closed).not.toHaveProperty('body')
			expect(closed.changed).toEqual(['body', 'status'])
			expect(closed.bodyLength).toBe(closedBody.length)
			expect(closed.bodyTail).toBe(closedBody)

			const fetched = await call(tools.get, { id: created.id })
			expect(fetched.status).toBe('closed')
			expect(fetched.body).toBe(closedBody)
		})
	})

	it('keeps metadata-only updates compact', async () => {
		await withTempProject(async root => {
			const tools = createTicketTools(new TicketService(root))
			const created = await call(tools.create, { title: 'Compact', body: 'Body' })

			const updated = await call(tools.update, { id: created.id, status: 'in_progress' })
			expect(updated.changed).toEqual(['status'])
			expect(updated.bodyLength).toBe(4)
			expect(updated).not.toHaveProperty('bodyTail')
		})
	})

	it('bounds the body tail when the body is long', async () => {
		await withTempProject(async root => {
			const tools = createTicketTools(new TicketService(root))
			const created = await call(tools.create, { title: 'Long', body: 'start' })
			const appended = `${'x'.repeat(250)}TAIL`

			const updated = await call(tools.update, {
				id: created.id,
				append_body: appended,
			})
			expect(updated.changed).toEqual(['body'])
			expect(updated.bodyLength).toBe(`start\n\n${appended}`.length)
			expect(updated.bodyTail?.length).toBe(201)
			expect(updated.bodyTail?.startsWith('…')).toBe(true)
			expect(updated.bodyTail?.endsWith('TAIL')).toBe(true)
		})
	})

	it('returns structured output alongside JSON content', async () => {
		await withTempProject(async root => {
			const tools = createTicketTools(new TicketService(root))

			const created = await callRaw(tools.create, { title: 'Structured' })
			expect(created.output).toEqual(JSON.parse(created.content))
			expect(created.output).toMatchObject({ title: 'Structured', status: 'open' })

			const updated = await callRaw(tools.update, {
				id: created.output.id,
				status: 'in_progress',
			})
			expect(updated.output).toEqual(JSON.parse(updated.content))
			expect(updated.output).toMatchObject({ changed: ['status'], status: 'in_progress' })

			const fetched = await callRaw(tools.get, { id: created.output.id })
			expect(fetched.output).toEqual(JSON.parse(fetched.content))

			const search = await callRaw(tools.search, { query: 'Structured' })
			expect(search.output).toEqual(JSON.parse(search.content))
			expect(search.output.tickets[0].id).toBe(created.output.id)

			const deleted = await callRaw(tools.delete, { id: created.output.id })
			expect(deleted.output).toEqual(JSON.parse(deleted.content))
			expect(deleted.output).toMatchObject({ id: created.output.id, deleted: true })
		})
	})

	it('enforces required fields', async () => {
		await withTempProject(async root => {
			const tools = createTicketTools(new TicketService(root))
			await expect(call(tools.create, {})).rejects.toThrow(/requires a title/)
			await expect(call(tools.get, {})).rejects.toThrow(/requires an id/)
			await expect(call(tools.update, {})).rejects.toThrow(/requires an id/)
			await expect(call(tools.update, { id: 'TK-1' })).rejects.toThrow(/requires at least one field/)
			await expect(call(tools.delete, {})).rejects.toThrow(/requires an id/)
		})
	})

	it('does not allow callers to choose an ID or initial status', async () => {
		await withTempProject(async root => {
			const tools = createTicketTools(new TicketService(root))
			await expect(call(tools.create, { title: 'T', id: 'TK-1' })).rejects.toThrow(/does not accept an id/)
			await expect(call(tools.create, { title: 'T', status: 'closed' })).rejects.toThrow(
				/does not accept a status/,
			)
		})
	})

	it('returns complete derived fields from get and compact search entries', async () => {
		await withTempProject(async root => {
			const tools = createTicketTools(new TicketService(root))
			const parent = await call(tools.create, { title: 'Parent' })
			const child = await call(tools.create, { title: 'Child', parent: parent.id })

			const detail = await call(tools.get, { id: parent.id })
			expect(detail.children).toEqual([child.id])

			const results = await call(tools.search, { query: 'child' })
			expect(results.total).toBe(1)
			expect(Object.keys(results.tickets[0]).sort()).toEqual(
				['blocked', 'blocked_by', 'bodyPreview', 'id', 'labels', 'parent', 'ready', 'status', 'title'].sort(),
			)
		})
	})
})
