import { readFile, readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { TicketError } from '../src/core/errors'
import { TicketService } from '../src/core/service'
import { withTempProject } from './helpers'

describe('TicketService create', () => {
	it('creates the storage directory, a valid ID, and a Markdown file', async () => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			const created = await service.create({ title: '  First ticket  ' })

			expect(created.id).toMatch(/^TK-\d+$/)
			expect(created.title).toBe('First ticket')
			expect(created.status).toBe('open')
			expect(created.labels).toEqual([])
			expect(created.parent).toBeNull()
			expect(created.blocked_by).toEqual([])
			expect(created.body).toBe('')
			expect(created.ready).toBe(true)
			expect(created.blocked).toBe(false)

			const files = await readdir(`${root}/.opencode/tickets`)
			expect(files).toEqual([`${created.id}.md`])
			expect(await readFile(`${root}/.opencode/tickets/${created.id}.md`, 'utf8')).toContain(`id: ${created.id}`)
			expect(created.children).toEqual([])
			expect(created.blocks).toEqual([])
		})
	})

	it('trims body newlines before writing', async () => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			const created = await service.create({ title: 'Body', body: '\nText\n\n' })
			expect(created.body).toBe('Text')

			const raw = await readFile(`${root}/.opencode/tickets/${created.id}.md`, 'utf8')
			expect(raw.endsWith('Text\n')).toBe(true)
			expect(raw).not.toContain('Text\n\n')
		})
	})

	it('generates distinct IDs', async () => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			const ids = new Set<string>()
			for (let index = 0; index < 8; index += 1) {
				const created = await service.create({ title: `Ticket ${index}` })
				expect(created.id).toMatch(/^TK-\d+$/)
				ids.add(created.id)
			}
			expect(ids.size).toBe(8)
		})
	})

	it('generates distinct IDs and keeps every ticket when creates run in parallel', async () => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			const titles = Array.from({ length: 6 }, (_, index) => `Parallel ${index}`)
			const created = await Promise.all(titles.map(title => service.create({ title })))

			expect(new Set(created.map(ticket => ticket.id)).size).toBe(titles.length)
			const reloaded = await service.list()
			expect(reloaded.map(ticket => ticket.title).sort()).toEqual([...titles].sort())
		})
	})

	it('stores labels, body, parent, and blockers', async () => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			const blocker = await service.create({ title: 'Blocker' })
			const parent = await service.create({ title: 'Parent' })
			const created = await service.create({
				title: 'Child',
				body: '## Instructions\n\nDo the thing.',
				labels: ['backend', ' backend ', 'ready-for-agent'],
				parent: parent.id,
				blocked_by: [blocker.id, blocker.id],
			})

			expect(created.labels).toEqual(['backend', 'ready-for-agent'])
			expect(created.parent).toBe(parent.id)
			expect(created.blocked_by).toEqual([blocker.id])
			expect(created.body).toBe('## Instructions\n\nDo the thing.')
			expect(parent.children).toEqual([])

			const reloaded = await service.get(created.id)
			expect(reloaded.body).toBe('## Instructions\n\nDo the thing.')
			expect(reloaded.blocked).toBe(true)
			expect(reloaded.ready).toBe(false)
		})
	})

	it('rejects a missing parent or blocker without writing', async () => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			await expect(service.create({ title: 'Orphan', parent: 'TK-11111111' })).rejects.toMatchObject({
				code: 'invalid_storage',
			})
			await expect(service.create({ title: 'Blocked', blocked_by: ['TK-22222222'] })).rejects.toMatchObject({
				code: 'invalid_storage',
			})
			expect(await readdir(`${root}/.opencode/tickets`).catch(() => [])).toEqual([])
		})
	})
})

