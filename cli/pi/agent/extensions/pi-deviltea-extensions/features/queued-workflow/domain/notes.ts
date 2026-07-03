const DEFAULT_MAX_COUNT = 100
const DEFAULT_MAX_PROMPT_CHARS = 4000
const WHITESPACE_RUN_PATTERN = /\s+/g

/**
 * Append worker-proposed notes, capped to the newest maxCount. Dedup is normalized (case and
 * whitespace insensitive); semantic near-duplicates are the worker's job — the prompt tells it
 * not to re-propose facts already in the shared notes.
 */
export function addNotes(notes: string[], proposals: string[] | undefined, maxCount = DEFAULT_MAX_COUNT): string[] {
	if (!proposals?.length)
		return notes
	const next = [...notes]
	const seen = new Set(next.map(dedupeKey))
	for (const proposal of proposals) {
		const trimmed = proposal.trim()
		const key = dedupeKey(trimmed)
		if (trimmed && !seen.has(key)) {
			next.push(trimmed)
			seen.add(key)
		}
	}
	return next.length > maxCount ? next.slice(next.length - maxCount) : next
}

function dedupeKey(note: string): string {
	return note.replaceAll(WHITESPACE_RUN_PATTERN, ' ')
		.trim()
		.toLowerCase()
}

/** The newest notes that fit the character budget, returned in chronological order. */
export function notesForPrompt(notes: string[], maxChars = DEFAULT_MAX_PROMPT_CHARS): string[] {
	const selected: string[] = []
	let used = 0
	for (let index = notes.length - 1; index >= 0; index--) {
		const note = notes[index]!
		if (used + note.length > maxChars)
			break
		selected.unshift(note)
		used += note.length
	}
	return selected
}
