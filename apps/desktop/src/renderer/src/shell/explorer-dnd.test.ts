import { describe, expect, it } from 'vitest'
import type { FsNode } from '@suna/core'
import {
  dropTargetDir,
  moveNote,
  namesInDir,
  parseDragPayload,
  pathsToMove,
  resolveDrop,
  type DropResolution
} from './explorer-dnd'

const ROOT = '/p'

const file = (path: string): FsNode => ({
  kind: 'file',
  name: path.split('/').pop() ?? path,
  path
})
const dir = (path: string, children: FsNode[] = []): FsNode => ({
  kind: 'dir',
  name: path.split('/').pop() ?? path,
  path,
  children
})

/**
 *   /p
 *     data/        fig.svg, sub/
 *     data2/       (empty — the prefix trap)
 *     figures/     (empty)
 *     a.md, fig.svg
 */
const TREE: FsNode = dir(ROOT, [
  dir('/p/data', [file('/p/data/fig.svg'), dir('/p/data/sub')]),
  dir('/p/data2'),
  dir('/p/figures'),
  file('/p/a.md'),
  file('/p/fig.svg')
])

/** resolveDrop with the tree's own names filled in, the way ExplorerView calls it. */
function resolve(dragged: string[], overPath: string | null, overIsDir: boolean): DropResolution {
  const targetDir = dropTargetDir(overPath, overIsDir, ROOT)
  return resolveDrop({
    dragged,
    overPath,
    overIsDir,
    rootDir: ROOT,
    namesInTarget: namesInDir(TREE, targetDir)
  })
}

describe('dropTargetDir', () => {
  it('is the folder itself, a file\'s parent, and the root for empty space', () => {
    expect(dropTargetDir('/p/data', true, ROOT)).toBe('/p/data')
    expect(dropTargetDir('/p/data/fig.svg', false, ROOT)).toBe('/p/data')
    expect(dropTargetDir(null, false, ROOT)).toBe(ROOT)
  })
})

describe('namesInDir', () => {
  it('lists the direct children of a nested directory', () => {
    expect(namesInDir(TREE, '/p/data')).toEqual(['fig.svg', 'sub'])
    expect(namesInDir(TREE, ROOT)).toEqual(['data', 'data2', 'figures', 'a.md', 'fig.svg'])
  })

  // [] is "unknown", not "empty": a target deeper than listTree's MAX_DEPTH is
  // not in the tree at all, and main is the authority on the collision anyway.
  it('is empty for an unknown path, a file, and a missing tree', () => {
    expect(namesInDir(TREE, '/p/nope')).toEqual([])
    expect(namesInDir(TREE, '/p/a.md')).toEqual([])
    expect(namesInDir(null, '/p/data')).toEqual([])
  })
})

describe('pathsToMove', () => {
  it('drops the members that already live in the target', () => {
    expect(pathsToMove(['/p/a.md', '/p/data/fig.svg'], '/p/data')).toEqual(['/p/a.md'])
  })
})

