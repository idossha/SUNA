import { describe, expect, it } from 'vitest'
import {
  DOT,
  layoutGraph,
  markPushed,
  markRemotes,
  parseGraphLog,
  parseRefs,
  type GitGraphCommit
} from './git-graph'

const SEP = '\u001f'

/** A commit with only the fields the layout and reachability code reads. */
function commit(hash: string, parents: string[], refs: GitGraphCommit['refs'] = []): GitGraphCommit {
  return {
    hash,
    parents,
    author: 'A',
    email: 'a@example.com',
    date: '2026-01-01T00:00:00Z',
    subject: hash,
    refs,
    pushed: false
  }
}

describe('parseRefs', () => {
  it('separates the checked-out branch, plain branches and tags', () => {
    const refs = parseRefs('HEAD -> main, origin/main, tag: v1.0, revision-2')
    expect(refs).toEqual([
      { kind: 'head', name: 'main' },
      { kind: 'local', name: 'origin/main' },
      { kind: 'tag', name: 'v1.0' },
      { kind: 'local', name: 'revision-2' }
    ])
  })

  it('reads a bare detached HEAD', () => {
    expect(parseRefs('HEAD')).toEqual([{ kind: 'head', name: 'HEAD' }])
  })

  it('returns nothing for an undecorated commit', () => {
    expect(parseRefs('')).toEqual([])
  })
})

describe('markRemotes', () => {
  it('re-kinds only refs whose prefix names a configured remote', () => {
    const refs = parseRefs('origin/main, feature/rewrite, upstream/main')
    expect(markRemotes(refs, ['origin'])).toEqual([
      { kind: 'remote', name: 'origin/main' },
      // A slash does NOT make it remote — 'feature' is not a remote.
      { kind: 'local', name: 'feature/rewrite' },
      { kind: 'local', name: 'upstream/main' }
    ])
  })

  it('leaves everything local when the repo has no remotes', () => {
    expect(markRemotes(parseRefs('origin/main'), [])).toEqual([
      { kind: 'local', name: 'origin/main' }
    ])
  })
})

describe('parseGraphLog', () => {
  it('reads fields, splits parents, and types the decorations', () => {
    const line = ['abc', 'p1 p2', 'Ada', 'ada@lab.edu', '2026-01-01T10:00:00Z', 'origin/main', 'Fix the caption'].join(SEP)
    const [entry] = parseGraphLog(line, ['origin'])
    expect(entry?.hash).toBe('abc')
    expect(entry?.parents).toEqual(['p1', 'p2'])
    expect(entry?.author).toBe('Ada')
    expect(entry?.refs).toEqual([{ kind: 'remote', name: 'origin/main' }])
    expect(entry?.subject).toBe('Fix the caption')
  })

  it('keeps a root commit, which has no parents at all', () => {
    const line = ['root', '', 'Ada', 'a@b.c', '2026-01-01T00:00:00Z', '', 'First'].join(SEP)
    expect(parseGraphLog(line, [])[0]?.parents).toEqual([])
  })

  it('skips a malformed line rather than emitting a half commit', () => {
    expect(parseGraphLog('not a log line', [])).toEqual([])
  })
})

describe('markPushed', () => {
  it('marks the remote ref and everything behind it, and nothing above', () => {
    // c2 (local only) → c1 (origin/main) → c0
    const commits = [
      commit('c2', ['c1']),
      commit('c1', ['c0'], [{ kind: 'remote', name: 'origin/main' }]),
      commit('c0', [])
    ]
    markPushed(commits)
    expect(commits.map((c) => c.pushed)).toEqual([false, true, true])
  })

  it('marks nothing when no remote ref is in the window', () => {
    const commits = [commit('c1', ['c0']), commit('c0', [])]
    markPushed(commits)
    expect(commits.every((c) => !c.pushed)).toBe(true)
  })

  it('follows both parents of a merge', () => {
    const commits = [
      commit('m', ['a', 'b'], [{ kind: 'remote', name: 'origin/main' }]),
      commit('a', []),
      commit('b', [])
    ]
    markPushed(commits)
    expect(commits.every((c) => c.pushed)).toBe(true)
  })
})

