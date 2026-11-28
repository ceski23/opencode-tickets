import { randomBytes } from 'node:crypto'
import { access, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TicketError } from './errors'
import { assertTicketId, compareTicketIds, parseTicketFile, serializeTicket, type Ticket } from './schema'

/**
 * Markdown ticket storage. The directory defaults to
 * `<project>/.opencode/tickets/` but the plugin can pass a resolved directory
 * for global storage.
 *
 * Every read parses the complete directory and reports every invalid file at
 * once. Writes use a temporary file plus rename so a crash cannot leave a
 * partially written ticket behind.
 */
export class TicketStorage {
	readonly root: string
	readonly directory: string

	constructor(root: string, directory = join(root, '.opencode', 'tickets')) {
		this.root = root
		this.directory = directory
	}

	pathFor(id: string): string {
		return join(this.directory, `${assertTicketId(id)}.md`)
	}

	async loadAll(): Promise<Ticket[]> {
		let entries: string[]
		try {
			entries = await readdir(this.directory)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
			throw new TicketError(
				'invalid_storage',
				`Cannot read ticket directory ${this.directory}: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			)
		}

		const files = entries.filter(entry => entry.toLowerCase().endsWith('.md')).sort()
		const tickets: Ticket[] = []
		const issues: string[] = []

		for (const file of files) {
			try {
				const raw = await readFile(join(this.directory, file), 'utf8')
				tickets.push(parseTicketFile(raw, file))
			} catch (error) {
				issues.push(error instanceof Error ? error.message : `${file}: ${String(error)}`)
			}
		}

		if (issues.length > 0) {
			throw new TicketError(
				'invalid_storage',
				`Ticket storage at ${this.directory} is invalid:\n${issues.map(issue => `- ${issue}`).join('\n')}`,
				{ details: issues },
			)
		}

		tickets.sort((a, b) => compareTicketIds(a.id, b.id))
		return tickets
	}

	async exists(id: string): Promise<boolean> {
		try {
			await access(this.pathFor(id))
			return true
		} catch {
			return false
		}
	}

	async write(ticket: Ticket, options: { overwrite?: boolean } = {}): Promise<void> {
		const path = this.pathFor(ticket.id)
		if (options.overwrite === false && (await this.exists(ticket.id))) {
			throw new TicketError('conflict', `Ticket ${ticket.id} already exists.`)
		}
		await mkdir(this.directory, { recursive: true })
		const temp = join(this.directory, `.${ticket.id}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`)
		try {
			await writeFile(temp, serializeTicket(ticket), { encoding: 'utf8', flag: 'wx' })
			await rename(temp, path)
		} catch (error) {
			await unlink(temp).catch(() => undefined)
			throw new TicketError(
				'invalid_storage',
				`Cannot write ticket ${ticket.id} to ${path}: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			)
		}
	}

	async remove(id: string): Promise<void> {
		const path = this.pathFor(id)
		try {
			await unlink(path)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				throw new TicketError('not_found', `Ticket ${id} does not exist.`)
			}
			throw new TicketError(
				'invalid_storage',
				`Cannot delete ticket ${id} at ${path}: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			)
		}
	}
}
