import type { DiffSection, TargetMode } from './types.js'
import { createHash } from 'node:crypto'
import { countLines, isLikelyGeneratedPath, patchStats } from './utils.js'

const DIFF_HEADER_PATTERN = /^diff --git a\/(.*?) b\/(.*)$/gm
const BINARY_PATCH_PATTERN = /^(?:GIT binary patch|Binary files )/m
const DELETED_FILE_PATTERN = /^deleted file mode /m
const NEW_FILE_PATTERN = /^new file mode /m

export function hashDiff(mode: TargetMode, diff: string): string {
	return createHash('sha256')
		.update(mode)
		.update('\0')
		.update(diff)
		.digest('hex')
}

export function parseDiffSections(diff: string): DiffSection[] {
	const matches = [...diff.matchAll(DIFF_HEADER_PATTERN)]
	return matches.map((match, index) => {
		const startOffset = match.index ?? 0
		const endOffset = matches[index + 1]?.index ?? diff.length
		const patch = diff.slice(startOffset, endOffset)
		const headerPath = match[2] || match[1] || `section-${index + 1}`
		const startLine = countLines(diff.slice(0, startOffset)) + 1
		const endLine = startLine + countLines(patch) - 1
		const stats = patchStats(patch)
		return {
			id: `S${index + 1}`,
			path: headerPath,
			startLine,
			endLine,
			patch,
			additions: stats.additions,
			removals: stats.removals,
			binary: BINARY_PATCH_PATTERN.test(patch),
			deleted: DELETED_FILE_PATTERN.test(patch),
			newFile: NEW_FILE_PATTERN.test(patch),
			likelyGenerated: isLikelyGeneratedPath(headerPath),
		}
	})
}

export function formatDiffManifest(sections: DiffSection[]): string {
	return sections.map((section) => {
		const flags = [
			section.binary ? 'binary' : undefined,
			section.newFile ? 'new' : undefined,
			section.deleted ? 'deleted' : undefined,
			section.likelyGenerated ? 'low-info/generated-like' : undefined,
		].filter(Boolean)
			.join(', ')
		return `- ${section.id}: ${section.path} (diff lines ${section.startLine}-${section.endLine}, +${section.additions}/-${section.removals}${flags ? `, ${flags}` : ''})`
	})
		.join('\n')
}
