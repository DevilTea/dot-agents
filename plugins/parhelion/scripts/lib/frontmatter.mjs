export function splitFrontmatter(markdown, filePath) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Missing frontmatter: ${filePath}`);
  }

  return {
    frontmatter: match[1],
    body: match[2],
  };
}

export function parseFrontmatter(frontmatter) {
  const values = new Map();

  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) {
      values.set(match[1], match[2]);
    }
  }

  return values;
}

export function formatFrontmatterValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);
  if (stringValue === '') {
    return '';
  }

  if (/^[A-Za-z0-9._/@:-]+$/.test(stringValue)) {
    return stringValue;
  }

  return JSON.stringify(stringValue);
}

export function updateFrontmatter(markdown, filePath, updates) {
  const { frontmatter, body } = splitFrontmatter(markdown, filePath);
  const pendingUpdates = new Map(Object.entries(updates));
  const nextLines = frontmatter.split('\n').map((line) => {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match || !pendingUpdates.has(match[1])) {
      return line;
    }

    const nextValue = pendingUpdates.get(match[1]);
    pendingUpdates.delete(match[1]);
    return `${match[1]}: ${formatFrontmatterValue(nextValue)}`;
  });

  for (const [key, value] of pendingUpdates) {
    nextLines.push(`${key}: ${formatFrontmatterValue(value)}`);
  }

  return `---\n${nextLines.join('\n')}\n---\n${body}`;
}