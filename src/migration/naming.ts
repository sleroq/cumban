export function sanitizeNoteTitle(title: string): string {
  const sanitized = title
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (sanitized.length === 0) {
    return "Untitled";
  }

  return sanitized;
}

export function buildUniqueMarkdownPath(
  folderPath: string,
  title: string,
  fileExists: (path: string) => boolean,
): string {
  const normalizedFolder = folderPath.replace(/\/$/, "");
  const baseTitle = sanitizeNoteTitle(title);
  const rootPath = normalizedFolder.length === 0 ? "" : `${normalizedFolder}/`;
  const firstCandidate = `${rootPath}${baseTitle}.md`;
  if (!fileExists(firstCandidate)) {
    return firstCandidate;
  }

  let index = 1;
  while (index < 10_000) {
    const candidate = `${rootPath}${baseTitle} (${index}).md`;
    if (!fileExists(candidate)) {
      return candidate;
    }
    index += 1;
  }

  return `${rootPath}${baseTitle}-${Date.now()}.md`;
}
