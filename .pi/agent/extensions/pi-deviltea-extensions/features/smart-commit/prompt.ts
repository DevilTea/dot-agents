import type { PendingSmartCommitRequest, SmartCommitAnalysisDetails } from './types.js'
import { APPLY_PLAN_TOOL } from './constants.js'
import { formatDiffManifest } from './diff.js'

export function buildPrompt(request: PendingSmartCommitRequest, recentMessages: string, inlineDiffCharLimit: number): string {
	const inlineDiff = request.targetDiff.length <= inlineDiffCharLimit
		? request.targetDiff
		: request.targetDiff.slice(0, inlineDiffCharLimit)
	const omitted = request.targetDiff.length - inlineDiff.length
	const diffSection = [
		'Selected diff section manifest:',
		'```text',
		formatDiffManifest(request.diffSections),
		'```',
		'',
		request.diffFile ? `Full selected diff is saved at: ${request.diffFile}` : undefined,
		'Selected diff excerpt for context only:',
		'```diff',
		inlineDiff,
		'```',
		omitted > 0 ? `${omitted} characters omitted from inline excerpt. Use the manifest refs for the final tool call; read the full file only if section summaries are insufficient.` : undefined,
	].filter(line => line !== undefined)
		.join('\n')

	return [
		'Plan and apply smart commits for the selected git changes.',
		'',
		`Request id: ${request.requestId}`,
		`Repository root: ${request.repoRoot}`,
		`Selected target: ${request.mode}`,
		`Selected diff sha256: ${request.targetDiffHash}`,
		'',
		'Selection policy already applied by the extension:',
		'- If staged and working-tree changes both exist, only staged changes are selected.',
		'- Otherwise all changes from the only changed area are selected.',
		'',
		'Your task:',
		'- Inspect the selected diff and recent commit messages.',
		'- Split the selected changes into one or more coherent commits.',
		'- Keep related changes together and separate independent concerns.',
		'- Match the repository\'s commit message style.',
		'- Include every selected change exactly once across the commits.',
		'- Do not include unselected changes.',
		'- Prefer refs over patch content in the final tool call to keep arguments small.',
		'- Use section refs from the manifest for low-information files such as lock files, generated-like files, or dependency lock updates that belong with package/config changes; do not read huge diffs unless needed for grouping.',
		'- If file context is needed, use read before the final tool call.',
		'- Do not run git add, git commit, or shell git commands yourself.',
		`- Finish by calling ${APPLY_PLAN_TOOL} as the final action; do not write a final assistant message after it.`,
		'',
		'Plan reference requirements:',
		'- Prefer commits[].refs: an array of manifest section ids such as ["S1", "S4"] or exact diff line ranges such as ["L12-34"].',
		'- Line range refs must match a complete manifest section range; use legacy patch fallback for hunk-level file splitting.',
		'- Each selected manifest section must appear exactly once across all commits when using refs.',
		'- The tool will rebuild valid git patches from refs; do not paste patch content unless refs cannot represent the split.',
		'- If one file must be split across multiple commits at hunk level, use the legacy patch fallback for the whole plan instead of mixing refs and patches.',
		'- For binary files, prefer the manifest section ref so the original selected binary diff is reused.',
		'',
		'Tool call shape:',
		`- requestId must be ${request.requestId}`,
		'- commits[].message is the final commit message.',
		'- commits[].summary briefly explains the split.',
		'- commits[].refs is the preferred compact list of selected diff section ids for that commit.',
		'- commits[].patch is optional legacy fallback; avoid for large diffs.',
		'',
		'Recent commit messages:',
		'```text',
		recentMessages || 'No recent commit messages found.',
		'```',
		'',
		'Current git status:',
		'```text',
		request.status || 'No status output.',
		'```',
		'',
		diffSection,
	].join('\n')
}

export function buildAnalysisDetails(request: PendingSmartCommitRequest): SmartCommitAnalysisDetails {
	return {
		requestId: request.requestId,
		mode: request.mode,
		repoRoot: request.repoRoot,
		sectionCount: request.diffSections.length,
		sections: request.diffSections.map(section => `${section.id} ${section.path}`),
	}
}
