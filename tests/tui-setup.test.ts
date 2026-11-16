import { describe, expect, it } from 'vitest'
import plugin from '../src/tui'

describe('tui plugin setup', () => {
	it('registers the tickets command and sidebar summary, and opens a native dialog', async () => {
		const calls = {
			set: [] as unknown[],
			show: [] as Array<() => void>,
			clear: 0,
		}
		let layerFactory: (() => any) | undefined
		let slotClaim: any

		const context = {
			renderer: {
				clearSelection() {},
			},
			keymap: {
				layer(factory: () => any) {
					layerFactory = factory
				},
			},
			ui: {
				dialog: {
					set(options: unknown) {
						calls.set.push(options)
					},
					show(_render: () => unknown, onClose?: () => void) {
						calls.show.push(onClose ?? (() => {}))
					},
					clear() {
						calls.clear += 1
					},
				},
				slot(claim: any) {
					slotClaim = claim
					return () => {}
				},
			},
			location: { directory: '/tmp/project' },
		}

		const cleanup = await plugin.setup(context as any)
		const layer = layerFactory?.()
		const commands = layer?.commands ?? []
		const open = commands.find((command: any) => command.id === 'tickets.open')

		expect(open).toBeDefined()
		expect(open.slash).toEqual({ name: 'tickets' })
		expect(open.palette).toBe(true)
		expect(slotClaim).toMatchObject({ prepend: 'sidebar.content' })

		open.run()
		open.run()
		expect(calls.set).toEqual([{ size: 'xlarge', centered: true }])
		expect(calls.show).toHaveLength(1)

		calls.show[0]?.()
		open.run()
		expect(calls.show).toHaveLength(2)

		if (typeof cleanup === 'function') await cleanup()
	})
})
