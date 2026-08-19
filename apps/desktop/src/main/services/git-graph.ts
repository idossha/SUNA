import { runGit } from './git'
import { assertInsideAllowedRoot } from './roots'

/* ---------------------------------------------------------------------------
   The commit graph behind the timeline.

   `git log --graph` draws ASCII art; it does not hand out the structure. So
   this asks for the raw fields — hash, parents, author, decorations — and
   computes lane placement here, where it can be tested and where the renderer
   can turn it into SVG rather than re-parsing characters.
   --------------------------------------------------------------------------- */

/** %x1f — unit separator; appears in none of these fields, so it delimits safely. */
const SEP = '\u001f'
const GRAPH_FORMAT = ['%H', '%P', '%an', '%ae', '%aI', '%D', '%s'].join('%x1f')

export type GitRefKind = 'head' | 'local' | 'remote' | 'tag'

export interface GitRef {
  kind: GitRefKind
  name: string
}

export interface GitGraphCommit {
  hash: string
  parents: string[]
  author: string
  email: string
  date: string
  subject: string
  refs: GitRef[]
  /**
   * True when the commit is reachable from a remote-tracking ref, i.e. it is
   * on the server. This is the "pushed" half of staged/committed/pushed, and
   * it is computed from the window's own parent links (see markPushed).
   */
  pushed: boolean
}

/**
 * One row of the drawn graph. Lanes are columns; an edge is a line crossing
 * the row's vertical band.
 *
 * `fromLane === DOT` means the line starts at this row's commit dot, and
 * `toLane === DOT` means it ends there — which is how a branch point and a
 * merge get their bend without the renderer knowing anything about ancestry.
 */
export const DOT = -1

export interface GraphEdge {
  fromLane: number
  toLane: number
  color: number
}

export interface GraphRow {
  hash: string
  lane: number
  color: number
  edges: GraphEdge[]
}

export interface GitGraphResult {
  commits: GitGraphCommit[]
  rows: GraphRow[]
  /** Widest lane count across all rows — the column count to size the gutter. */
  laneCount: number
  /** True when the log was truncated at `limit`. */
  truncated: boolean
}

export type GraphScope = 'current' | 'all'

/** Parse one `%D` decoration list into typed refs. */
export function parseRefs(decoration: string): GitRef[] {
  const refs: GitRef[] = []
  for (const raw of decoration.split(',')) {
    const text = raw.trim()
    if (text === '') continue
    if (text.startsWith('tag: ')) {
      refs.push({ kind: 'tag', name: text.slice(5).trim() })
      continue
    }
    // 'HEAD -> main' decorates the checked-out branch; both facts are useful.
    const arrow = text.indexOf(' -> ')
    if (arrow !== -1) {
      const branch = text.slice(arrow + 4).trim()
      refs.push({ kind: 'head', name: branch })
      continue
    }
    if (text === 'HEAD') {
      refs.push({ kind: 'head', name: 'HEAD' })
      continue
    }
    // A remote-tracking ref is 'origin/main'; a local one has no slash unless
    // the branch itself is namespaced ('feature/x'), so the remote list is the
    // only reliable discriminator — supplied by the caller via markRemotes.
    refs.push({ kind: 'local', name: text })
  }
  return refs
}

/** Re-kind refs whose first path segment names a configured remote. */
export function markRemotes(refs: GitRef[], remotes: string[]): GitRef[] {
  if (remotes.length === 0) return refs
  return refs.map((ref) => {
    if (ref.kind !== 'local') return ref
    const slash = ref.name.indexOf('/')
    if (slash === -1) return ref
    const prefix = ref.name.slice(0, slash)
    return remotes.includes(prefix) ? { kind: 'remote' as const, name: ref.name } : ref
  })
}

