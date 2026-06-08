import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { KeyId } from '@earendil-works/pi-tui'

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyToClipboard } from '@earendil-works/pi-coding-agent'
import {
	CURSOR_MARKER,
	Editor,
	matchesKey,
	visibleWidth,
} from '@earendil-works/pi-tui'

interface Position {
	line: number
	col: number
}

type SelectionAction
	= | 'selectAll'
		| 'copySelection'
		| 'cancelSelection'
		| 'deleteSelection'
		| 'selectLeft'
		| 'selectRight'
		| 'selectUp'
		| 'selectDown'
		| 'selectWordLeft'
		| 'selectWordRight'
		| 'selectLineStart'
		| 'selectLineEnd'

interface ResolvedSelectionEditorConfig {
	modifier: 'cmd' | 'super' | 'ctrl'
	visualSelection: boolean
	bindings: Record<SelectionAction, string | string[]>
}

interface SelectionState {
	anchor: Position | null
	focus: Position | null
	config: ResolvedSelectionEditorConfig
}

interface VisualLine {
	logicalLine: number
	startCol: number
	length: number
}

interface EditorInternals {
	state: { lines: string[], cursorLine: number, cursorCol: number }
	paddingX?: number
	lastWidth?: number
	scrollOffset?: number
	autocompleteState?: unknown
	buildVisualLineMap?: (width: number) => VisualLine[]
	setCursorCol: (col: number) => void
}

interface EditorPatch {
	handleInput: Editor['handleInput']
	render: Editor['render']
	setText: Editor['setText']
	insertTextAtCursor: Editor['insertTextAtCursor']
}

const DEFAULT_CONFIG: ResolvedSelectionEditorConfig = {
	modifier: 'cmd',
	visualSelection: true,
	bindings: {
		selectAll: ['ctrl+shift+a'],
		copySelection: ['ctrl+shift+c'],
		cancelSelection: [],
		deleteSelection: ['backspace', 'delete'],
		selectLeft: ['shift+left'],
		selectRight: ['shift+right'],
		selectUp: ['shift+up'],
		selectDown: ['shift+down'],
		selectWordLeft: ['shift+alt+left'],
		selectWordRight: ['shift+alt+right'],
		selectLineStart: ['shift+{mod}+left', 'shift+home'],
		selectLineEnd: ['shift+{mod}+right', 'shift+end'],
	},
}

const FEATURE_DIR = dirname(fileURLToPath(import.meta.url))
const AGENT_DIR = join(FEATURE_DIR, '..', '..', '..', '..')
const CONFIG_PATHS = [
	join(FEATURE_DIR, 'config.json'),
	join(AGENT_DIR, 'editor-selection-helper.json'),
	join(AGENT_DIR, 'selection-editor.json'),
]
const PATCH_SYMBOL = Symbol.for('deviltea.editor-selection-helper.patch')
const STATE = new WeakMap<Editor, SelectionState>()

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJson(path: string): unknown {
	if (!existsSync(path))
		return undefined
	return JSON.parse(readFileSync(path, 'utf8'))
}

function resolveModifier(value: unknown): ResolvedSelectionEditorConfig['modifier'] {
	if (value === 'ctrl' || value === 'super')
		return value
	return 'cmd'
}

function resolveVisualSelection(value: unknown): boolean {
	return value !== false && value !== 'off'
}

function readConfig(): ResolvedSelectionEditorConfig {
	const settings = readJson(join(AGENT_DIR, 'settings.json'))
	const settingsConfig = isRecord(settings) && isRecord(settings.editorSelectionHelper)
		? settings.editorSelectionHelper
		: isRecord(settings) && isRecord(settings.selectionEditor)
			? settings.selectionEditor
			: undefined

	const fileConfig = CONFIG_PATHS.map(readJson)
		.find(isRecord)
	const raw = { ...DEFAULT_CONFIG, ...(settingsConfig ?? {}), ...(fileConfig ?? {}) }
	const bindings = { ...DEFAULT_CONFIG.bindings, ...(isRecord(raw.bindings) ? raw.bindings : {}) }

	return {
		modifier: resolveModifier(raw.modifier),
		visualSelection: resolveVisualSelection(raw.visualSelection),
		bindings,
	}
}

function getState(editor: Editor): SelectionState {
	let state = STATE.get(editor)
	if (!state) {
		state = { anchor: null, focus: null, config: readConfig() }
		STATE.set(editor, state)
	}
	return state
}

function toArray(value: string | string[] | undefined): string[] {
	if (Array.isArray(value))
		return value
	return value ? [value] : []
}

function normalizeKeyId(key: string, modifier: 'cmd' | 'super' | 'ctrl'): KeyId {
	const mod = modifier === 'ctrl' ? 'ctrl' : 'super'
	return key.replaceAll('cmd', 'super')
		.replaceAll('{mod}', mod) as KeyId
}