describe('layoutGraph', () => {
  it('keeps a straight history in one lane', () => {
    const { rows, laneCount } = layoutGraph([
      commit('c2', ['c1']),
      commit('c1', ['c0']),
      commit('c0', [])
    ])
    expect(laneCount).toBe(1)
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0])
    // The middle row is entered from above and left downward.
    expect(rows[1]?.edges).toEqual([
      { fromLane: 0, toLane: DOT, color: 0 },
      { fromLane: DOT, toLane: 0, color: 0 }
    ])
  })

  it('gives a root commit no downward edge', () => {
    const { rows } = layoutGraph([commit('only', [])])
    expect(rows[0]?.edges).toEqual([])
    expect(rows[0]?.lane).toBe(0)
  })

  it('opens a second lane for a divergent branch tip', () => {
    // Two tips (c2 on main, b1 on a branch) that share the parent c0.
    const { rows, laneCount } = layoutGraph([
      commit('c2', ['c0']),
      commit('b1', ['c0']),
      commit('c0', [])
    ])
    expect(laneCount).toBe(2)
    expect(rows[0]?.lane).toBe(0)
    expect(rows[1]?.lane).toBe(1)

    // The join happens in b1's OWN row: its dot bends down into lane 0, while
    // lane 0 (still carrying c0) passes straight through beside it. Drawing it
    // there rather than as a second arrival at c0 is what keeps the bend one
    // row tall instead of stretching across the gap.
    expect(rows[1]?.edges).toEqual([
      { fromLane: 0, toLane: 0, color: 0 },
      { fromLane: DOT, toLane: 0, color: 0 }
    ])

    // So c0 is reached by exactly one line, in lane 0.
    expect(rows[2]?.lane).toBe(0)
    expect(rows[2]?.edges).toEqual([{ fromLane: 0, toLane: DOT, color: 0 }])
  })

  it('fans a merge out to both parents and reclaims the lane afterwards', () => {
    //   m  (merge of a and b)
    //   |\
    //   a b
    //   |/
    //   c0
    const { rows, laneCount } = layoutGraph([
      commit('m', ['a', 'b']),
      commit('a', ['c0']),
      commit('b', ['c0']),
      commit('c0', [])
    ])
    expect(laneCount).toBe(2)
    const outgoing = rows[0]?.edges.filter((e) => e.fromLane === DOT) ?? []
    expect(outgoing.map((e) => e.toLane).sort()).toEqual([0, 1])
    // Both sides come back together, so the gutter narrows again at the root.
    expect(rows[3]?.lane).toBe(0)
  })

  it('never places a commit in a lane another commit still needs', () => {
    const commits = [
      commit('h', ['g', 'f']),
      commit('g', ['e']),
      commit('f', ['e']),
      commit('e', ['d']),
      commit('d', [])
    ]
    const { rows } = layoutGraph(commits)
    // Every commit gets exactly one row, and every row a defined lane.
    expect(rows).toHaveLength(commits.length)
    expect(rows.every((row) => row.lane >= 0)).toBe(true)
    expect(new Set(rows.map((r) => r.hash)).size).toBe(commits.length)
  })

  it('emits an edge for every parent of every commit', () => {
    const commits = [commit('m', ['a', 'b']), commit('a', ['r']), commit('b', ['r']), commit('r', [])]
    const { rows } = layoutGraph(commits)
    const outgoing = rows.reduce(
      (total, row) => total + row.edges.filter((e) => e.fromLane === DOT).length,
      0
    )
    expect(outgoing).toBe(commits.reduce((total, c) => total + c.parents.length, 0))
  })
})
