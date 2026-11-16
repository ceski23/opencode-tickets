import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TicketStorage } from '../src/core/storage'
import { ticket, withTempProject } from './helpers'

describe('TicketStorage', () => {
	it('treats a missing directory as an empty collection', async () => {
		await withTempProject(async root => {
			const storage = new TicketStorage(root)
			expect(await storage.loadAll()).toEqual([])
			expect(storage.directory).toBe(join(root, '.opencode', 'tickets'))
		})
	})

	it('creates the directory on first write and reads the ticket back', async () => {
		await withTempProject(async root => {
			const storage = new TicketStorage(root)
			const value = ticket({ id: 'TK-1', title: 'First' })
			await storage.write(value)

			expect(await readdir(storage.directory)).toEqual(['TK-1.md'])
			expect(await storage.loadAll()).toEqual([value])
			expect((await readFile(storage.pathFor(value.id), 'utf8')).startsWith('---\nid:')).toBe(true)
		})
	})

	it('sorts tickets by ID and ignores non-Markdown files', async () => {
		await withTempProject(async root => {
			const storage = new TicketStorage(root)
			await storage.write(ticket({ id: 'TK-3', title: 'Third' }))
			await storage.write(ticket({ id: 'TK-1', title: 'First' }))
			await writeFile(join(storage.directory, 'notes.txt'), 'not a ticket')
			await writeFile(join(storage.directory, 'ignore.json'), '{}')

			const loaded = await storage.loadAll()
			expect(loaded.map(entry => entry.id)).toEqual(['TK-1', 'TK-3'])
		})
	})

	it('reports every invalid file at once instead of omitting tickets', async () => {
		await withTempProject(async root => {
			const storage = new TicketStorage(root)
			await mkdir(storage.directory, { recursive: true })
			await writeFile(join(storage.directory, 'TK-1.md'), '---\nid: TK-1\n')
			await writeFile(join(storage.directory, 'TK-2.md'), 'no frontmatter\n')

			const error = await storage.loadAll().catch((caught: unknown) => caught)
			expect(error).toMatchObject({ code: 'invalid_storage' })
			expect((error as Error).message).toContain('TK-1.md')
			expect((error as Error).message).toContain('TK-2.md')
		})
	})

	it('rejects path-traversal IDs', async () => {
		await withTempProject(async root => {
			const storage = new TicketStorage(root)
			expect(() => storage.pathFor('../../outside')).toThrow(/Invalid/)
		})
	})

	it('reports a missing ticket on remove', async () => {
		await withTempProject(async root => {
			const storage = new TicketStorage(root)
			await expect(storage.remove('TK-1')).rejects.toMatchObject({ code: 'not_found' })
		})
	})
})
