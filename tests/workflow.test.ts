import { describe, expect, it } from 'vitest'
import { TicketService } from '../src/core/service'
import { withTempProject } from './helpers'

describe('Matt Pocock skill workflows', () => {
	it('/to-tickets creates a linked hierarchy and finds ready slices', async () => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			const map = await service.create({
				title: 'Authentication feature',
				labels: ['epic'],
				body: '## Goal\n\nShip authentication.',
			})

			const model = await service.create({
				title: 'Add user model',
				parent: map.id,
				labels: ['feature', 'ready-for-agent'],
				body: '## Acceptance criteria\n\n- [ ] User table exists.',
				blocked_by: [],
			})
			const endpoint = await service.create({
				title: 'Add login endpoint',
				parent: map.id,
				labels: ['feature'],
				body: '## Acceptance criteria\n\n- [ ] POST /login works.',
				blocked_by: [model.id],
			})
			const tests = await service.create({
				title: 'Add integration tests',
				parent: map.id,
				labels: ['feature', 'ready-for-agent'],
				blocked_by: [endpoint.id],
			})

			const mapWithChildren = await service.get(map.id)
			expect(mapWithChildren.children).toEqual([model.id, endpoint.id, tests.id])
			expect(endpoint.ready).toBe(false)
			expect(tests.ready).toBe(false)

			const ready = await service.search({ labels: ['ready-for-agent'], ready: true })
			expect(ready.tickets.map(entry => entry.id)).toEqual([model.id])

			await service.update(model.id, { status: 'closed' })
			const nextReady = await service.search({ labels: ['feature'], ready: true })
			expect(nextReady.tickets.map(entry => entry.id)).toEqual([endpoint.id])

			const detail = await service.detail(map.id)
			expect(detail.children).toHaveLength(3)
			expect(detail.ticket.body).toContain('Ship authentication')
			expect((await service.get(model.id)).status).toBe('closed')
		})
	})

	it('/implement reads instructions, starts, records notes, and closes verified work', async () => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			const created = await service.create({
				title: 'Implement login endpoint',
				labels: ['ready-for-agent'],
				body: [
					'## Description',
					'',
					'Implement session authentication.',
					'',
					'## Acceptance criteria',
					'',
					'- [ ] Correct credentials create a session.',
				].join('\n'),
			})

			const instructions = await service.get(created.id)
			expect(instructions.body).toContain('session authentication')

			const started = await service.update(created.id, {
				status: 'in_progress',
				append_body: '## Progress\n\nImplemented the endpoint.',
			})
			expect(started.status).toBe('in_progress')
			expect(started.body).toContain('## Description')
			expect(started.body).toContain('## Progress')

			const closed = await service.update(created.id, {
				status: 'closed',
				append_body: '## Resolution\n\nIntegration test passes.',
			})
			expect(closed.status).toBe('closed')
			expect(closed.ready).toBe(false)
			expect(closed.body).toContain('## Resolution')
			expect((await service.get(created.id)).body).toContain('Integration test passes')
		})
	})

	it('/wayfinder uses a map ticket, child decisions, labels, blockers, and body notes', async () => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			const map = await service.create({
				title: 'Wayfinder: ticket storage',
				labels: ['wayfinder:map'],
				body: '## Destination\n\nChoose a storage design.',
			})

			const first = await service.create({
				title: 'Decide file format',
				parent: map.id,
				labels: ['wayfinder:decision'],
				body: '## Question\n\nMarkdown or JSON?',
			})
			const second = await service.create({
				title: 'Decide parsing strategy',
				parent: map.id,
				labels: ['wayfinder:decision'],
				blocked_by: [first.id],
				body: '## Question\n\nWhich YAML parser?',
			})

			const queued = await service.search({ labels: ['wayfinder:decision'], ready: true })
			expect(queued.tickets.map(entry => entry.id)).toEqual([first.id])

			await service.update(first.id, {
				append_body: '## Decision\n\nMarkdown with YAML frontmatter.',
				status: 'closed',
			})

			const next = await service.search({ labels: ['wayfinder:decision'], ready: true })
			expect(next.tickets.map(entry => entry.id)).toEqual([second.id])

			await service.update(second.id, {
				body: '## Question\n\nWhich YAML parser?\n\n## Decision\n\nUse the safe yaml package.',
				status: 'closed',
			})

			const completed = await service.search({ labels: ['wayfinder:decision'], ready: true })
			expect(completed.total).toBe(0)
			const detail = await service.detail(map.id)
			expect(detail.children.every(child => child.status === 'closed')).toBe(true)
			expect((await service.get(first.id)).body).toContain('YAML frontmatter')
		})
	})
})
