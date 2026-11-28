import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'

export type TicketsStorageMode = 'project' | 'global'

export type TicketsOptions = {
	storage: TicketsStorageMode
}

export type ResolveTicketsDirectoryInput = {
	storage: TicketsStorageMode
	locationDirectory: string
	projectId?: string
	env?: Readonly<Record<string, string | undefined>>
	home?: string
	cwd?: string
}

const optionsSchema = z
	.object({
		storage: z.enum(['project', 'global']).default('project'),
	})
	.strict()

/**
 * Validate the plugin's `options` object. An absent object means the defaults,
 * so plugins loaded from a plain string entry keep their project-local store.
 */
export function parseTicketsOptions(options?: Readonly<Record<string, unknown>>): TicketsOptions {
	const result = optionsSchema.safeParse(options ?? {})
	if (result.success) return result.data

	const issues = result.error.issues.map(issue => `${issue.path.join('.') || 'options'}: ${issue.message}`).join('; ')
	throw new Error(
		`Invalid options for @ceski23/opencode-tickets: ${issues}. Expected { "storage": "project" | "global" }.`,
	)
}

/**
 * The OpenCode configuration directory. Mirror OpenCode's own resolution:
 * `OPENCODE_CONFIG_DIR` replaces the whole directory; otherwise the XDG config
 * home (or `~/.config`) gets an `opencode` subdirectory. Relative values are
 * resolved against `cwd` so the returned path is always absolute.
 */
export function openCodeConfigDirectory(
	env: Readonly<Record<string, string | undefined>> = process.env,
	home: string = homedir(),
	cwd: string = process.cwd(),
): string {
	const override = env.OPENCODE_CONFIG_DIR
	if (override !== undefined && override !== '') return resolve(cwd, override)

	const xdg = env.XDG_CONFIG_HOME
	const configHome = xdg !== undefined && xdg !== '' ? resolve(cwd, xdg) : resolve(cwd, home, '.config')
	return join(configHome, 'opencode')
}

/**
 * A stable, filesystem-safe directory name for one project. OpenCode's project
 * ID is opaque; keep it when it is already safe, otherwise hash it so the
 * directory never depends on an ID format.
 */
export function projectKey(id: string): string {
	const safe = /^[A-Za-z0-9._-]{1,64}$/.test(id) && id !== '.' && id !== '..' && !id.endsWith('.')
	return `project-${safe ? id : `h-${createHash('sha256').update(id).digest('hex').slice(0, 16)}`}`
}

export function resolveTicketsDirectory(input: ResolveTicketsDirectoryInput): string {
	if (input.storage === 'project') {
		return join(input.locationDirectory, '.opencode', 'tickets')
	}

	const projectId = input.projectId
	const identity = projectId !== undefined && projectId.trim() !== '' ? projectId : input.locationDirectory
	return join(openCodeConfigDirectory(input.env, input.home, input.cwd), 'tickets', projectKey(identity))
}