describe('TicketService update', () => {
	it('preserves the entire body for metadata-only updates', async () => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			const body = '## Description\n\nOne\n\n- [ ] two\n\n## Notes\n\nKeep this.'
			const created = await service.create({ title: 'Body', body })
			const updated = await service.update(created.id, {
				title: 'Body renamed',
				labels: ['feature'],
				status: 'in_progress',
			})
			expect(updated.body).toBe(body)
			expect(updated.title).toBe('Body renamed')
			expect((await service.get(created.id)).body).toBe(body)
		})
	})

	it('replaces and appends the body, separating sections with one blank line', async () => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			const created = await service.create({ title: 'Body', body: 'Initial' })

			const appended = await service.update(created.id, { append_body: 'Second' })
			expect(appended.body).toBe('Initial\n\nSecond')

			const replaced = await service.update(created.id, { body: 'Replacement' })
			expect(replaced.body).toBe('Replacement')

			const appendedAgain = await service.update(created.id, { append_body: '\nThird\n\n' })
			expect(appendedAgain.body).toBe('Replacement\n\nThird')
		})
	})

	it.each([
		[{ body: 'a', append_body: 'b' }, /either body or append_body/],
		[{ labels: ['a'], add_labels: ['b'] }, /either labels or add_labels/],
		[{ blocked_by: [], add_blocked_by: [] }, /either blocked_by or add_blocked_by/],
		[{ add_labels: ['same'], remove_labels: ['same'] }, /both add and remove label/],
		[{ add_blocked_by: ['TK-1'], remove_blocked_by: ['TK-1'] }, /both add and remove blocker/],
		[{}, /at least one field/],
		[{ unknown: true }, /Unknown update field/],
	])('rejects conflicting or empty updates (%j)', async (changes, pattern) => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			const created = await service.create({ title: 'Ticket' })
			const before = await readFile(`${root}/.opencode/tickets/${created.id}.md`, 'utf8')
			await expect(service.update(created.id, changes as never)).rejects.toThrow(pattern)
			expect(await readFile(`${root}/.opencode/tickets/${created.id}.md`, 'utf8')).toBe(before)
		})
	})

	it('adds and removes labels and blockers incrementally', async () => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			const blockerA = await service.create({ title: 'A' })
			const blockerB = await service.create({ title: 'B' })
			const created = await service.create({
				title: 'Work',
				labels: ['feature', 'needs-triage'],
				blocked_by: [blockerA.id],
			})

			const updated = await service.update(created.id, {
				add_labels: ['backend', 'feature', 'backend'],
				remove_labels: ['needs-triage'],
				add_blocked_by: [blockerB.id, blockerA.id],
			})
			expect(updated.labels).toEqual(['feature', 'backend'])
			expect(updated.blocked_by).toEqual([blockerA.id, blockerB.id])
			expect(updated.blocked).toBe(true)
		})
	})

	it('validates the proposed graph before writing', async () => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			const root1 = await service.create({ title: 'Root' })
			const child = await service.create({ title: 'Child', parent: root1.id })

			await expect(service.update(root1.id, { parent: child.id })).rejects.toMatchObject({
				code: 'invalid_storage',
			})
			expect((await service.get(root1.id)).parent).toBeNull()
			expect((await service.get(child.id)).parent).toBe(root1.id)
		})
	})

	it('rejects self-parenting and self-blocking', async () => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			const created = await service.create({ title: 'Self' })
			await expect(service.update(created.id, { parent: created.id })).rejects.toThrow(/cannot be its own parent/)
			await expect(service.update(created.id, { add_blocked_by: [created.id] })).rejects.toThrow(
				/cannot block itself/,
			)
		})
	})

	it('recalculates readiness after a blocker closes without cascading status', async () => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			const blocker = await service.create({ title: 'Blocker' })
			const dependent = await service.create({
				title: 'Dependent',
				blocked_by: [blocker.id],
			})
			expect(dependent.ready).toBe(false)
			expect(dependent.blocked).toBe(true)

			await service.update(blocker.id, { status: 'closed' })
			const after = await service.get(dependent.id)
			expect(after.status).toBe('open')
			expect(after.ready).toBe(true)
			expect(after.blocked).toBe(false)
		})
	})

	it('does not cascade parent status or remove relationships on reopen', async () => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			const parent = await service.create({ title: 'Parent' })
			const child = await service.create({ title: 'Child', parent: parent.id })
			const blocker = await service.create({ title: 'Blocker' })
			const blocked = await service.create({ title: 'Blocked', blocked_by: [blocker.id] })

			await service.update(parent.id, { status: 'closed' })
			expect((await service.get(child.id)).status).toBe('open')

			await service.update(blocker.id, { status: 'closed' })
			await service.update(blocker.id, { status: 'open' })
			const reopened = await service.get(blocked.id)
			expect(reopened.status).toBe('open')
			expect(reopened.blocked_by).toEqual([blocker.id])
			expect(reopened.ready).toBe(false)
			expect(reopened.blocked).toBe(true)
		})
	})

	it('rejects updates to missing tickets', async () => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			await expect(service.update('TK-1', { title: 'Nope' })).rejects.toMatchObject({
				code: 'not_found',
			})
		})
	})
})

