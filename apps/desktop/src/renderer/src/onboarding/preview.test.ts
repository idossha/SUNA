import { describe, expect, it } from 'vitest'
import { projectTreeLines } from './preview'
import { createInitialWizardState } from './types'

describe('projectTreeLines', () => {
  // The flat manuscript directory (feature-plan-7 §1): every scaffold writes
  // the same four files, and the preview must say so — sections are headings
  // inside manuscript.md now, so no scaffold produces section FILES at all.
  it('lists the flat manuscript directory and no imported/ dir for the starter scaffold', () => {
    const lines = projectTreeLines(
      createInitialWizardState('create', { name: 'my-paper', scaffold: 'starter' })
    )
    expect(lines).toContain('my-paper/')
    expect(lines).toContain('    manuscript.json')
    expect(lines).toContain('    authors.json')
    expect(lines).toContain('    manuscript.md')
    expect(lines).toContain('    references.bib')
    expect(lines.some((l) => l.includes('imported/'))).toBe(false)
  })

  it('never lists a sections/ directory or a section file, whatever the scaffold', () => {
    for (const scaffold of ['starter', 'blank', 'document'] as const) {
      const lines = projectTreeLines(createInitialWizardState('create', { scaffold }))
      expect(lines.some((l) => l.includes('sections/'))).toBe(false)
      expect(lines.some((l) => /\d\d-[a-z]+\.md/.test(l))).toBe(false)
    }
  })

  it('lists the same flat manuscript files for a blank scaffold', () => {
    const lines = projectTreeLines(createInitialWizardState('create', { scaffold: 'blank' }))
    expect(lines).toContain('    manuscript.md')
    expect(lines).toContain('    authors.json')
  })

  it('always lists the agent layer: stubs, context/ files, and machine-local .mcp.json', () => {
    const lines = projectTreeLines(createInitialWizardState('create'))
    expect(lines).toContain('  AGENTS.md')
    expect(lines).toContain('  CLAUDE.md')
    expect(lines).toContain('  context/')
    expect(lines).toContain('    PROJECT.md')
    expect(lines).toContain('    MEMORY.md')
    expect(lines).toContain('    RULES.md')
    expect(lines.some((l) => l.startsWith('  .mcp.json'))).toBe(true)
  })

  it('mentions .venv only when creating one with uv', () => {
    const lines = projectTreeLines(createInitialWizardState('create', { pythonChoice: 'create-uv' }))
    expect(lines.some((l) => l.includes('.venv'))).toBe(true)
  })

  it('always lists every non-manuscript project directory', () => {
    const lines = projectTreeLines(createInitialWizardState('create'))
    for (const dir of ['figures', 'code', 'data', 'analysis', 'results', 'output']) {
      expect(lines).toContain(`  ${dir}/`)
    }
  })
})