function matchesAny(data: string, keys: string[], modifier: 'cmd' | 'super' | 'ctrl'): boolean {
	return keys.some(key => matchesKey(data, normalizeKeyId(key, modifier)))
}

function matchAction(editor: Editor, data: string): SelectionAction | null {
	const config = getState(editor).config
	for (const action of Object.keys(config.bindings) as SelectionAction[]) {
		if (matchesAny(data, toArray(config.bindings[action]), config.modifier))
			return action
	}
	return null
}

function comparePositions(a: Position, b: Position): number {
	if (a.line !== b.line)
		return a.line - b.line
	return a.col - b.col
}

function clonePosition(position: Position): Position {
	return { line: position.line, col: position.col }
}

function minPosition(a: Position, b: Position): Position {
	return comparePositions(a, b) <= 0 ? clonePosition(a) : clonePosition(b)
}

function maxPosition(a: Position, b: Position): Position {
	return comparePositions(a, b) >= 0 ? clonePosition(a) : clonePosition(b)
}

function lineLength(lines: string[], line: number): number {
	return lines[line]?.length ?? 0
}

function positionToOffset(lines: string[], position: Position): number {
	let offset = 0
	for (let i = 0; i < position.line; i++) offset += (lines[i]?.length ?? 0) + 1
	return offset + position.col
}

function internals(editor: Editor): EditorInternals {
	return editor as unknown as EditorInternals
}

function clearSelection(editor: Editor): void {
	const state = getState(editor)
	state.anchor = null
	state.focus = null
}

function hasSelection(editor: Editor): boolean {
	const state = getState(editor)
	return state.anchor !== null && state.focus !== null && comparePositions(state.anchor, state.focus) !== 0
}

function selectionRange(editor: Editor): { start: Position, end: Position } | null {
	const state = getState(editor)
	if (!hasSelection(editor) || !state.anchor || !state.focus)
		return null
	return {
		start: minPosition(state.anchor, state.focus),
		end: maxPosition(state.anchor, state.focus),
	}
}

function selectAll(editor: Editor): void {
	const lines = editor.getLines()
	const state = getState(editor)
	state.anchor = { line: 0, col: 0 }
	state.focus = { line: lines.length - 1, col: lineLength(lines, lines.length - 1) }
	internals(editor).state.cursorLine = state.focus.line
	internals(editor)
		.setCursorCol(state.focus.col)
}

function extendSelection(editor: Editor, move: () => void): void {
	const state = getState(editor)
	if (!state.anchor)
		state.anchor = editor.getCursor()
	move()
	state.focus = editor.getCursor()
	if (!hasSelection(editor))
		clearSelection(editor)
}

function getSelectedText(editor: Editor): string | null {
	const range = selectionRange(editor)
	if (!range)
		return null
	const lines = editor.getLines()
	const text = editor.getText()
	const startOffset = positionToOffset(lines, range.start)
	const endOffset = positionToOffset(lines, range.end)
	return text.slice(startOffset, endOffset)
}

function copySelection(editor: Editor): void {
	const selectedText = getSelectedText(editor)
	if (!selectedText)
		return
	void copyToClipboard(selectedText)
}

function deleteSelection(editor: Editor, originalSetText: Editor['setText']): void {
	const range = selectionRange(editor)
	if (!range)
		return
	const lines = editor.getLines()
	const text = editor.getText()
	const startOffset = positionToOffset(lines, range.start)
	const endOffset = positionToOffset(lines, range.end)
	const nextText = text.slice(0, startOffset) + text.slice(endOffset)
	clearSelection(editor)
	originalSetText.call(editor, nextText)
	internals(editor).state.cursorLine = range.start.line
	internals(editor)
		.setCursorCol(range.start.col)
}

function shouldReplaceSelection(data: string): boolean {
	return data.includes('\x1B[200~') || data === '\n' || data === '\r' || data.charCodeAt(0) >= 32
}

function isSelectionExtendKey(editor: Editor, data: string): boolean {
	const config = getState(editor).config
	return [
		'selectLeft',
		'selectRight',
		'selectUp',
		'selectDown',
		'selectWordLeft',
		'selectWordRight',
		'selectLineStart',
		'selectLineEnd',
	].some(action => matchesAny(data, toArray(config.bindings[action as SelectionAction]), config.modifier))
}