describe('resolveDrop', () => {
  it('moves a file into a folder row', () => {
    expect(resolve(['/p/a.md'], '/p/figures', true)).toEqual({
      targetDir: '/p/figures',
      allowed: true,
      reason: null
    })
  })

  it('treats a file row as its parent directory', () => {
    expect(resolve(['/p/a.md'], '/p/data/fig.svg', false)).toEqual({
      targetDir: '/p/data',
      allowed: true,
      reason: null
    })
  })

  it('treats the empty area below the rows as the project root', () => {
    expect(resolve(['/p/data/fig.svg'], null, false)).toMatchObject({
      targetDir: ROOT,
      allowed: false
    })
    // …refused only because /p already holds a fig.svg; a name it does not
    // hold lands at the root.
    expect(resolve(['/p/data/sub'], null, false)).toEqual({
      targetDir: ROOT,
      allowed: true,
      reason: null
    })
  })

  it('refuses a drop into the path\'s own current parent, silently', () => {
    expect(resolve(['/p/a.md'], '/p/fig.svg', false)).toEqual({
      targetDir: ROOT,
      allowed: false,
      reason: null
    })
    // Same folder reached as a folder row rather than as empty space.
    expect(resolve(['/p/data/fig.svg'], '/p/data', true)).toEqual({
      targetDir: '/p/data',
      allowed: false,
      reason: null
    })
  })

  it('moves the rest of a mixed selection when only some members are already there', () => {
    // fig.svg already lives in /p/data, so it is neither moved nor counted as
    // colliding with itself; a.md is what the drop is for.
    expect(resolve(['/p/a.md', '/p/data/fig.svg'], '/p/data', true)).toEqual({
      targetDir: '/p/data',
      allowed: true,
      reason: null
    })
    expect(pathsToMove(['/p/a.md', '/p/data/fig.svg'], '/p/data')).toEqual(['/p/a.md'])
  })

  it('refuses a folder dropped into itself', () => {
    const out = resolve(['/p/data'], '/p/data', true)
    expect(out.allowed).toBe(false)
    expect(out.reason).toContain('data')
    expect(out.reason).toContain('itself')
  })

  it('refuses a folder dropped into its own descendant', () => {
    expect(resolve(['/p/data'], '/p/data/sub', true).allowed).toBe(false)
    // reached through a file row inside the folder, too
    expect(resolve(['/p/data'], '/p/data/fig.svg', false).allowed).toBe(false)
  })

  it('does NOT treat /p/data2 as inside /p/data', () => {
    expect(resolve(['/p/data'], '/p/data2', true)).toEqual({
      targetDir: '/p/data2',
      allowed: true,
      reason: null
    })
  })

  it('never targets a row inside the dragged set', () => {
    // dragging both the folder and a sibling onto the folder refuses the lot
    expect(resolve(['/p/data', '/p/a.md'], '/p/data', true).allowed).toBe(false)
  })

  it('names the colliding file instead of overwriting it', () => {
    const out = resolve(['/p/fig.svg'], '/p/data', true)
    expect(out).toMatchObject({ targetDir: '/p/data', allowed: false })
    expect(out.reason).toBe('fig.svg already exists in data')
  })

  it('names every collision, plural', () => {
    const out = resolveDrop({
      dragged: ['/p/x/fig.svg', '/p/x/sub'],
      overPath: '/p/data',
      overIsDir: true,
      rootDir: ROOT,
      namesInTarget: ['fig.svg', 'sub']
    })
    expect(out.reason).toBe('fig.svg, sub already exist in data')
  })

  it('refuses two dragged items that would land on the same name', () => {
    // a/fig.svg and b/fig.svg both want to be figures/fig.svg — nothing in the
    // target says so, and main would move one and refuse the other.
    const out = resolveDrop({
      dragged: ['/p/a/fig.svg', '/p/b/fig.svg'],
      overPath: '/p/figures',
      overIsDir: true,
      rootDir: ROOT,
      namesInTarget: []
    })
    expect(out).toEqual({
      targetDir: '/p/figures',
      allowed: false,
      reason: 'Two dragged items share the name fig.svg'
    })
  })

  it('names every shared name, plural', () => {
    const out = resolveDrop({
      dragged: ['/p/a/fig.svg', '/p/b/fig.svg', '/p/a/notes.md', '/p/b/notes.md'],
      overPath: '/p/figures',
      overIsDir: true,
      rootDir: ROOT,
      namesInTarget: []
    })
    expect(out.reason).toBe('Dragged items share the names fig.svg, notes.md')
  })

  it('does not count a member already in the target as sharing its own name', () => {
    // /p/data/fig.svg is not moving, so it collides with nothing; the drop is
    // refused for the OTHER fig.svg, which really is already in /p/data.
    const out = resolve(['/p/data/fig.svg', '/p/fig.svg'], '/p/data', true)
    expect(out.reason).toBe('fig.svg already exists in data')
  })

  it('refuses paths from outside the project root', () => {
    const out = resolveDrop({
      dragged: ['/elsewhere/a.md'],
      overPath: '/p/data',
      overIsDir: true,
      rootDir: ROOT,
      namesInTarget: []
    })
    expect(out.allowed).toBe(false)
    expect(out.reason).toContain('outside')
  })

  it('refuses a target outside the project root', () => {
    const out = resolveDrop({
      dragged: ['/p/a.md'],
      overPath: '/elsewhere',
      overIsDir: true,
      rootDir: ROOT,
      namesInTarget: []
    })
    expect(out).toEqual({
      targetDir: null,
      allowed: false,
      reason: 'That is outside the project folder'
    })
  })

  it('resolves nothing for an empty drag', () => {
    expect(resolve([], '/p/data', true)).toEqual({
      targetDir: null,
      allowed: false,
      reason: null
    })
  })
})

