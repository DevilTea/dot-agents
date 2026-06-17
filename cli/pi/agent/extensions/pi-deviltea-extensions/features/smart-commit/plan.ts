import type { DiffSection, PendingSmartCommitRequest, PlannedCommit, PlannedCommitInput } from './types.js'
import { normalizeCommitMessage, normalizePatch } from './utils.js'

const LINE_RANGE_REF_PATTERN = /^L?(\d+)-(\d+)$/
const TRAILING_NEWLINES_PATTERN = /\n+$/

export function summarizePlanMode(commits: PlannedCommitInput[]): 'refs' | 'patches' | 'mixed' | 'empty' {
	let refs = 0
	let patches = 0
	for (const commit of commits) {
		if ((commit.refs?.length ?? 0) > 0)
			refs++
		if (commit.patch?.trim())
			patches++
	}
	if (refs > 0 && patches > 0)
		return 'mixed'
	if (refs > 0)
		return 'refs'
	if (patches > 0)
		return 'patches'
	return 'empty'
}

function validatePatchPlan(commits: PlannedCommitInput[]): PlannedCommit[] {
	return commits.map((commit, index) => {
		const message = normalizeCommitMessage(commit.message)
		const patch = normalizePatch(commit.patch ?? '')
		if (!patch.trim())
			throw new Error(`Commit ${index + 1} patch must not be empty.`)
		if (!patch.includes('diff --git'))
			throw new Error(`Commit ${index + 1} patch must be a git unified diff.`)
		return { message, summary: commit.summary?.trim(), patch }
	})
}

function resolveDiffSectionRef(ref: string, sectionsById: Map<string, DiffSection>, sectionsByLineRange: Map<string, DiffSection>): DiffSection | undefined {
	const byId = sectionsById.get(ref)
	if (byId)
		return byId

	const lineRange = ref.match(LINE_RANGE_REF_PATTERN)
	if (!lineRange)
		return undefined
	return sectionsByLineRange.get(`${lineRange[1]}-${lineRange[2]}`)
}

function validateRefPlan(request: PendingSmartCommitRequest, commits: PlannedCommitInput[]): PlannedCommit[] {
	const sectionsById = new Map(request.diffSections.map(section => [section.id, section]))
	const sectionsByLineRange = new Map(request.diffSections.map(section => [`${section.startLine}-${section.endLine}`, section]))
	const seen = new Map<string, number>()

	const planned = commits.map((commit, index) => {
		const message = normalizeCommitMessage(commit.message)
		const refs = commit.refs ?? []
		if (refs.length === 0)
			throw new Error(`Commit ${index + 1} refs must not be empty.`)

		const sections = refs.map((ref) => {
			const section = resolveDiffSectionRef(ref, sectionsById, sectionsByLineRange)
			if (!section)
				throw new Error(`Commit ${index + 1} references unknown diff section ${ref}. Use a manifest id like S1 or an exact line range like L12-34.`)
			const previous = seen.get(section.id)
			if (previous !== undefined)
				throw new Error(`Diff section ${section.id} is used by both commit ${previous + 1} and commit ${index + 1}.`)
			seen.set(section.id, index)
			return section
		})

		const patch = normalizePatch(sections.map(section => section.patch.replace(TRAILING_NEWLINES_PATTERN, ''))
			.join('\n'))
		return { message, summary: commit.summary?.trim(), refs, patch }
	})

	const missing = request.diffSections.filter(section => !seen.has(section.id))
	if (missing.length > 0) {
		throw new Error(`Commit refs do not cover all selected diff sections. Missing: ${missing.map(section => `${section.id} ${section.path}`)
			.join(', ')}.`)
	}

	return planned
}

export function validatePlan(request: PendingSmartCommitRequest, commits: PlannedCommitInput[]): PlannedCommit[] {
	if (commits.length === 0)
		throw new Error('Commit plan must contain at least one commit.')
	const commitsWithRefs = commits.filter(commit => (commit.refs?.length ?? 0) > 0).length
	const commitsWithPatches = commits.filter(commit => commit.patch?.trim()).length

	if (commitsWithRefs > 0 && commitsWithPatches > 0) {
		throw new Error('Do not mix refs and patch fallback in one smart commit plan. Use refs for every commit, or patch for every commit.')
	}
	if (commitsWithRefs > 0)
		return validateRefPlan(request, commits)
	if (commitsWithPatches > 0)
		return validatePatchPlan(commits)
	throw new Error('Each commit must provide refs or a patch.')
}