function handleSelectionAction(editor: Editor, action: SelectionAction, data: string, original: EditorPatch): void {
	switch (action) {
		case 'selectAll':
			selectAll(editor)
			return
		case 'copySelection':
			copySelection(editor)
			return
		case 'cancelSelection':
			if (hasSelection(editor)) {
				clearSelection(editor)
				return
			}
			original.handleInput.call(editor, '\x1B')
			return
		case 'deleteSelection':
			if (hasSelection(editor))
				deleteSelection(editor, original.setText)
			else original.handleInput.call(editor, data)
			return
		case 'selectLeft':
			extendSelection(editor, () => original.handleInput.call(editor, '\x1B[D'))
			return
		case 'selectRight':
			extendSelection(editor, () => original.handleInput.call(editor, '\x1B[C'))
			return
		case 'selectUp':
			extendSelection(editor, () => original.handleInput.call(editor, '\x1B[A'))
			return
		case 'selectDown':
			extendSelection(editor, () => original.handleInput.call(editor, '\x1B[B'))
			return
		case 'selectWordLeft':
			extendSelection(editor, () => original.handleInput.call(editor, '\x1B[1;3D'))
			return
		case 'selectWordRight':
			extendSelection(editor, () => original.handleInput.call(editor, '\x1B[1;3C'))
			return
		case 'selectLineStart':
			extendSelection(editor, () => original.handleInput.call(editor, '\x01'))
			return
		case 'selectLineEnd':
			extendSelection(editor, () => original.handleInput.call(editor, '\x05'))
	}
}

const ESC = '\x1B'
const BEL = '\x07'
const SELECTION_START = `${ESC}[7m`
const SELECTION_END = `${ESC}[27m`
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function isCsiFinalByte(char: string | undefined): boolean {
	const code = char?.codePointAt(0) ?? 0
	return code >= 0x40 && code <= 0x7E
}

function readStringEscapeSequence(text: string, index: number): string {
	let cursor = index + 2
	while (cursor < text.length) {
		if (text[cursor] === BEL)
			return text.slice(index, cursor + 1)
		if (text[cursor] === ESC && text[cursor + 1] === '\\')
			return text.slice(index, cursor + 2)
		cursor++
	}
	return text.slice(index)
}

function readAnsiSequence(text: string, index: number): string | null {
	if (text[index] !== ESC)
		return null
	if (text.startsWith(CURSOR_MARKER, index))
		return CURSOR_MARKER

	const introducer = text[index + 1]
	if (introducer === '[') {
		let cursor = index + 2
		while (cursor < text.length) {
			if (isCsiFinalByte(text[cursor]))
				return text.slice(index, cursor + 1)
			cursor++
		}
		return text.slice(index)
	}
	if (introducer === ']' || introducer === '_' || introducer === 'P' || introducer === '^')
		return readStringEscapeSequence(text, index)
	return text.slice(index, Math.min(index + 2, text.length))
}

function nextGrapheme(text: string, index: number): string {
	const segments = GRAPHEME_SEGMENTER.segment(text.slice(index))
	const iterator = segments[Symbol.iterator]()
	const segment = iterator.next()
	return segment.done ? text[index] ?? '' : segment.value.segment
}

function decorateColumns(line: string, startCol: number, endCol: number): string {
	if (startCol >= endCol)
		return line

	let result = ''
	let column = 0
	let index = 0
	while (index < line.length) {
		const ansi = readAnsiSequence(line, index)
		if (ansi) {
			result += ansi
			index += ansi.length
			continue
		}

		const grapheme = nextGrapheme(line, index)
		const width = visibleWidth(grapheme)
		const selected = width > 0 && column < endCol && column + width > startCol
		result += selected ? `${SELECTION_START}${grapheme}${SELECTION_END}` : grapheme
		column += width
		index += grapheme.length
	}
	return result
}

function countCursorMarkers(lines: string[]): number {
	return lines.reduce((count, line) => count + line.split(CURSOR_MARKER).length - 1, 0)
}

function renderInvariantHolds(base: string[], decorated: string[], width: number): boolean {
	if (decorated.length !== base.length)
		return false
	if (countCursorMarkers(decorated) !== countCursorMarkers(base))
		return false
	for (let index = 0; index < decorated.length; index++) {
		const line = decorated[index] ?? ''
		const baseLine = base[index] ?? ''
		if (line.includes('\n') || line.includes('\r'))
			return false
		if (visibleWidth(line) !== visibleWidth(baseLine))
			return false
		if (visibleWidth(line) > width)
			return false
	}
	return true
}

function visibleSelectionColumns(lines: string[], range: { start: Position, end: Position }, visualLine: VisualLine): { start: number, end: number } | null {
	const logicalLine = visualLine.logicalLine
	if (range.start.line > logicalLine || range.end.line < logicalLine)
		return null

	const line = lines[logicalLine] ?? ''
	const visualStart = Math.max(0, Math.min(visualLine.startCol, line.length))
	const visualEnd = Math.max(visualStart, Math.min(visualLine.startCol + visualLine.length, line.length))
	const selectedStart = range.start.line < logicalLine ? visualStart : Math.max(visualStart, Math.min(range.start.col, visualEnd))
	const selectedEnd = range.end.line > logicalLine ? visualEnd : Math.min(visualEnd, Math.max(range.end.col, visualStart))
	if (selectedStart >= selectedEnd)
		return null

	return {
		start: visibleWidth(line.slice(visualStart, selectedStart)),
		end: visibleWidth(line.slice(visualStart, selectedEnd)),
	}
}

