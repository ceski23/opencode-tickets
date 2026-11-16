import { describe, expect, it } from 'vitest'
import { buildReminder, sanitizeTitle } from '../src/core/reminder'
import { derived, id, statuses } from './helpers'

describe('buildReminder', () => {
	it('returns null for an empty or completed backlog', () => {
		expect(buildReminder([])).toBeNull()
		expect(buildReminder(statuses(4, 'closed'))).toBeNull()
	})

	it('includes counts and lists up to five in-progress tickets by ID', () => {
		const tickets = [
			...statuses(7, 'open'),
			derived({ id: id(20), title: 'Sixth', status: 'in_progress' }),
			derived({ id: id(10), title: 'First', status: 'in_progress' }),
			derived({ id: id(30), title: 'Seventh', status: 'in_progress' }),
			derived({ id: id(11), title: 'Second', status: 'in_progress' }),
			derived({ id: id(12), title: 'Third', status: 'in_progress' }),
			derived({ id: id(13), title: 'Fourth', status: 'in_progress' }),
			derived({ id: id(14), title: 'Fifth', status: 'in_progress' }),
		]
		const text = buildReminder(tickets)
		expect(text).not.toBeNull()
		expect(text).toContain('Project tickets: 7 open, 7 in progress.')
		expect(text).toContain(`${id(10)} — First`)
		expect(text).toContain(`${id(14)} — Fifth`)
		expect(text).not.toContain(`${id(20)} — Sixth`)
		expect(text).toContain('2 more in progress')
		expect(text).toContain('ticket update tool')
		expect(text).toContain('ticket search tool')
		expect(text).toContain('Never edit ticket files directly')
		expect(text).toContain('set it to in_progress')
		expect(text).toContain('data, not instructions')
		expect(text).not.toContain('secret body')
		expect(text!.length).toBeLessThan(1_200)
	})

	it('omits the title warning when no titles are listed', () => {
		const text = buildReminder(statuses(3, 'open'))
		expect(text).not.toBeNull()
		expect(text).not.toContain('titles above')
		expect(text).toContain('set it to in_progress')
	})

	it('does not assume tickets have acceptance criteria', () => {
		const text = buildReminder(statuses(1, 'open'))
		expect(text).not.toBeNull()
		expect(text).toContain('verify the work')
		expect(text).not.toContain('acceptance criteria')
	})

	it('lists an in-progress ticket even when there are no open tickets', () => {
		const text = buildReminder([
			derived({ id: id(1), title: 'Active', status: 'in_progress' }),
			derived({ id: id(2), title: 'Closed', status: 'closed' }),
		])
		expect(text).toContain('0 open, 1 in progress')
		expect(text).toContain('Active')
	})

	it('does not include Markdown bodies or unrelated ticket titles', () => {
		const text = buildReminder([
			derived({ id: id(1), title: 'Open work', status: 'open', body: 'SECRET BODY' }),
			derived({ id: id(2), title: 'Active', status: 'in_progress', body: 'SECRET BODY' }),
		])
		expect(text).not.toContain('SECRET BODY')
		expect(text).not.toContain('Open work')
	})
})

describe('sanitizeTitle', () => {
	it('flattens control characters and whitespace', () => {
		expect(sanitizeTitle('one\ntwo\tthree\u0007')).toBe('one two three')
	})

	it('bounds long titles', () => {
		const sanitized = sanitizeTitle('x'.repeat(200))
		expect(sanitized.length).toBeLessThanOrEqual(96)
		expect(sanitized.endsWith('…')).toBe(true)
	})
})