/** Split the `--pretty` output into commits; malformed lines are skipped. */
export function parseGraphLog(out: string, remotes: string[]): GitGraphCommit[] {
  const commits: GitGraphCommit[] = []
  for (const line of out.split('\n')) {
    if (line === '') continue
    const parts = line.split(SEP)
    if (parts.length < 7) continue
    const [hash = '', parentsRaw = '', author = '', email = '', date = '', decoration = ''] = parts
    // The subject is the last field and may itself contain nothing else, but
    // rejoin defensively in case a future format adds a field.
    const subject = parts.slice(6).join(SEP)
    if (hash === '') continue
    commits.push({
      hash,
      parents: parentsRaw.split(' ').filter((p) => p !== ''),
      author,
      email,
      date,
      subject,
      refs: markRemotes(parseRefs(decoration), remotes),
      pushed: false
    })
  }
  return commits
}

/**
 * Mark every commit reachable from a remote-tracking ref as pushed.
 *
 * Walks the window's own parent links rather than asking git again: a commit
 * outside the window is never drawn, so reachability within the window is
 * exactly as much truth as the timeline can show — and it costs no process.
 */
export function markPushed(commits: GitGraphCommit[]): void {
  const byHash = new Map(commits.map((c) => [c.hash, c]))
  const queue: string[] = []
  for (const commit of commits) {
    if (commit.refs.some((ref) => ref.kind === 'remote')) queue.push(commit.hash)
  }
  const seen = new Set<string>(queue)
  while (queue.length > 0) {
    const hash = queue.pop() as string
    const commit = byHash.get(hash)
    if (commit === undefined) continue
    commit.pushed = true
    for (const parent of commit.parents) {
      if (seen.has(parent)) continue
      seen.add(parent)
      queue.push(parent)
    }
  }
}

/**
 * Place commits into lanes and describe the lines between them.
 *
 * The state carried down the list is `lanes`: for each column, the hash that
 * column is currently waiting to draw. A commit takes the column reserved for
 * it (or a fresh one if it is a branch tip), and then hands that column to its
 * first parent — additional parents claim columns of their own, which is what
 * makes a merge fan out.
 *
 * Requires parents to appear after their children, which every `git log`
 * ordering guarantees.
 */
export function layoutGraph(commits: GitGraphCommit[]): {
  rows: GraphRow[]
  laneCount: number
} {
  /** Column → hash it is reserved for; null when free. */
  const lanes: (string | null)[] = []
  /** Column → colour index, held for as long as the column stays occupied. */
  const laneColor: number[] = []
  const rows: GraphRow[] = []
  let laneCount = 0
  let nextColor = 0

  const claim = (hash: string, color: number): number => {
    const existing = lanes.indexOf(hash)
    if (existing !== -1) return existing
    const free = lanes.indexOf(null)
    const index = free === -1 ? lanes.length : free
    lanes[index] = hash
    laneColor[index] = color
    return index
  }

  for (const commit of commits) {
    const before = lanes.slice()

    let lane = lanes.indexOf(commit.hash)
    if (lane === -1) {
      // A tip: nothing below reserved a column for it, so it opens its own.
      lane = claim(commit.hash, nextColor)
      nextColor += 1
    }
    const color = laneColor[lane] ?? 0

    // Free this commit's column before placing parents, so a single-parent
    // commit reuses its own column rather than drifting rightward.
    lanes[lane] = null

    const parentLanes: number[] = []
    commit.parents.forEach((parent, index) => {
      const already = lanes.indexOf(parent)
      if (already !== -1) {
        // The parent is already awaited elsewhere: this line merges into it.
        parentLanes.push(already)
        return
      }
      if (index === 0) {
        // The first parent continues this commit's line, and its colour.
        lanes[lane] = parent
        laneColor[lane] = color
        parentLanes.push(lane)
        return
      }
      const placed = claim(parent, nextColor)
      nextColor += 1
      parentLanes.push(placed)
    })

    const after = lanes.slice()

    const edges: GraphEdge[] = []
    // Lines arriving from above: every column that was reserved before this
    // row either terminates at the dot (it was waiting for this commit) or
    // passes through to wherever its hash sits below.
    before.forEach((hash, column) => {
      if (hash === null) return
      // `claim` never reserves one hash in two columns, so the only column
      // that can be waiting for this commit is its own.
      if (hash === commit.hash) {
        edges.push({ fromLane: column, toLane: DOT, color: laneColor[column] ?? color })
        return
      }
      const below = after.indexOf(hash)
      if (below === -1) return
      edges.push({ fromLane: column, toLane: below, color: laneColor[column] ?? 0 })
    })
    // Lines leaving the dot downward, one per parent.
    for (const parentLane of parentLanes) {
      edges.push({ fromLane: DOT, toLane: parentLane, color: laneColor[parentLane] ?? color })
    }

    // Trim columns that fell free at the right edge, so the gutter shrinks
    // back rather than staying as wide as the busiest moment in history.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()

    laneCount = Math.max(laneCount, before.length, after.length, lane + 1)
    rows.push({ hash: commit.hash, lane, color, edges })
  }

  return { rows, laneCount: Math.max(1, laneCount) }
}

