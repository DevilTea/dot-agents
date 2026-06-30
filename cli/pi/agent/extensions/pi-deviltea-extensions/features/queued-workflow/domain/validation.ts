import type { JsonValue, QueueItem } from './schema.js'

export function isJsonValue(value: unknown): value is JsonValue {
	if (value === null)
		return true
	const type = typeof value
	if (type === 'string' || type === 'boolean')
		return true
	if (type === 'number')
		return Number.isFinite(value)
	if (Array.isArray(value))
		return value.every(isJsonValue)
	if (type === 'object') {
		return Object.getPrototypeOf(value) === Object.prototype
			&& Object.values(value as Record<string, unknown>)
				.every(isJsonValue)
	}
	return false
}

export function assertCanExpandWithWorkerResult(item: QueueItem, workerResult: { type: string }): void {
	if (workerResult.type === 'expand' && !item.canExpand) {
		throw new Error(`Item ${item.id} cannot expand`)
	}
}

export function inheritChildExpansion(parent: QueueItem, requestedCanExpand?: boolean): boolean {
	return parent.canExpand ? requestedCanExpand ?? true : false
}

export function inheritConstraints(parent: QueueItem, childConstraints: string[] = []): string[] {
	return [...parent.constraints, ...childConstraints]
}

export function inheritOutOfScope(parent: QueueItem, childOutOfScope: string[] = []): string[] {
	return [...parent.outOfScope, ...childOutOfScope]
}
