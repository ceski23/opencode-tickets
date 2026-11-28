import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openCodeConfigDirectory, parseTicketsOptions, resolveTicketsDirectory } from '../src/core/paths'

const project = join(tmpdir(), 'tickets-project')
const home = join(tmpdir(), 'tickets-home')
const config = join(tmpdir(), 'tickets-config')
const cwd = join(tmpdir(), 'tickets-cwd')

describe('parseTicketsOptions', () => {
	it('defaults to project storage', () => {
		expect(parseTicketsOptions()).toEqual({ storage: 'project' })
		expect(parseTicketsOptions({})).toEqual({ storage: 'project' })
		expect(parseTicketsOptions({ storage: 'project' })).toEqual({ storage: 'project' })
	})

	it('accepts global storage', () => {
		expect(parseTicketsOptions({ storage: 'global' })).toEqual({ storage: 'global' })
	})

	it('rejects an unknown mode', () => {
		expect(() => parseTicketsOptions({ storage: 'shared' })).toThrow(/Invalid options/)
	})

	it('rejects unknown fields', () => {
		expect(() => parseTicketsOptions({ root: config })).toThrow(/Invalid options/)
	})
})

describe('openCodeConfigDirectory', () => {
	it('uses an absolute XDG_CONFIG_HOME', () => {
		expect(openCodeConfigDirectory({ XDG_CONFIG_HOME: config }, home)).toBe(join(config, 'opencode'))
	})

	it('falls back to ~/.config without XDG', () => {
		expect(openCodeConfigDirectory({}, home)).toBe(join(home, '.config', 'opencode'))
	})

	it('resolves a relative XDG_CONFIG_HOME against the working directory', () => {
		expect(openCodeConfigDirectory({ XDG_CONFIG_HOME: 'relative' }, home, cwd)).toBe(
			join(cwd, 'relative', 'opencode'),
		)
	})

	it('treats a blank XDG_CONFIG_HOME as unset', () => {
		expect(openCodeConfigDirectory({ XDG_CONFIG_HOME: '' }, home)).toBe(join(home, '.config', 'opencode'))
	})

	it('uses OPENCODE_CONFIG_DIR as the complete config directory', () => {
		expect(openCodeConfigDirectory({ OPENCODE_CONFIG_DIR: config }, home)).toBe(config)
	})

	it('resolves a relative OPENCODE_CONFIG_DIR against the working directory', () => {
		expect(openCodeConfigDirectory({ OPENCODE_CONFIG_DIR: 'relative-config' }, home, cwd)).toBe(
			join(cwd, 'relative-config'),
		)
	})

	it('prefers OPENCODE_CONFIG_DIR over XDG_CONFIG_HOME', () => {
		expect(
			openCodeConfigDirectory(
				{ OPENCODE_CONFIG_DIR: config, XDG_CONFIG_HOME: join(tmpdir(), 'tickets-xdg') },
				home,
			),
		).toBe(config)
	})
})

describe('resolveTicketsDirectory', () => {
	it('keeps the project-local default', () => {
		expect(
			resolveTicketsDirectory({
				storage: 'project',
				locationDirectory: project,
				projectId: 'prj_1',
			}),
		).toBe(join(project, '.opencode', 'tickets'))
	})

	it('stores global tickets under the OpenCode config directory', () => {
		expect(
			resolveTicketsDirectory({
				storage: 'global',
				locationDirectory: project,
				projectId: 'prj_1',
				env: { XDG_CONFIG_HOME: config },
				home,
			}),
		).toBe(join(config, 'opencode', 'tickets', 'project-prj_1'))
	})

	it('uses ~/.config for global tickets without XDG', () => {
		expect(
			resolveTicketsDirectory({
				storage: 'global',
				locationDirectory: project,
				projectId: 'prj_1',
				env: {},
				home,
			}),
		).toBe(join(home, '.config', 'opencode', 'tickets', 'project-prj_1'))
	})

	it('uses OPENCODE_CONFIG_DIR for global tickets', () => {
		expect(
			resolveTicketsDirectory({
				storage: 'global',
				locationDirectory: project,
				projectId: 'prj_1',
				env: { OPENCODE_CONFIG_DIR: config },
				home,
			}),
		).toBe(join(config, 'tickets', 'project-prj_1'))
	})

	it('resolves a relative config directory against the working directory', () => {
		expect(
			resolveTicketsDirectory({
				storage: 'global',
				locationDirectory: project,
				projectId: 'prj_1',
				env: { XDG_CONFIG_HOME: 'relative' },
				home,
				cwd,
			}),
		).toBe(join(cwd, 'relative', 'opencode', 'tickets', 'project-prj_1'))
	})

	it('hashes project IDs that are not safe path components', () => {
		for (const projectId of ['../outside', '.', '..', 'name.'.repeat(16), 'a'.repeat(65)]) {
			const directory = resolveTicketsDirectory({
				storage: 'global',
				locationDirectory: project,
				projectId,
				env: {},
				home,
			})
			expect(basename(directory)).toMatch(/^project-h-[0-9a-f]{16}$/)
		}
	})

	it('falls back to the location when the project ID is missing', () => {
		const first = resolveTicketsDirectory({
			storage: 'global',
			locationDirectory: project,
			env: {},
			home,
		})
		const second = resolveTicketsDirectory({
			storage: 'global',
			locationDirectory: project,
			env: {},
			home,
		})
		expect(basename(first)).toMatch(/^project-h-[0-9a-f]{16}$/)
		expect(first).toBe(second)
	})
})