/** Names of the configured remotes, for telling `origin/main` from a branch. */
async function remoteNames(dir: string): Promise<string[]> {
  const out = await runGit(dir, ['remote']).catch(() => '')
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/**
 * The commit graph for the timeline. `scope: 'all'` includes every branch and
 * remote-tracking ref — which is the point when collaborating, because a
 * co-author's branch is invisible on the current one.
 */
export async function gitGraph(
  dir: string,
  limit: number,
  scope: GraphScope = 'all'
): Promise<GitGraphResult> {
  const abs = assertInsideAllowedRoot(dir)
  const empty: GitGraphResult = { commits: [], rows: [], laneCount: 1, truncated: false }

  const remotes = await remoteNames(abs)
  // One extra, purely to detect truncation without a second walk.
  const args = ['log', '--date-order', '-n', String(limit + 1), `--pretty=format:${GRAPH_FORMAT}`]
  if (scope === 'all') args.push('--all')

  let out: string
  try {
    out = await runGit(abs, args)
  } catch {
    return empty // not a repository, or no commits yet
  }

  const all = parseGraphLog(out, remotes)
  const truncated = all.length > limit
  const commits = truncated ? all.slice(0, limit) : all
  markPushed(commits)
  const { rows, laneCount } = layoutGraph(commits)
  return { commits, rows, laneCount, truncated }
}

/**
 * The commits that touched one path, newest first — "how did this section get
 * here", answered without leaving the app.
 */
export async function gitFileHistory(
  dir: string,
  path: string,
  limit: number
): Promise<{ entries: Array<{ hash: string; subject: string; author: string; date: string }> }> {
  const abs = assertInsideAllowedRoot(dir)
  const { assertRepoPath } = await import('./git')
  const rel = assertRepoPath(abs, path)
  const out = await runGit(abs, [
    'log',
    '--follow',
    '-n',
    String(limit),
    `--pretty=format:%H${SEP}%s${SEP}%an${SEP}%aI`,
    '--',
    rel
  ]).catch(() => '')
  const entries: Array<{ hash: string; subject: string; author: string; date: string }> = []
  for (const line of out.split('\n')) {
    if (!line.includes(SEP)) continue
    const [hash = '', subject = '', author = '', date = ''] = line.split(SEP)
    if (hash !== '') entries.push({ hash, subject, author, date })
  }
  return { entries }
}

/** One commit's full diff, for clicking a row in the timeline. */
export async function gitShowCommit(
  dir: string,
  hash: string
): Promise<{ diff: string; files: Array<{ path: string; added: number; removed: number }> }> {
  const abs = assertInsideAllowedRoot(dir)
  if (!/^[0-9a-fA-F]{4,40}$/.test(hash)) throw new Error(`Not a commit hash: ${hash}`)

  const numstat = await runGit(abs, ['show', '--numstat', '--format=', hash]).catch(() => '')
  const files: Array<{ path: string; added: number; removed: number }> = []
  for (const line of numstat.split('\n')) {
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const [addedRaw = '', removedRaw = '', path = ''] = parts
    if (path === '') continue
    // '-' marks a binary file; count it as zero rather than NaN.
    files.push({
      path,
      added: Number.parseInt(addedRaw, 10) || 0,
      removed: Number.parseInt(removedRaw, 10) || 0
    })
  }
  const diff = await runGit(abs, ['show', '--format=', '--patch', hash]).catch(() => '')
  return { diff, files }
}
