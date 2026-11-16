import type { MouseEvent } from '@opentui/core'

type Handler = (event: MouseEvent) => void

function primary(event: MouseEvent): boolean {
	return event.button === 0
}

export function onPrimaryMouseDown(handler: () => void, stop = false): Handler {
	return event => {
		if (!primary(event)) return
		if (stop) event.stopPropagation()
		handler()
	}
}

export function onPrimaryMouseUp(handler: () => void, stop = false): Handler {
	return event => {
		if (!primary(event)) return
		if (stop) event.stopPropagation()
		handler()
	}
}
