export function sanitizeDisplayText(value: string): string {
	return stripControlChars(stripAnsiLike(value));
}

function stripAnsiLike(value: string): string {
	return value
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b[_P][\s\S]*?\x1b\\/g, "")
		.replace(/\x1b./g, "");
}

function stripControlChars(value: string): string {
	let result = "";
	for (const char of value) {
		const code = char.codePointAt(0) ?? 0;
		if (char === "\n" || char === "\t") {
			result += char;
			continue;
		}
		if ((code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) {
			continue;
		}
		result += char;
	}
	return result;
}
