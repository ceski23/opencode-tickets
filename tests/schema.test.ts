import { describe, expect, it } from 'vitest'
import {
	assertTicketId,
	normalizeBody,
	normalizeLabels,
	normalizeTitle,
	parseTicketFile,
	serializeTicket,
	type Ticket,
} from '../src/core/schema'
import { id } from './helpers'

const valid = `---
id: TK-1
title: Implement login endpoint
status: open
labels:
  - feature
  - ready-for-agent
parent: TK-2
blocked_by:
  - TK-3
---

## Description

Session authentication.
`

describe('parseTicketFile', () => {
	it('parses frontmatter and body', () => {
		const parsed = parseTicketFile(valid, 'TK-1.md')
		expect(parsed).toEqual({
			id: 'TK-1',
			title: 'Implement login endpoint',
			status: 'open',
			labels: ['feature', 'ready-for-agent'],
			parent: 'TK-2',
			blocked_by: ['TK-3'],
			body: '## Description\n\nSession authentication.',
		})
	})

	it('applies defaults and accepts a missing body', () => {
		const parsed = parseTicketFile(`---
id: TK-1
title: Minimal
status: in_progress
---
`)
		expect(parsed.labels).toEqual([])
		expect(parsed.parent).toBeNull()
		expect(parsed.blocked_by).toEqual([])
		expect(parsed.body).toBe('')
	})

	it('handles BOM and CRLF line endings', () => {
		const parsed = parseTicketFile(
			`\uFEFF---\r\nid: TK-1\r\ntitle: Windows\r\nstatus: closed\r\n---\r\n\r\nBody line\r\n`,
			'TK-1.md',
		)
		expect(parsed.title).toBe('Windows')
		expect(parsed.body).toBe('Body line')
	})

	it('trims and deduplicates labels while preserving spelling', () => {
		const parsed = parseTicketFile(`---
id: TK-1
title: Labels
status: open
labels:
  - " Backend "
  - Backend
  - backend
---
`)
		expect(parsed.labels).toEqual(['Backend', 'backend'])
	})

	it.each([
		['missing frontmatter', 'title: Nope\n'],
		['unterminated frontmatter', '---\nid: TK-1\n'],
		['malformed YAML', '---\nid: [TK-1\n---\n'],
		['non-mapping YAML', '---\n- one\n- two\n---\n'],
		['unknown field', '---\nid: TK-1\ntitle: T\nstatus: open\nowner: me\n---\n'],
		['invalid ID', '---\nid: ticket-1\ntitle: T\nstatus: open\n---\n'],
		['missing title', '---\nid: TK-1\nstatus: open\n---\n'],
		['multiline title', '---\nid: TK-1\ntitle: "one\\ntwo"\nstatus: open\n---\n'],
		['invalid status', '---\nid: TK-1\ntitle: T\nstatus: done\n---\n'],
		['invalid parent', '---\nid: TK-1\ntitle: T\nstatus: open\nparent: nope\n---\n'],
		['invalid blocker', '---\nid: TK-1\ntitle: T\nstatus: open\nblocked_by:\n  - nope\n---\n'],
	])('rejects %s with an actionable storage error', (_name, raw) => {
		expect(() => parseTicketFile(raw, 'TK-1.md')).toThrow(/TK-1\.md:/)
		expect(() => parseTicketFile(raw, 'TK-1.md')).toThrow(/^.*: /)
	})

	it('rejects a filename that does not match the ticket ID', () => {
		expect(() => parseTicketFile(valid, 'TK-99999999.md')).toThrow(/filename must match/)
	})

	it('does not silently accept a non-object YAML scalar', () => {
		expect(() => parseTicketFile('---\nhello\n---\n')).toThrow(/frontmatter must be a YAML mapping/)
	})
})

describe('serializeTicket', () => {
	it('round-trips a multiline label containing a frontmatter delimiter', () => {
		const ticket: Ticket = {
			id: id(1),
			title: 'Label',
			status: 'open',
			labels: ['hello\n---\nworld'],
			parent: null,
			blocked_by: [],
			body: 'Body',
		}
		expect(parseTicketFile(serializeTicket(ticket), 'TK-1.md')).toEqual(ticket)
	})

	it('round-trips a ticket with a complex body', () => {
		const original: Ticket = {
			id: id(1),
			title: 'Fix: "quoted" title',
			status: 'in_progress',
			labels: ['needs review', 'backend'],
			parent: id(2),
			blocked_by: [id(3)],
			body: '## Notes\n\n- [x] done\n- [ ] todo\n\n```ts\nconst x = 1\n```',
		}
		const parsed = parseTicketFile(serializeTicket(original), `${original.id}.md`)
		expect(parsed).toEqual(original)
	})

	it('trims trailing newlines from the body', () => {
		const text = serializeTicket({
			id: id(1),
			title: 'Trimmed',
			status: 'open',
			labels: [],
			parent: null,
			blocked_by: [],
			body: '\nText\n\n',
		})
		expect(text.endsWith('Text\n')).toBe(true)
		expect(text).not.toContain('Text\n\n')
		expect(parseTicketFile(text, `${id(1)}.md`).body).toBe('Text')
	})

	it('writes an empty body without trailing blank content', () => {
		const text = serializeTicket({
			id: id(1),
			title: 'Empty',
			status: 'open',
			labels: [],
			parent: null,
			blocked_by: [],
			body: '',
		})
		expect(text.endsWith('---\n')).toBe(true)
		expect(parseTicketFile(text, `${id(1)}.md`).body).toBe('')
	})
})

describe('normalizers', () => {
	it('rejects empty and multi-line titles', () => {
		expect(() => normalizeTitle('   ')).toThrow(/empty/)
		expect(() => normalizeTitle('a\nb')).toThrow(/single line/)
		expect(normalizeTitle('  Fine  ')).toBe('Fine')
	})

	it('trims leading and trailing body newlines and normalizes CRLF', () => {
		expect(normalizeBody('\r\n\r\nText\r\n\r\n')).toBe('Text')
	})

	it('validates ticket IDs', () => {
		expect(assertTicketId('TK-42')).toBe('TK-42')
		expect(() => assertTicketId('tk-42')).toThrow(/Invalid/)
		expect(() => assertTicketId('TK-0')).toThrow(/Invalid/)
		expect(() => assertTicketId('../escape')).toThrow(/Invalid/)
	})

	it('rejects empty labels and non-string entries', () => {
		expect(() => normalizeLabels(['ok', ' '])).toThrow(/empty/)
		expect(() => normalizeLabels([1])).toThrow(/only strings/)
	})
})
