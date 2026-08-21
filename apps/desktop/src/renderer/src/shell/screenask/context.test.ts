import { describe, expect, it } from 'vitest'
import { contextMarkdown, describeActivePanel, relativeToRoot, type ScreenContextInput } from './context'

const BASE: ScreenContextInput = {
  target: 'project',
  cwd: '/w/paper',
  rootDir: '/w/paper',
  projectName: 'Spindle coupling',
  panels: [],
  activeView: 'figures',
  activeRoundId: null,
  profileId: 'nature-astronomy',
  editorTheme: 'suna-dark',
  viewport: { width: 1440.4, height: 900, dpr: 2 },
  shot: 'window',
  platform: 'darwin'
}

const panel = (
  over: Partial<ScreenContextInput['panels'][number]> = {}
): ScreenContextInput['panels'][number] => ({
  component: 'canvas',
  title: 'fig2.svg',
  path: '/w/paper/figures/fig2.svg',
  active: false,
  ...over
})

describe('relativeToRoot', () => {
  it('strips the project prefix', () => {
    expect(relativeToRoot('/w/paper/figures/fig2.svg', '/w/paper')).toBe('figures/fig2.svg')
  })

  it('leaves a path outside the project absolute', () => {
    expect(relativeToRoot('/elsewhere/notes.md', '/w/paper')).toBe('/elsewhere/notes.md')
  })

  it('leaves everything absolute when there is no project', () => {
    expect(relativeToRoot('/w/paper/x.md', null)).toBe('/w/paper/x.md')
  })

  it('does not mistake a sibling directory for the project', () => {
    expect(relativeToRoot('/w/paper-old/x.md', '/w/paper')).toBe('/w/paper-old/x.md')
  })
})

describe('describeActivePanel', () => {
  it('names the front tab in the words the UI uses, by project-relative path', () => {
    const input = { ...BASE, panels: [panel(), panel({ active: true, path: '/w/paper/figures/fig3.svg' })] }
    expect(describeActivePanel(input)).toBe('the figure canvas — figures/fig3.svg')
  })

  it('falls back to the tab title for a panel with no path', () => {
    const input = {
      ...BASE,
      panels: [panel({ component: 'manuscript', title: 'Manuscript', path: null, active: true })]
    }
    expect(describeActivePanel(input)).toBe('the manuscript workspace — "Manuscript"')
  })

  it('passes an unknown component through rather than inventing a name', () => {
    const input = { ...BASE, panels: [panel({ component: 'sketchpad', path: null, active: true })] }
    expect(describeActivePanel(input)).toContain('sketchpad')
  })

  it('says so when nothing is open', () => {
    expect(describeActivePanel(BASE)).toBe('nothing (the dock is empty)')
  })
})

describe('contextMarkdown', () => {
  it('states what the shot covers, and flags the front tab in the list', () => {
    const md = contextMarkdown({
      ...BASE,
      panels: [panel({ title: 'intro.md', component: 'editor', path: '/w/paper/manuscript/intro.md' }), panel({ active: true })]
    })
    expect(md).toContain('- Looking at: the figure canvas — figures/fig2.svg')
    expect(md).toContain('the whole SUNA window')
    expect(md).toContain('- intro.md (manuscript/intro.md) — editor')
    expect(md).toContain('**← front**')
    expect(md.match(/\*\*← front\*\*/g)).toHaveLength(1)
  })

  it('describes a region shot differently from a window one', () => {
    expect(contextMarkdown({ ...BASE, shot: 'region' })).toContain('a rectangle the user dragged')
    expect(contextMarkdown({ ...BASE, shot: 'none' })).toContain('no screenshot was captured')
  })

  it('omits facts it does not have rather than printing empty bullets', () => {
    const md = contextMarkdown({ ...BASE, projectName: null, rootDir: null, profileId: null })
    expect(md).not.toContain('- Project:')
    expect(md).not.toContain('- Rendered-as profile:')
    expect(md).toContain('- Sidebar view: figures')
  })

  it('rounds the viewport and records the device pixel ratio', () => {
    expect(contextMarkdown(BASE)).toContain('1440×900 CSS px @ 2× on darwin')
  })

  it('says the dock is empty rather than listing nothing', () => {
    expect(contextMarkdown(BASE)).toContain('- (none)')
  })
})
