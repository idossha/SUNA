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
  lines.push('  manuscript/')
  lines.push('    manuscript.json')

  const importedBib =
    state.scaffold === 'import' && state.importFiles.some((f) => f.ext === 'bib')
  if (!importedBib) lines.push('    references.bib')

  lines.push('    sections/')
  lines.push('      01-introduction.md')
  if (state.scaffold === 'starter') {
    lines.push('      02-results.md')
    lines.push('      03-methods.md')
  }
  if (state.scaffold === 'import' && state.importFiles.length > 0) {
    lines.push('    imported/')
    for (const file of state.importFiles) lines.push(`      ${file.name}`)
  }

  for (const dir of Object.values(DEFAULT_PROJECT_DIRS)) {
    if (dir === DEFAULT_PROJECT_DIRS.manuscript) continue
    lines.push(`  ${dir}/`)
  }
  if (state.writeMcpConfig) lines.push('  .mcp.json')
  if (state.pythonChoice === 'create-uv') lines.push('  .venv/  (created by uv)')

  return lines
}
