import { randomUUID } from 'node:crypto'

export function createId(prefix: string): string {
	return `${prefix}_${randomUUID()}`
}

export function createQueueItemId(): string {
	return createId('qwi')
}

export function createRunId(): string {
	return createId('qwr')
}

export function createKnowledgeRecordId(): string {
	return createId('qwk')
}
