import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { setupPlugin } from '../src/index'
import { withTempProject } from './helpers'

describe('server plugin registration', () => {
	it('registers five tools, one context hook, and the read-only RPC handlers', async () => {
		await withTempProject(async root => {
			const tools: Array<{
				name: string
				execute: (input: unknown, context: unknown) => Promise<{ content: string }>
			}> = []
			const disposals: string[] = []
			let contextHook: ((event: { system: Array<{ type: string; text: string }> }) => Promise<void>) | undefined
			let handlers: Record<string, (...args: any[]) => Promise<any>> | undefined
			let namespace: string | undefined

			const context = {
				location: { directory: root },
				tool: {
					transform: async (
						transform: (editor: {
							namespace: (value: { name: string }) => void
							add: (tool: unknown) => void
						}) => void,
					) => {
						transform({
							namespace: value => {
								namespace = value.name
							},
							add: tool => {
								const entry = tool as { name: string }
								tools.push({
									...entry,
									name: namespace === undefined ? entry.name : `${namespace}_${entry.name}`,
								} as (typeof tools)[number])
							},
						})
						return { dispose: async () => void disposals.push('tools') }
					},
				},
				session: {
					hook: async (name: string, callback: typeof contextHook) => {
						expect(name).toBe('context')
						contextHook = callback
						return { dispose: async () => void disposals.push('hook') }
					},
				},
				rpc: {
					register: async (_definition: unknown, value: typeof handlers) => {
						handlers = value
						return { dispose: async () => void disposals.push('rpc') }
					},
				},
			}

			const cleanup = await setupPlugin(context as never)
			expect(tools.map(tool => tool.name)).toEqual([
				'ticket_search',
				'ticket_get',
				'ticket_create',
				'ticket_update',
				'ticket_delete',
			])
			expect(contextHook).toBeTypeOf('function')
			expect(Object.keys(handlers ?? {}).sort()).toEqual(['getTicket', 'listTickets'])

			const create = tools.find(tool => tool.name === 'ticket_create')!
			const update = tools.find(tool => tool.name === 'ticket_update')!
			const created = JSON.parse((await create.execute({ title: 'Context ticket', body: 'Body' }, {})).content)

			const active = JSON.parse((await update.execute({ id: created.id, status: 'in_progress' }, {})).content)

			const emptyEvent = { system: [] as Array<{ type: string; text: string }> }
			await contextHook!(emptyEvent)
			expect(emptyEvent.system).toHaveLength(1)
			expect(emptyEvent.system[0]?.text).toContain('0 open, 1 in progress')
			expect(emptyEvent.system[0]?.text).toContain(active.id)

			const rpcContext = { error: (type: string, message: string, data: unknown) => ({ type, message, data }) }
			const listed = await handlers!.listTickets!(undefined, rpcContext)
			expect(listed.directory).toBe(join(root, '.opencode', 'tickets'))
			expect(listed.tickets.map((entry: { id: string }) => entry.id)).toContain(created.id)
			expect(listed.tickets.find((entry: { id: string }) => entry.id === created.id)).not.toHaveProperty('body')
			const withBodies = await handlers!.listTickets!({ includeBodies: true }, rpcContext)
			expect(withBodies.tickets.find((entry: { id: string }) => entry.id === created.id).body).toBe('Body')

			const detail = await handlers!.getTicket!({ id: created.id }, rpcContext)
			expect(detail.ticket.body).toBe('Body')
			expect(detail.parent).toBeNull()
			expect(detail.children).toEqual([])

			const missing = await handlers!.getTicket!({ id: 'TK-99999999' }, rpcContext)
			expect(missing).toMatchObject({ type: 'not_found', data: { message: expect.any(String) } })

			await cleanup()
			expect(disposals.sort()).toEqual(['hook', 'rpc', 'tools'])
		})
	})

	it('omits the context note when no work is outstanding', async () => {
		await withTempProject(async root => {
			let contextHook: ((event: { system: Array<{ type: string; text: string }> }) => Promise<void>) | undefined
			const context = {
				location: { directory: root },
				tool: { transform: async () => ({ dispose: async () => undefined }) },
				session: {
					hook: async (_name: string, callback: typeof contextHook) => {
						contextHook = callback
						return { dispose: async () => undefined }
					},
				},
				rpc: { register: async () => ({ dispose: async () => undefined }) },
			}
			await setupPlugin(context as never)
			const event = { system: [] as Array<{ type: string; text: string }> }
			await contextHook!(event)
			expect(event.system).toEqual([])
		})
	})

	it('does not fail the model call when ticket storage is invalid', async () => {
		await withTempProject(async root => {
			const { mkdir, writeFile } = await import('node:fs/promises')
			await mkdir(`${root}/.opencode/tickets`, { recursive: true })
			await writeFile(`${root}/.opencode/tickets/TK-1.md`, 'broken')

			let contextHook: ((event: { system: Array<{ type: string; text: string }> }) => Promise<void>) | undefined
			const context = {
				location: { directory: root },
				tool: { transform: async () => ({ dispose: async () => undefined }) },
				session: {
					hook: async (_name: string, callback: typeof contextHook) => {
						contextHook = callback
						return { dispose: async () => undefined }
					},
				},
				rpc: { register: async () => ({ dispose: async () => undefined }) },
			}
			await setupPlugin(context as never)
			const event = { system: [] as Array<{ type: string; text: string }> }
			await expect(contextHook!(event)).resolves.toBeUndefined()
			expect(event.system).toEqual([])
		})
	})

	it('stores tickets under the global config directory when configured', async () => {
		await withTempProject(async root => {
			const configHome = join(root, 'xdg')
			vi.stubEnv('XDG_CONFIG_HOME', configHome)
			try {
				const tools: Array<{
					name: string
					execute: (input: unknown, context: unknown) => Promise<{ content: string }>
				}> = []
				let handlers: Record<string, (...args: any[]) => Promise<any>> | undefined
				let namespace: string | undefined

				const context = {
					location: {
						directory: root,
						project: { id: 'prj_1', directory: root, canonical: root },
					},
					options: { storage: 'global' },
					tool: {
						transform: async (
							transform: (editor: {
								namespace: (value: { name: string }) => void
								add: (tool: unknown) => void
							}) => void,
						) => {
							transform({
								namespace: value => {
									namespace = value.name
								},
								add: tool => {
									const entry = tool as { name: string }
									tools.push({
										...entry,
										name: namespace === undefined ? entry.name : `${namespace}_${entry.name}`,
									} as (typeof tools)[number])
								},
							})
							return { dispose: async () => undefined }
						},
					},
					session: {
						hook: async () => ({ dispose: async () => undefined }),
					},
					rpc: {
						register: async (_definition: unknown, value: typeof handlers) => {
							handlers = value
							return { dispose: async () => undefined }
						},
					},
				}

				const cleanup = await setupPlugin(context as never)
				try {
					const create = tools.find(tool => tool.name === 'ticket_create')!
					await create.execute({ title: 'Global ticket' }, {})

					const directory = join(configHome, 'opencode', 'tickets', 'project-prj_1')
					expect(await readFile(join(directory, 'TK-1.md'), 'utf8')).toContain('id: TK-1')

					const rpcContext = {
						error: (type: string, message: string, data: unknown) => ({ type, message, data }),
					}
					const listed = await handlers!.listTickets!(undefined, rpcContext)
					expect(listed.directory).toBe(directory)
					expect(listed.tickets.map((entry: { id: string }) => entry.id)).toEqual(['TK-1'])
				} finally {
					await cleanup()
				}
			} finally {
				vi.unstubAllEnvs()
			}
		})
	})

	it('rejects invalid plugin options before registering anything', async () => {
		await withTempProject(async root => {
			await expect(
				setupPlugin({
					location: { directory: root },
					options: { storage: 'shared' },
				} as never),
			).rejects.toThrow(/Invalid options/)
		})
	})
})
