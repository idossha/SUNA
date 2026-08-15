import { describe, expect, it } from 'vitest'
import { projectTreeLines } from './preview'
import { createInitialWizardState } from './types'

describe('projectTreeLines', () => {
  it('lists the starter scaffold with its two extra sections and no imported/ dir', () => {
    const lines = projectTreeLines(
      createInitialWizardState('create', { name: 'my-paper', scaffold: 'starter' })
    )
    expect(lines).toContain('my-paper/')
    expect(lines).toContain('      02-results.md')
    expect(lines).toContain('      03-methods.md')
    expect(lines.some((l) => l.includes('imported/'))).toBe(false)
    expect(lines).toContain('    references.bib')
  })

  it('lists only the intro section for a blank scaffold', () => {
    const lines = projectTreeLines(createInitialWizardState('create', { scaffold: 'blank' }))
    expect(lines).toContain('      01-introduction.md')
    expect(lines.some((l) => l.includes('02-results'))).toBe(false)
  })

  it('lists imported files under manuscript/imported/ and skips references.bib when a .bib was imported', () => {
    const state = createInitialWizardState('create', {
      scaffold: 'import',
      importDir: '/old-paper',
      importFiles: [
        { path: '/old-paper/draft.md', name: 'draft.md', ext: 'md' },
        { path: '/old-paper/refs.bib', name: 'refs.bib', ext: 'bib' }
      ]
    })
    const lines = projectTreeLines(state)
    expect(lines).toContain('    imported/')
    expect(lines).toContain('      draft.md')
    expect(lines).toContain('      refs.bib')
    expect(lines.some((l) => l.trim() === 'references.bib')).toBe(false)
  })

  it('adds references.bib for an import with no .bib file among the imports', () => {
    const state = createInitialWizardState('create', {
      scaffold: 'import',
      importDir: '/old-paper',
      importFiles: [{ path: '/old-paper/draft.md', name: 'draft.md', ext: 'md' }]
    })
    expect(projectTreeLines(state)).toContain('    references.bib')
  })

  it('adds .mcp.json only when writeMcpConfig is on', () => {
    expect(
      projectTreeLines(createInitialWizardState('create', { writeMcpConfig: true }))
    ).toContain('  .mcp.json')
    expect(
      projectTreeLines(createInitialWizardState('create', { writeMcpConfig: false }))
    ).not.toContain('  .mcp.json')
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
