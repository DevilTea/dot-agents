export type TargetMode = 'staged' | 'working'

export interface DiffSection {
	id: string
	path: string
	startLine: number
	endLine: number
	patch: string
	additions: number
	removals: number
	binary: boolean
	deleted: boolean
	newFile: boolean
	likelyGenerated: boolean
}

export interface PendingSmartCommitRequest {
	requestId: string
	cwd: string
	repoRoot: string
	mode: TargetMode
	status: string
	targetDiff: string
	targetDiffHash: string
	diffSections: DiffSection[]
	diffFile?: string
	createdAt: number
}

export interface PlannedCommitInput {
	message: string
	summary?: string
	refs?: string[]
	patch?: string
}

export interface PlannedCommit {
	message: string
	summary?: string
	refs?: string[]
	patch: string
}

export interface CommittedCommit {
	message: string
	hash: string
}

export interface SmartCommitToolDetails {
	status: 'committed' | 'cancelled' | 'error'
	requestId?: string
	mode?: TargetMode
	commits?: CommittedCommit[]
	error?: string
}

export interface SmartCommitAnalysisDetails {
	requestId: string
	mode: TargetMode
	repoRoot: string
	sectionCount: number
	sections: string[]
}

export interface GitRunOptions {
	cwd: string
	signal?: AbortSignal
	timeout?: number
	allowedCodes?: number[]
}
