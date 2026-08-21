import { describe, expect, it } from 'vitest'
import type { FsNode } from '@suna/core'
import {
  defaultExpanded,
  forcesOpen,
  hasChildren,
  iconKindForFile,
  parentDirOf,
  rowPaddingLeft,
  semanticDirs,
  visibleRows
} from './explorer-rows'

const dir = (path: string, children: FsNode[]): FsNode => ({
  kind: 'dir',
  name: path.split('/').pop() ?? path,
  path,
  children
})
const file = (path: string): FsNode => ({
  kind: 'file',
  name: path.split('/').pop() ?? path,
  path
})

/**
 * /work/paper
 *   manuscript/  manuscript.md, figures/ (fig.svg)
 *   data/        raw/ (a.csv)
 *   README.md
 */
const TREE = dir('/work/paper', [
  dir('/work/paper/manuscript', [
    file('/work/paper/manuscript/manuscript.md'),
    dir('/work/paper/manuscript/figures', [file('/work/paper/manuscript/figures/fig.svg')])
  ]),
  dir('/work/paper/data', [dir('/work/paper/data/raw', [file('/work/paper/data/raw/a.csv')])]),
  file('/work/paper/README.md')
])

const paths = (rows: ReturnType<typeof visibleRows>): string[] => rows.map((r) => r.node.path)

describe('parentDirOf', () => {
  it('returns the containing directory', () => {
    expect(parentDirOf('/work/paper/README.md')).toBe('/work/paper')
  })

  it('returns the path itself when there is no parent to go to', () => {
    expect(parentDirOf('/work')).toBe('/work')
  })
})

describe('defaultExpanded', () => {
  it('opens nothing: every root folder starts collapsed', () => {
    expect(defaultExpanded(TREE)).toEqual([])
  })

  it('still opens the top two levels when a depth is asked for', () => {
    expect(defaultExpanded(TREE, 2).sort()).toEqual(
      [
        '/work/paper/manuscript',
        '/work/paper/manuscript/figures',
        '/work/paper/data',
        '/work/paper/data/raw'
      ].sort()
    )
  })

  it('is empty for a project with no directories', () => {
    expect(defaultExpanded(dir('/p', [file('/p/a.md')]))).toEqual([])
  })
})

describe('visibleRows', () => {
  it('shows only top-level entries when nothing is expanded', () => {
    expect(paths(visibleRows(TREE, new Set(), null))).toEqual([
      '/work/paper/manuscript',
      '/work/paper/data',
      '/work/paper/README.md'
    ])
  })

  it('reveals a directory\'s children in display order when expanded', () => {
    const rows = visibleRows(TREE, new Set(['/work/paper/manuscript']), null)
    expect(paths(rows)).toEqual([
      '/work/paper/manuscript',
      '/work/paper/manuscript/manuscript.md',
      '/work/paper/manuscript/figures',
      '/work/paper/data',
      '/work/paper/README.md'
    ])
  })

  it('does not reveal a grandchild whose own parent is collapsed', () => {
    // 'figures' is expanded but 'manuscript' is not, so nothing inside shows
    const rows = visibleRows(TREE, new Set(['/work/paper/manuscript/figures']), null)
    expect(paths(rows)).not.toContain('/work/paper/manuscript/figures/fig.svg')
  })

  it('reports the depth each row is drawn at', () => {
    const rows = visibleRows(
      TREE,
      new Set(['/work/paper/manuscript', '/work/paper/manuscript/figures']),
      null
    )
    const depthOf = (path: string): number | undefined =>
      rows.find((r) => r.node.path === path)?.depth
    expect(depthOf('/work/paper/manuscript')).toBe(0)
    expect(depthOf('/work/paper/manuscript/figures')).toBe(1)
    expect(depthOf('/work/paper/manuscript/figures/fig.svg')).toBe(2)
  })

  it('forces open the ancestors of a pending create, so the input row is visible', () => {
    const rows = visibleRows(TREE, new Set(), {
      kind: 'create-file',
      parentPath: '/work/paper/manuscript/figures'
    })
    expect(paths(rows)).toContain('/work/paper/manuscript/figures')
  })
})

