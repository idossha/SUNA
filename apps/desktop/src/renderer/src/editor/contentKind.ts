/**
 * Content-kind classification for editor tabs. Drives layout (width/wrap/
 * alignment/font) so prose and code stop sharing rules that only make sense
 * for one of them — see ARCHITECTURE §17.3 rule 3.
 */
export type ContentKind = 'prose' | 'code'

/**
 * 'prose' for Markdown only (`.md`/`.markdown`); everything else — code,
 * data, config, extensionless files — is 'code'. Extension match mirrors
 * `languageExtensions()` in codemirror.ts so the two stay in lockstep.
 */
export function contentKindFor(fileName: string): ContentKind {
  const lower = fileName.toLowerCase()
  const dot = lower.lastIndexOf('.')
  const ext = dot >= 0 ? lower.slice(dot) : ''
  return ext === '.md' || ext === '.markdown' ? 'prose' : 'code'
}

/** Stable class names the layout CSS and e2e drivers key off of. */
export const CONTENT_KIND_CLASS: Record<ContentKind, string> = {
  prose: 'editor-tab--prose',
  code: 'editor-tab--code'
}
