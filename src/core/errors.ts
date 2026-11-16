export type TicketErrorCode =
	| 'invalid_input'
	| 'invalid_id'
	| 'invalid_storage'
	| 'not_found'
	| 'conflict'
	| 'referenced'

/**
 * A user-facing ticket error. The message is written for an agent or human to
 * act on: it names the offending ticket, file, field, or relationship.
 */
export class TicketError extends Error {
	readonly code: TicketErrorCode
	readonly details: readonly string[]

	constructor(
		code: TicketErrorCode,
		message: string,
		options: { details?: readonly string[]; cause?: unknown } = {},
	) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause })
		this.name = 'TicketError'
		this.code = code
		this.details = options.details ?? []
	}
}

export function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message
	return String(error)
}