describe('forcesOpen', () => {
  it('is true for the create target and its ancestors', () => {
    const editing = { kind: 'create-dir', parentPath: '/work/paper/data/raw' } as const
    expect(forcesOpen(editing, '/work/paper/data/raw')).toBe(true)
    expect(forcesOpen(editing, '/work/paper/data')).toBe(true)
  })

  it('is false for unrelated directories and for renames', () => {
    expect(forcesOpen({ kind: 'create-file', parentPath: '/work/paper/data' }, '/work/paper/manuscript')).toBe(false)
    expect(
      forcesOpen(
        { kind: 'rename', path: '/work/paper/data', name: 'data', isDir: true },
        '/work/paper/data'
      )
    ).toBe(false)
    expect(forcesOpen(null, '/work/paper/data')).toBe(false)
  })

  it('does not treat a sibling with a shared name prefix as an ancestor', () => {
    // '/work/paper/data-old' must not be forced open by a create in '/work/paper/data'
    expect(forcesOpen({ kind: 'create-file', parentPath: '/work/paper/data' }, '/work/paper/data-old')).toBe(false)
  })
})

describe('iconKindForFile', () => {
  it('maps the extensions this app opens to their own icon', () => {
    expect(iconKindForFile('manuscript.md')).toBe('markdown')
    expect(iconKindForFile('notes.markdown')).toBe('markdown')
    expect(iconKindForFile('references.bib')).toBe('bib')
    expect(iconKindForFile('suna.json')).toBe('json')
    expect(iconKindForFile('fig4_method.svg')).toBe('figure')
    expect(iconKindForFile('fig7_scatter.png')).toBe('image')
    expect(iconKindForFile('p077.pdf')).toBe('pdf')
    expect(iconKindForFile('spectrum.csv')).toBe('table')
    expect(iconKindForFile('plot.py')).toBe('code')
    expect(iconKindForFile('paper.tex')).toBe('tex')
  })

  it('reads the extension from the LAST dot', () => {
    // examples/hello-suna/figures/fig-spectrum/figure.svg.suna.json is the
    // sidecar, not the figure it describes
    expect(iconKindForFile('figure.svg.suna.json')).toBe('json')
  })

  it('is case-insensitive', () => {
    expect(iconKindForFile('IMG.PNG')).toBe('image')
    expect(iconKindForFile('README.MD')).toBe('markdown')
  })

  it('falls back to a plain file for anything it cannot open by extension', () => {
    expect(iconKindForFile('Makefile')).toBe('file')
    expect(iconKindForFile('p077.docx')).toBe('file')
    // a leading dot is not an extension
    expect(iconKindForFile('.gitignore')).toBe('file')
    expect(iconKindForFile('')).toBe('file')
  })
})

describe('semanticDirs', () => {
  const DIRS = {
    manuscript: 'manuscript',
    figures: 'figures',
    code: 'code',
    data: 'data',
    analysis: 'analysis',
    results: 'results',
    output: 'output'
  }

  it('maps every declared directory, at the top level only', () => {
    const map = semanticDirs('/work/paper', DIRS)
    expect(map.get('/work/paper/figures')).toBe('figures')
    expect(map.get('/work/paper/manuscript')).toBe('manuscript')
    expect(map.size).toBe(7)
    // a figures/ nested inside manuscript/ is not the project's figures dir
    expect(map.has('/work/paper/manuscript/figures')).toBe(false)
  })

  it('follows the manifest when a folder has been renamed', () => {
    const map = semanticDirs('/work/paper', { ...DIRS, figures: 'plots' })
    expect(map.get('/work/paper/plots')).toBe('figures')
    expect(map.has('/work/paper/figures')).toBe(false)
  })

  it('is empty with no manifest and with no project open', () => {
    expect(semanticDirs('/work/paper', undefined).size).toBe(0)
    expect(semanticDirs(null, DIRS).size).toBe(0)
  })
})

describe('hasChildren', () => {
  it('is true only for a directory with entries', () => {
    expect(hasChildren(dir('/p/data', [file('/p/data/a.csv')]))).toBe(true)
    expect(hasChildren(dir('/p/data', []))).toBe(false)
    expect(hasChildren(file('/p/a.md'))).toBe(false)
  })
})

describe('rowPaddingLeft', () => {
  it('steps in by one level per depth', () => {
    expect(rowPaddingLeft(0)).toBe(8)
    expect(rowPaddingLeft(1)).toBeGreaterThan(rowPaddingLeft(0))
    expect(rowPaddingLeft(2) - rowPaddingLeft(1)).toBe(rowPaddingLeft(1) - rowPaddingLeft(0))
  })
})
