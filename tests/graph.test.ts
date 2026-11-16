import { describe, expect, it } from 'vitest'
import { deriveAll, summarizeTicket, validateGraph } from '../src/core/graph'
import { id, ticket } from './helpers'

describe('validateGraph', () => {
	it('accepts valid parent and blocking relationships', () => {
		const tickets = [
			ticket({ id: id(1), title: 'Root' }),
			ticket({ id: id(2), title: 'Child', parent: id(1), blocked_by: [id(3)] }),
			ticket({ id: id(3), title: 'Blocker', status: 'closed' }),
		]
		expect(() => validateGraph(tickets)).not.toThrow()
	})

	it('collects missing references and self references', () => {
		const tickets = [ticket({ id: id(1), title: 'Broken', parent: id(1), blocked_by: [id(9), id(1)] })]
		const error = (() => {
			try {
				validateGraph(tickets)
			} catch (caught) {
				return caught
			}
		})()
		expect(error).toMatchObject({ code: 'invalid_storage' })
		const message = (error as Error).message
		expect(message).toContain('cannot be its own parent')
		expect(message).toContain('cannot block itself')
		expect(message).toContain('missing blocker')
	})

	it('detects parent cycles', () => {
		const tickets = [
			ticket({ id: id(1), title: 'One', parent: id(2) }),
			ticket({ id: id(2), title: 'Two', parent: id(1) }),
		]
		expect(() => validateGraph(tickets)).toThrow(/Parent cycle detected/)
	})

	it('detects blocking cycles', () => {
		const tickets = [
			ticket({ id: id(1), title: 'One', blocked_by: [id(2)] }),
			ticket({ id: id(2), title: 'Two', blocked_by: [id(1)] }),
		]
		expect(() => validateGraph(tickets)).toThrow(/Blocking cycle detected/)
	})

	it('rejects duplicate IDs', () => {
		const tickets = [ticket({ id: id(1), title: 'One' }), ticket({ id: id(1), title: 'Duplicate' })]
		expect(() => validateGraph(tickets)).toThrow(/Duplicate ticket ID/)
	})
})

describe('deriveAll', () => {
	it('derives sorted children, blocks, readiness, and blocked indicators', () => {
		const tickets = [
			ticket({ id: id(1), title: 'Root' }),
			ticket({ id: id(4), title: 'Open child', parent: id(1) }),
			ticket({ id: id(2), title: 'Closed blocker', parent: id(1), status: 'closed' }),
			ticket({
				id: id(3),
				title: 'Open blocked',
				parent: id(1),
				blocked_by: [id(2), id(5)],
			}),
			ticket({ id: id(5), title: 'Open blocker' }),
			ticket({ id: id(6), title: 'Active', status: 'in_progress' }),
		]
		const derived = deriveAll(tickets)
		const byId = new Map(derived.map(entry => [entry.id, entry]))

		expect(byId.get(id(1))?.children).toEqual([id(2), id(3), id(4)])
		expect(byId.get(id(2))?.blocks).toEqual([id(3)])
		expect(byId.get(id(3))?.blocked).toBe(true)
		expect(byId.get(id(3))?.ready).toBe(false)
		expect(byId.get(id(4))?.ready).toBe(true)
		expect(byId.get(id(6))?.ready).toBe(false)

		const closed = deriveAll([
			ticket({ id: id(7), title: 'Closed', status: 'closed' }),
			ticket({ id: id(8), title: 'Open dep', blocked_by: [id(7)] }),
		])
		expect(closed.find(entry => entry.id === id(8))?.ready).toBe(true)
		expect(closed.find(entry => entry.id === id(8))?.blocked).toBe(false)
	})

	it('produces compact summaries without bodies', () => {
		const [entry] = deriveAll([ticket({ id: id(1), title: 'One', body: 'secret' })])
		expect(entry).toBeDefined()
		const summary = summarizeTicket(entry!)
		expect(summary).not.toHaveProperty('body')
		expect(summary).toEqual({
			id: id(1),
			title: 'One',
			status: 'open',
			labels: [],
			parent: null,
			blocked_by: [],
			ready: true,
			blocked: false,
		})
	})
})
