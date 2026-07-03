import { randomUUID } from 'node:crypto'

export function createId(prefix: string): string {
	return `${prefix}_${randomUUID()}`
}

export function createRootId(): string {
	return createId('qwi')
}

export function createStepId(): string {
	return createId('qws')
}

export function createRunId(): string {
	return createId('qwr')
}
