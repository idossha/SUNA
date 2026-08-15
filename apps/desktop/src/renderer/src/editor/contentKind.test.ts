import { describe, expect, it } from 'vitest'
import { CONTENT_KIND_CLASS, contentKindFor } from './contentKind'
import { editorSurfaceStyle, EDITOR_SETTINGS_DEFAULTS } from './settings'

describe('contentKindFor', () => {
  it('classifies markdown as prose', () => {
    expect(contentKindFor('paper.md')).toBe('prose')
    expect(contentKindFor('notes.markdown')).toBe('prose')
  })

  it('is case-insensitive on the extension', () => {
    expect(contentKindFor('README.MD')).toBe('prose')
    expect(contentKindFor('Notes.Markdown')).toBe('prose')
  })

  it('classifies code and data files as code', () => {
    expect(contentKindFor('script.py')).toBe('code')
    expect(contentKindFor('manuscript.json')).toBe('code')
    expect(contentKindFor('refs.bib')).toBe('code')
    expect(contentKindFor('table.csv')).toBe('code')
    expect(contentKindFor('Component.tsx')).toBe('code')
  })

  it('classifies extensionless files as code', () => {
    expect(contentKindFor('Makefile')).toBe('code')
    expect(contentKindFor('LICENSE')).toBe('code')
  })

  it('resolves a full path down to the file name', () => {
    expect(contentKindFor('project/notes/draft.md')).toBe('prose')
    expect(contentKindFor('project/src/main.py')).toBe('code')
  })
})

describe('CONTENT_KIND_CLASS', () => {
  it('maps each kind to its stable modifier class', () => {
    expect(CONTENT_KIND_CLASS.prose).toBe('editor-tab--prose')
    expect(CONTENT_KIND_CLASS.code).toBe('editor-tab--code')
  })
})

describe('settings -> style mapping stays content-kind agnostic', () => {
  // The --ed-* vars are published the same way for every tab regardless of
  // content kind; editor.css is what scopes max-width/centering to
  // `.editor-tab--prose`. This pins that the mapping itself still produces
  // the expected vars after the content-kind split (work item 1).
  it('still produces the expected CSS vars whether the file is prose or code', () => {
    const style = editorSurfaceStyle({
      ...EDITOR_SETTINGS_DEFAULTS,
      contentWidthCh: 80
    }) as Record<string, string>

    expect(contentKindFor('paper.md')).toBe('prose')
    expect(contentKindFor('script.py')).toBe('code')
    // same style object either way — the var exists on every tab; CSS
    // scoping (not the settings->style mapping) decides who consumes it.
    expect(style['--ed-content-width']).toBe('80ch')
    // feature-plan-5 §2 defaults: 14px / 1.6 line-height.
    expect(style['--ed-font-size']).toBe('14px')
    expect(style['--ed-line-height']).toBe('1.6')
  })
})