describe('TicketService detail, list, and delete', () => {
	it('returns forward and reverse relationships in detail', async () => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			const parent = await service.create({ title: 'Parent' })
			const blocker = await service.create({ title: 'Blocker' })
			const child = await service.create({
				title: 'Child',
				parent: parent.id,
				blocked_by: [blocker.id],
			})

			const detail = await service.detail(parent.id)
			expect(detail.parent).toBeNull()
			expect(detail.children.map(entry => entry.id)).toEqual([child.id])
			expect(detail.blockers).toEqual([])
			expect(detail.blocks).toEqual([])

			const blockerDetail = await service.detail(blocker.id)
			expect(blockerDetail.blocks.map(entry => entry.id)).toEqual([child.id])
			expect(blockerDetail.children).toEqual([])
			expect(blockerDetail.blockers).toEqual([])

			const childDetail = await service.detail(child.id)
			expect(childDetail.parent?.id).toBe(parent.id)
			expect(childDetail.blockers.map(entry => entry.id)).toEqual([blocker.id])
		})
	})

	it('rejects deletion while referenced, then succeeds after unlinking', async () => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			const parent = await service.create({ title: 'Parent' })
			const child = await service.create({ title: 'Child', parent: parent.id })
			const blocker = await service.create({ title: 'Blocker' })
			const dependent = await service.create({
				title: 'Dependent',
				blocked_by: [blocker.id],
			})

			await expect(service.delete(parent.id)).rejects.toMatchObject({ code: 'referenced' })
			await expect(service.delete(blocker.id)).rejects.toMatchObject({ code: 'referenced' })

			const error = await service.delete(parent.id).catch((caught: unknown) => caught)
			expect(error).toBeInstanceOf(TicketError)
			expect((error as Error).message).toContain(child.id)
			expect((error as Error).message).toContain('parent')

			await service.update(child.id, { parent: null })
			await service.update(dependent.id, { remove_blocked_by: [blocker.id] })
			expect(await service.delete(parent.id)).toEqual({ id: parent.id, deleted: true })
			expect(await service.delete(blocker.id)).toEqual({ id: blocker.id, deleted: true })
			await expect(service.get(parent.id)).rejects.toMatchObject({ code: 'not_found' })
		})
	})

	it('lists sorted tickets with derived fields', async () => {
		await withTempProject(async root => {
			const service = new TicketService(root)
			const first = await service.create({ title: 'First' })
			const second = await service.create({ title: 'Second' })
			const list = await service.list()
			expect(list.map(entry => entry.id)).toEqual([first.id, second.id])
			expect(list[0]).toHaveProperty('children')
			expect(list[0]).toHaveProperty('ready')
		})
	})
})
