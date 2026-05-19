import process from 'node:process'
import { visibleWidth } from '@earendil-works/pi-tui'

const ESCAPE = '\u001B'
const TAB_PATTERN = /\t/g

function readAnsi(text, index) {
	if (text[index] !== ESCAPE || text[index + 1] !== '[')
		return undefined
	let cursor = index + 2
	while (cursor < text.length) {
		const code = text.charCodeAt(cursor)
		if (code >= 0x40 && code <= 0x7E)
			return text.slice(index, cursor + 1)
		cursor++
	}
	return undefined
}

function trimToWidth(text, width, ellipsis = '…') {
	const target = Math.max(0, width)
	if (target === 0)
		return ''
	const expanded = text.replace(TAB_PATTERN, '    ')
	if (visibleWidth(expanded) <= target)
		return expanded
	const suffix = ellipsis ? trimToWidth(ellipsis, Math.min(target, visibleWidth(ellipsis)), '') : ''
	const contentWidth = Math.max(0, target - visibleWidth(suffix))
	let output = ''
	let used = 0
	let sawAnsi = false
	for (let i = 0; i < expanded.length;) {
		const ansi = readAnsi(expanded, i)
		if (ansi) {
			sawAnsi = true
			output += ansi
			i += ansi.length
			continue
		}
		const cp = expanded.codePointAt(i)
		if (cp === undefined)
			break
		const char = String.fromCodePoint(cp)
		const charWidth = visibleWidth(char)
		if (used + charWidth > contentWidth)
			break
		output += char
		used += charWidth
		i += char.length
	}
	return `${output}${suffix}${sawAnsi ? `${ESCAPE}[0m` : ''}`
}

function fitToWidth(text, width) {
	const trimmed = trimToWidth(text, width)
	return trimmed + ' '.repeat(Math.max(0, width - visibleWidth(trimmed)))
}

function renderBox(title, width, lines, height) {
	const safeWidth = Math.max(4, width)
	const interiorWidth = Math.max(2, safeWidth - 2)
	const contentWidth = Math.max(1, interiorWidth - 2)
	const contentHeight = Math.max(0, height - 2)
	const titleText = trimToWidth(title ? ` ${title} ` : '', interiorWidth)
	const topFill = '─'.repeat(Math.max(0, interiorWidth - visibleWidth(titleText)))
	const row = content => `│${fitToWidth(` ${fitToWidth(content, contentWidth)} `, interiorWidth)}│`
	const box = [`┌${titleText}${topFill}┐`]
	for (const line of lines.slice(0, contentHeight)) box.push(row(line))
	while (box.length < height - 1) box.push(row(''))
	box.push(`└${'─'.repeat(interiorWidth)}┘`)
	return box.map(line => fitToWidth(line, safeWidth))
}

const cases = [
	{ width: 24, title: 'Question', lines: ['hello world'] },
	{ width: 24, title: '題目', lines: ['中文測試 mixed text'] },
	{ width: 30, title: 'Thinking levels', lines: ['● 模型 gpt-5.4', '> ○ long 中文 label'] },
	{ width: 64, title: 'Models', lines: ['  ○ (lmstudio) NVIDIA NeMo-TRON 3 Nano Omni [200K] [30B] very long model name'] },
	{ width: 18, title: '很長很長的標題 mixed title', lines: ['這是一段會被省略的中文 English 文字'] },
	{ width: 16, title: 'Emoji', lines: ['😀😀😀 abcdefghijklmnopqrstuvwxyz'] },
	{ width: 14, title: 'ANSI', lines: ['\u001B[31m紅色中文 long long\u001B[39m'] },
]

for (const item of cases) {
	const lines = renderBox(item.title, item.width, item.lines, 5)
	for (const line of lines) {
		const width = visibleWidth(line)
		if (width !== item.width) {
			console.error(`width mismatch: expected ${item.width}, got ${width}: ${JSON.stringify(line)}`)
			process.exit(1)
		}
	}
}

for (const sample of ['中文 English 混排 very long', '😀😀😀 long text', '\u001B[32mANSI 中文 long\u001B[39m']) {
	for (let width = 1; width <= 20; width++) {
		const trimmed = trimToWidth(sample, width)
		if (visibleWidth(trimmed) > width) {
			console.error(`trim overflow: expected <= ${width}, got ${visibleWidth(trimmed)}: ${JSON.stringify(trimmed)}`)
			process.exit(1)
		}
	}
}

console.log('modal layout width checks passed')