describe('parseDragPayload', () => {
  it('reads back what dragstart wrote', () => {
    const paths = ['/p/a.md', '/p/data/fig.svg']
    expect(parseDragPayload(JSON.stringify(paths))).toEqual(paths)
  })

  it('refuses anything that is not our array of paths', () => {
    expect(parseDragPayload('')).toBeNull()
    expect(parseDragPayload('/p/a.md')).toBeNull()
    expect(parseDragPayload('{"paths":["/p/a.md"]}')).toBeNull()
    expect(parseDragPayload('[1,2]')).toBeNull()
    expect(parseDragPayload('["/p/a.md",""]')).toBeNull()
  })
})

describe('moveNote', () => {
  it('names a single file rather than counting it', () => {
    expect(moveNote([{ from: '/p/a.md', to: '/p/data/a.md' }], [], '/p/data')).toBe(
      'Moved a.md to data/'
    )
  })

  it('counts a batch', () => {
    const moved = [
      { from: '/p/a.md', to: '/p/data/a.md' },
      { from: '/p/b.md', to: '/p/data/b.md' },
      { from: '/p/c.md', to: '/p/data/c.md' }
    ]
    expect(moveNote(moved, [], '/p/data')).toBe('Moved 3 items to data/')
  })

  it('reports what moved AND what did not, without main\'s absolute path', () => {
    const moved = [
      { from: '/p/a.md', to: '/p/data/a.md' },
      { from: '/p/b.md', to: '/p/data/b.md' }
    ]
    // verbatim from moveOne in main/services/fs.ts
    const failed = [
      {
        path: '/p/fig.svg',
        reason: 'refusing to overwrite an existing file: /Users/me/work/p/data/fig.svg'
      }
    ]
    expect(moveNote(moved, failed, '/p/data')).toBe(
      'Moved 2 items to data/; 1 could not move: fig.svg (already exists)'
    )
  })

  it('says only what failed when nothing moved', () => {
    const failed = [
      {
        path: '/p/fig.svg',
        reason: 'refusing to overwrite an existing directory: /Users/me/work/p/data/fig.svg'
      }
    ]
    expect(moveNote([], failed, '/p/data')).toBe('Could not move fig.svg (already exists)')
  })

  it('shortens the into-itself reason too', () => {
    const failed = [
      {
        path: '/p/data',
        reason:
          'cannot move a directory into itself or one of its own subfolders: /Users/me/work/p/data'
      }
    ]
    expect(moveNote([], failed, '/p/data/sub')).toBe(
      'Could not move data (cannot move into itself)'
    )
  })

  it('keeps an unrecognised reason, with its paths cut to basenames', () => {
    const failed = [
      { path: '/p/a.md', reason: "EACCES: permission denied, rename '/p/a.md' -> '/p/data/a.md'" }
    ]
    expect(moveNote([], failed, '/p/data')).toBe(
      'Could not move a.md (EACCES: permission denied, rename \'a.md\' -> \'a.md\')'
    )
  })

  it('clamps an unrecognised reason to one status-bar line', () => {
    const note = moveNote([], [{ path: '/p/a.md', reason: 'x'.repeat(120) }], '/p/data')
    expect(note).toBe(`Could not move a.md (${'x'.repeat(59)}…)`)
  })

  it('is silent about an empty batch', () => {
    expect(moveNote([], [], '/p/data')).toBeNull()
  })
})
