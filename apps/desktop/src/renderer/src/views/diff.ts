export type DiffLineKind = 'add' | 'del' | 'hunk' | 'meta' | 'ctx'

/** Classify one unified-diff line for display coloring. */
export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith('@@')) return 'hunk'
  if (
    line.startsWith('diff ') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('new file') ||
    line.startsWith('deleted file') ||
    line.startsWith('rename ') ||
    line.startsWith('similarity ') ||
    line.startsWith('old mode') ||
    line.startsWith('new mode') ||
    line.startsWith('\\ No newline')
  ) {
    return 'meta'
  }
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'ctx'
}

export const STATUS_LETTERS: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflicted: 'C'
}

/** Show repo-relative paths even if the main process returns absolute ones. */
export function relativeToRoot(path: string, rootDir: string): string {
  const prefix = rootDir.endsWith('/') ? rootDir : `${rootDir}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}