function visibleVisualLines(editor: Editor, rendered: string[]): VisualLine[] | null {
	const internal = internals(editor)
	if (typeof internal.buildVisualLineMap !== 'function' || typeof internal.lastWidth !== 'number')
		return null
	const bodyLineCount = Math.max(0, rendered.length - 2)
	if (bodyLineCount <= 0)
		return null
	const scrollOffset = typeof internal.scrollOffset === 'number' ? Math.max(0, internal.scrollOffset) : 0
	const visualLines = internal.buildVisualLineMap(Math.max(1, internal.lastWidth))
	const visible = visualLines.slice(scrollOffset, scrollOffset + bodyLineCount)
	return visible.length === bodyLineCount ? visible : null
}

function renderWithVisualSelection(editor: Editor, width: number, original: EditorPatch): string[] {
	const rendered = original.render.call(editor, width)
	const state = getState(editor)
	if (!state.config.visualSelection || !hasSelection(editor) || internals(editor).autocompleteState)
		return rendered

	const range = selectionRange(editor)
	const visualLines = visibleVisualLines(editor, rendered)
	if (!range || !visualLines)
		return rendered

	const internal = internals(editor)
	const maxPadding = Math.max(0, Math.floor((width - 1) / 2))
	const paddingX = Math.min(typeof internal.paddingX === 'number' ? internal.paddingX : 0, maxPadding)
	const textLines = editor.getLines()
	const decorated = [...rendered]
	for (let index = 0; index < visualLines.length; index++) {
		const columns = visibleSelectionColumns(textLines, range, visualLines[index]!)
		if (!columns)
			continue
		const lineIndex = index + 1
		decorated[lineIndex] = decorateColumns(rendered[lineIndex] ?? '', paddingX + columns.start, paddingX + columns.end)
	}

	return renderInvariantHolds(rendered, decorated, width) ? decorated : rendered
}

function patchEditor(): boolean {
	const prototype = Editor.prototype as Editor & { [PATCH_SYMBOL]?: EditorPatch }
	if (prototype[PATCH_SYMBOL])
		return false

	const original: EditorPatch = {
		handleInput: Editor.prototype.handleInput,
		render: Editor.prototype.render,
		setText: Editor.prototype.setText,
		insertTextAtCursor: Editor.prototype.insertTextAtCursor,
	}
	prototype[PATCH_SYMBOL] = original

	Editor.prototype.handleInput = function patchedHandleInput(this: Editor, data: string): void {
		const action = matchAction(this, data)
		if (action) {
			handleSelectionAction(this, action, data, original)
			;(this as unknown as { tui: { requestRender: () => void } }).tui.requestRender()
			return
		}

		if (hasSelection(this) && shouldReplaceSelection(data))
			deleteSelection(this, original.setText)

		original.handleInput.call(this, data)

		if (!isSelectionExtendKey(this, data))
			clearSelection(this)
	}

	Editor.prototype.render = function patchedRender(this: Editor, width: number): string[] {
		return renderWithVisualSelection(this, width, original)
	}

	Editor.prototype.setText = function patchedSetText(this: Editor, text: string): void {
		clearSelection(this)
		original.setText.call(this, text)
	}

	Editor.prototype.insertTextAtCursor = function patchedInsertTextAtCursor(this: Editor, text: string): void {
		if (hasSelection(this))
			deleteSelection(this, original.setText)
		original.insertTextAtCursor.call(this, text)
	}

	return true
}

function restoreEditorPatch(): void {
	const prototype = Editor.prototype as Editor & { [PATCH_SYMBOL]?: EditorPatch }
	const original = prototype[PATCH_SYMBOL]
	if (!original)
		return
	Editor.prototype.handleInput = original.handleInput
	Editor.prototype.render = original.render
	Editor.prototype.setText = original.setText
	Editor.prototype.insertTextAtCursor = original.insertTextAtCursor
	delete prototype[PATCH_SYMBOL]
}

export default function editorSelectionHelper(pi: ExtensionAPI): void {
	const patched = patchEditor()

	// pi.on('session_start', (_event, ctx) => {
	// 	ctx.ui.setStatus('editor-selection-helper', patched ? 'native editor patched' : 'native editor patch active')
	// })

	// pi.on('session_shutdown', (_event, ctx) => {
	// 	restoreEditorPatch()
	// 	ctx.ui.setStatus('editor-selection-helper', undefined)
	// })
}
