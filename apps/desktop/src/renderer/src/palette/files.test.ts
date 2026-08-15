import { describe, expect, it } from 'vitest'
import type { FsNode } from '@suna/core'
import { collectFiles } from './files'

const TREE: FsNode = {
  kind: 'dir',
  name: 'my-paper',
  path: '/work/my-paper',
  children: [
    { kind: 'file', name: 'suna.json', path: '/work/my-paper/suna.json' },
    {
      kind: 'dir',
      name: 'manuscript',
      path: '/work/my-paper/manuscript',
      children: [
        {
          kind: 'dir',
          name: 'sections',
          path: '/work/my-paper/manuscript/sections',
          children: [
            {
              kind: 'file',
              name: '01-introduction.md',
              path: '/work/my-paper/manuscript/sections/01-introduction.md'
            }
          ]
        }
      ]
    },
    {
      kind: 'dir',
      name: 'empty-dir',
      path: '/work/my-paper/empty-dir',
      children: []
    }
  ]
}

describe('collectFiles', () => {
  it('flattens every file, depth-first, and omits directories', () => {
    expect(collectFiles(TREE)).toEqual([
      { path: '/work/my-paper/suna.json', name: 'suna.json', rel: '/work/my-paper/suna.json' },
      {
        path: '/work/my-paper/manuscript/sections/01-introduction.md',
        name: '01-introduction.md',
        rel: '/work/my-paper/manuscript/sections/01-introduction.md'
      }
    ])
  })

  it('makes `rel` project-relative when a rootDir is given', () => {
    expect(collectFiles(TREE, '/work/my-paper').map((f) => f.rel)).toEqual([
      'suna.json',
      'manuscript/sections/01-introduction.md'
    ])
  })

  it('tolerates a rootDir with a trailing slash', () => {
    expect(collectFiles(TREE, '/work/my-paper/').map((f) => f.rel)).toEqual([
      'suna.json',
      'manuscript/sections/01-introduction.md'
    ])
  })

  it('leaves `rel` absolute for a file outside rootDir', () => {
    // A sibling directory whose name merely starts the same way must not be
    // sliced by a raw string prefix (`/work/my-paper` vs `/work/my-paper-2`).
    const outside: FsNode = {
      kind: 'dir',
      name: 'my-paper-2',
      path: '/work/my-paper-2',
      children: [{ kind: 'file', name: 'notes.md', path: '/work/my-paper-2/notes.md' }]
    }
    expect(collectFiles(outside, '/work/my-paper').map((f) => f.rel)).toEqual([
      '/work/my-paper-2/notes.md'
    ])
  })

  it('returns an empty list for a null tree', () => {
    expect(collectFiles(null)).toEqual([])
  })

  it('returns an empty list for an empty root', () => {
    expect(collectFiles({ kind: 'dir', name: 'root', path: '/root', children: [] })).toEqual([])
  })
})
