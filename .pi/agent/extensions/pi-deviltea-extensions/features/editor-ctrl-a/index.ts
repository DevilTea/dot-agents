import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Editor, Key, matchesKey } from '@earendil-works/pi-tui'

type EditorWithTui = Editor & {
	tui?: { requestRender: () => void }
}

const selectionState = new WeakMap<Editor, boolean>()
let patched = false

export default function editorCtrlA(_pi: ExtensionAPI) {
	patchNativeEditorCtrlA()
}

function patchNativeEditorCtrlA(): void {
	if (patched)
		return

	patched = true

	const originalHandleInput = Editor.prototype.handleInput
	const originalRender = Editor.prototype.render
	const originalSetText = Editor.prototype.setText

	Editor.prototype.handleInput = function patchedHandleInput(this: EditorWithTui, data: string): void {
		if (isSelectAllShortcut(data)) {
			selectionState.set(this, this.getText().length > 0)
			this.tui?.requestRender()
			return
		}

		if (selectionState.get(this)) {
			if (matchesKey(data, Key.escape)) {
				selectionState.set(this, false)
				this.tui?.requestRender()
				return
			}

			selectionState.set(this, false)

			if (isReplacementInput(data)) {
				originalSetText.call(this, '')

				if (isDeletionInput(data)) {
					this.tui?.requestRender()
					return
				}
			}
			else {
				this.tui?.requestRender()
			}
		}

		originalHandleInput.call(this, data)
	}

	Editor.prototype.render = function patchedRender(this: Editor, width: number): string[] {
		const lines = originalRender.call(this, width)
		if (!selectionState.get(this) || lines.length <= 2)
			return lines

		for (let index = 1; index < lines.length - 1; index++)
			lines[index] = highlightSelectedLine(lines[index]!)

		return lines
	}

	Editor.prototype.setText = function patchedSetText(this: Editor, text: string): void {
		selectionState.set(this, false)
		originalSetText.call(this, text)
	}
}

function highlightSelectedLine(line: string): string {
	const selectedBg = '\x1B[48;5;238m'
	const reset = '\x1B[0m'
	return `${selectedBg}${line.replaceAll(reset, reset + selectedBg)}${reset}`
}

function isSelectAllShortcut(data: string): boolean {
	return matchesKey(data, Key.ctrl('a'))
}

function isDeletionInput(data: string): boolean {
	return matchesKey(data, Key.backspace) || matchesKey(data, Key.delete) || matchesKey(data, Key.ctrl('h'))
}

function isReplacementInput(data: string): boolean {
	if (isDeletionInput(data))
		return true
	if (data.includes('\x1B[200~'))
		return true
	if (matchesKey(data, Key.enter) || matchesKey(data, Key.space) || matchesKey(data, Key.tab))
		return true
	if (data.length === 1 && data.charCodeAt(0) >= 32)
		return true
	return false
}
