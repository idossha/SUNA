import { DEFAULT_PROJECT_DIRS } from '@suna/core'
import type { WizardState } from './types'

/**
 * Step 7 (Review)'s directory-tree preview — a flat indented listing, not a
 * fully box-drawn tree, so it stays trivial to keep in exact sync with what
 * scaffoldProject (main process) actually writes. Pure: no fs, no IPC.
 */
export function projectTreeLines(state: WizardState): string[] {
  const lines: string[] = [`${state.name || 'project'}/`]
  lines.push('  suna.json')
  lines.push('  .gitignore')
  // The agent layer (adr-004) — written unconditionally by every scaffold.
  lines.push('  AGENTS.md')
  lines.push('  CLAUDE.md')
  lines.push('  context/')
  lines.push('    MISSION.md')
  lines.push('    NOTEBOOK.md')
  lines.push('    RULES.md')
  // Flat manuscript directory (feature-plan-7 §1) — one prose file, sections
  // are its Markdown headings, and the byline lives in authors.json. Mirrors
  // writeManuscriptDir's write order in main/services/project.ts.
  lines.push('  manuscript/')
  lines.push('    manuscript.json')
  lines.push('    authors.json')
  lines.push('    manuscript.md')

  const importedBib =
    state.scaffold === 'import' && state.importFiles.some((f) => f.ext === 'bib')
  if (!importedBib) lines.push('    references.bib')

  if (state.scaffold === 'import' && state.importFiles.length > 0) {
    lines.push('    imported/')
    for (const file of state.importFiles) lines.push(`      ${file.name}`)
  }

  for (const dir of Object.values(DEFAULT_PROJECT_DIRS)) {
    if (dir === DEFAULT_PROJECT_DIRS.manuscript) continue
    lines.push(`  ${dir}/`)
  }
  lines.push('  .mcp.json  (machine-local, not committed)')
  if (state.pythonChoice === 'create-uv') lines.push('  .venv/  (created by uv)')

  return lines
}
