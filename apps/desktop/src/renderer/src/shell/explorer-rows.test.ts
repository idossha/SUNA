import { describe, expect, it } from 'vitest'
import type { FsNode } from '@suna/core'
import { defaultExpanded, forcesOpen, parentDirOf, visibleRows } from './explorer-rows'

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
  it('opens the top two levels of directories, and no files', () => {
    expect(defaultExpanded(TREE).sort()).toEqual(
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
