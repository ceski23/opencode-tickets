import { describe, expect, it } from 'vitest'
import { deriveAll } from '../src/core/graph'
import { DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, previewBody, searchTickets } from '../src/core/search'
import { id, ticket } from './helpers'

function sample() {
	return deriveAll([
		ticket({ id: id(1), title: 'Root feature', labels: ['feature'], body: 'Alpha instructions.' }),
		ticket({
			id: id(2),
			title: 'Login endpoint',
			labels: ['feature', 'backend'],
			parent: id(1),
			blocked_by: [id(4)],
			body: 'Use SESSION cookies.',
		}),
		ticket({
			id: id(3),
			title: 'Documentation',
			labels: ['docs'],
			parent: id(1),
			status: 'in_progress',
		}),
		ticket({ id: id(4), title: 'Foundation', labels: ['backend'], status: 'closed' }),
		ticket({ id: id(5), title: 'Root cleanup', labels: ['feature'] }),
	])
}

describe('previewBody', () => {
	it('drops headings and keeps the first useful text', () => {
		expect(previewBody('## What to build\n\nThe project builds a Compose app.')).toBe(
			'The project builds a Compose app.',
		)
	})

	it('strips simple Markdown', () => {
		expect(previewBody('**Bold** and `code` and [link](https://example.com).')).toBe('Bold and code and link.')
	})

	it('handles empty and heading-only bodies', () => {
		expect(previewBody('')).toBe('')
		expect(previewBody('## Heading only')).toBe('')
	})

	it('bounds long previews', () => {
		const preview = previewBody('x'.repeat(250))
		expect(preview.length).toBe(200)
		expect(preview.endsWith('…')).toBe(true)
	})
})

describe('searchTickets', () => {
	it('lists everything by default, sorted by ID, with previews but no full bodies', () => {
		const result = searchTickets(sample())
		expect(result.total).toBe(5)
		expect(result.limit).toBe(DEFAULT_SEARCH_LIMIT)
		expect(result.offset).toBe(0)
		expect(result.tickets.map(entry => entry.id)).toEqual([id(1), id(2), id(3), id(4), id(5)])
		expect(result.tickets[0]?.bodyPreview).toBe('Alpha instructions.')
		expect(result.tickets[2]?.bodyPreview).toBe('')
		for (const entry of result.tickets) expect(entry).not.toHaveProperty('body')
	})

	it('searches title and body case-insensitively', () => {
		expect(searchTickets(sample(), { query: 'LOGIN' }).tickets.map(entry => entry.id)).toEqual([id(2)])
		expect(searchTickets(sample(), { query: 'session' }).tickets.map(entry => entry.id)).toEqual([id(2)])
		expect(searchTickets(sample(), { query: 'alpha' }).tickets.map(entry => entry.id)).toEqual([id(1)])
		expect(searchTickets(sample(), { query: 'missing' }).total).toBe(0)
	})

	it('returns only the exact ticket for a full ID query', () => {
		const tickets = deriveAll([
			ticket({ id: id(2), title: 'Login endpoint' }),
			ticket({ id: id(14), title: 'Taskbar status', body: 'Parent of TK-2.' }),
			ticket({ id: id(20), title: 'Twenty', body: 'Mentions TK-2.' }),
		])

		const byId = searchTickets(tickets, { query: 'TK-2' })
		expect(byId.total).toBe(1)
		expect(byId.tickets.map(entry => entry.id)).toEqual([id(2)])
		expect(searchTickets(tickets, { query: 'tk-2' }).tickets.map(entry => entry.id)).toEqual([id(2)])
		expect(searchTickets(tickets, { query: 'TK-99' }).total).toBe(0)
	})

	it('filters by exact ticket ID', () => {
		expect(searchTickets(sample(), { id: id(2) }).tickets.map(entry => entry.id)).toEqual([id(2)])
		expect(searchTickets(sample(), { id: id(99) }).total).toBe(0)
	})

	it('ranks title matches ahead of body-only matches', () => {
		const tickets = deriveAll([
			ticket({ id: id(1), title: 'Unrelated', body: 'Mentions deploy here.' }),
			ticket({ id: id(2), title: 'Deploy pipeline', body: '' }),
		])
		expect(searchTickets(tickets, { query: 'deploy' }).tickets.map(entry => entry.id)).toEqual([id(2), id(1)])
	})

	it('fuzzy-matches text and tolerates small typos', () => {
		expect(searchTickets(sample(), { query: 'documantation' }).tickets.map(entry => entry.id)).toEqual([id(3)])
		expect(searchTickets(sample(), { query: 'sessoin' }).tickets.map(entry => entry.id)).toEqual([id(2)])
	})

	it('requires every requested label and matches labels exactly', () => {
		expect(searchTickets(sample(), { labels: ['feature', 'backend'] }).tickets.map(entry => entry.id)).toEqual([
			id(2),
		])
		expect(searchTickets(sample(), { labels: ['Feature'] }).total).toBe(0)
		expect(searchTickets(sample(), { labels: [] }).total).toBe(5)
	})

	it('matches status, roots, and direct blockers', () => {
		expect(searchTickets(sample(), { status: 'in_progress' }).tickets.map(entry => entry.id)).toEqual([id(3)])
		expect(searchTickets(sample(), { parent: null }).tickets.map(entry => entry.id)).toEqual([id(1), id(4), id(5)])
		expect(searchTickets(sample(), { parent: id(1) }).tickets.map(entry => entry.id)).toEqual([id(2), id(3)])
		expect(searchTickets(sample(), { blocked_by: id(4) }).tickets.map(entry => entry.id)).toEqual([id(2)])
		expect(searchTickets(sample(), { blocked_by: id(1) }).total).toBe(0)
	})

	it('filters by derived readiness and combines filters with AND', () => {
		expect(searchTickets(sample(), { ready: true }).tickets.map(entry => entry.id)).toEqual([id(1), id(2), id(5)])
		expect(
			searchTickets(sample(), {
				status: 'open',
				labels: ['feature'],
				parent: null,
				ready: true,
				query: 'root',
			}).tickets.map(entry => entry.id),
		).toEqual([id(1), id(5)])
	})

	it('paginates deterministically with a total before paging', () => {
		const first = searchTickets(sample(), { limit: 2 })
		expect(first.total).toBe(5)
		expect(first.tickets.map(entry => entry.id)).toEqual([id(1), id(2)])

		const second = searchTickets(sample(), { limit: 2, offset: 2 })
		expect(second.total).toBe(5)
		expect(second.tickets.map(entry => entry.id)).toEqual([id(3), id(4)])

		const beyond = searchTickets(sample(), { limit: 2, offset: 20 })
		expect(beyond.total).toBe(5)
		expect(beyond.tickets).toEqual([])
	})

	it.each([
		[{ limit: 0 }, /limit/],
		[{ limit: MAX_SEARCH_LIMIT + 1 }, /limit/],
		[{ limit: 1.5 }, /limit/],
		[{ offset: -1 }, /offset/],
		[{ offset: 1.5 }, /offset/],
		[{ status: 'done' }, /status/],
		[{ ready: 'yes' }, /ready/],
		[{ id: 'nope' }, /id/],
		[{ parent: 'nope' }, /parent/],
		[{ blocked_by: 'nope' }, /blocked_by/],
	])('rejects invalid filter %j', (filters, pattern) => {
		expect(() => searchTickets(sample(), filters as never)).toThrow(pattern)
	})
})
