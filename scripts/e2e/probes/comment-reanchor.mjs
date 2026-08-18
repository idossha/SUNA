/**
 * Drive probe — a human's comment must SURVIVE an AI edit of the very prose
 * it points at, and a detached comment must stay usable.
 *
 * This exercises the real mechanism end to end, not a unit stub: the comment
 * is created through the running app's store, the edit goes through the real
 * MCP server over stdio (the same `edit_manuscript` an agent calls), and the
 * assertions read the app's own state and DOM afterwards. That matters
 * because the failure mode here is a RACE between the agent's write and the
 * renderer's anchor maintenance — invisible to any in-process test.
 *
 *   1. comment on prose the "agent" then rewrites → still attached, quoting
 *      the rewrite, with the manuscript OPEN in the editor (stale-buffer
 *      race) and again with it closed;
 *   2. a genuinely detached comment → reachable from the outline, its card
 *      rendered and clickable, and Resolve / Delete both work on it.
 *
 * Run:  node scripts/e2e/drive.mjs --boot --example
 *       node scripts/e2e/drive.mjs scripts/e2e/probes/comment-reanchor.mjs
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SERVER = join(ROOT, 'packages', 'agent', 'dist-mcp', 'server.mjs')

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

/** Call one MCP tool through the real server over stdio, as an agent would. */
function callTool(rootDir, name, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [SERVER], {
      cwd: rootDir,
      env: { ...process.env, SUNA_PROJECT_DIR: rootDir },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => {
      out += d
      for (const line of out.split('\n')) {
        if (line.trim() === '') continue
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.id === 2) {
          child.kill()
          if (msg.error) reject(new Error(`${name}: ${msg.error.message}`))
          else if (msg.result?.isError) {
            reject(new Error(`${name}: ${msg.result.content?.[0]?.text ?? 'tool error'}`))
          } else resolvePromise(msg.result?.content?.[0]?.text ?? '')
        }
      }
    })
    child.stderr.on('data', (d) => {
      err += d
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code !== null && code !== 0 && out === '') reject(new Error(`server exited ${code}: ${err}`))
    })
    const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n')
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'drive-probe', version: '0' }
      }
    })
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } })
  })
}

export default async (ctx) => {
  await ctx.waitFor(`!!window.__sunaDev`, { timeoutMs: 20000, desc: 'window.__sunaDev (dev build)' })
  const rootDir = await ctx.evalJs(`window.__sunaDev.projectStore.getState().rootDir`)
  assert(rootDir, 'no project open — boot with: node scripts/e2e/drive.mjs --boot --example')
  const manuscriptPath = join(rootDir, 'manuscript', 'manuscript.md')
  const original = readFileSync(manuscriptPath, 'utf8')
  const originalComments = readFileSync(join(rootDir, 'manuscript', 'comments.json'), 'utf8')

  const created = []
  const addComment = async (quote, body) => {
    const id = await ctx.evalJs(`(async () => {
      const store = window.__sunaDev.commentsStore.getState()
      const c = await store.add(
        { kind: 'section', path: 'manuscript.md', anchor: ${JSON.stringify(anchorFor(original, quote))} },
        ${JSON.stringify(body)}
      )
      return c === null ? null : c.id
    })()`)
    assert(id, `could not create a comment on ${JSON.stringify(quote)}`)
    created.push(id)
    return id
  }
  const commentById = (id) => ctx.evalJs(`(() => {
    const c = window.__sunaDev.commentsStore.getState().comments.find((x) => x.id === ${JSON.stringify(id)})
    return c === undefined ? null : { detached: c.detached, quote: c.target.anchor.quote, resolved: c.resolved }
  })()`)

  const failures = []
  const check = (name, cond, detail) => {
    if (cond) console.log(`  ✓ ${name}`)
    else {
      console.log(`  ✗ ${name}${detail === undefined ? '' : ` — ${detail}`}`)
      failures.push(name)
    }
  }

  try {
    // ---- 1. re-anchor across an agent edit, manuscript OPEN in the editor --
    // The stale-buffer race only exists when a doc session holds the old text.
    await ctx.evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(manuscriptPath)})`)
    await ctx.sleep(1500)

    const target = pickQuote(original)
    const idOpen = await addComment(target, 'please tighten this sentence')
    await ctx.sleep(300)

    const rewrite = `${target.slice(0, Math.floor(target.length / 2))}REWRITTEN-BY-AGENT`
    await callTool(rootDir, 'edit_manuscript', { find: target, replace: rewrite })
    // let the watcher, the doc-session reload and anchor maintenance settle
    await ctx.sleep(2500)

    const afterOpen = await commentById(idOpen)
    check(
      'comment stays attached when the agent rewrites its quote (editor open)',
      afterOpen !== null && afterOpen.detached === false,
      afterOpen === null ? 'comment vanished' : `detached=${afterOpen.detached} quote=${JSON.stringify(afterOpen.quote)}`
    )
    check(
      'the re-anchored quote covers the agent\'s rewrite',
      afterOpen !== null && afterOpen.quote.includes('REWRITTEN-BY-AGENT'),
      afterOpen === null ? 'comment vanished' : `quote=${JSON.stringify(afterOpen.quote)}`
    )

    // ---- 2. a genuinely detached comment stays usable ----------------------
    const idDead = await addComment(pickQuote(original, 1), 'this one will be orphaned')
    await ctx.sleep(300)
    // Orphan it the only way that truly detaches: destroy the quote itself.
    await ctx.evalJs(`(async () => {
      const store = window.__sunaDev.commentsStore
      const s = store.getState()
      const next = s.comments.map((c) =>
        c.id === ${JSON.stringify(idDead)}
          ? { ...c, detached: true, target: { ...c.target, anchor: { quote: 'ZZ-NO-SUCH-PROSE-ZZ', prefix: '', suffix: '' } } }
          : c
      )
      store.setState({ comments: next })
    })()`)
    await ctx.sleep(400)

    await ctx.evalJs(`window.__sunaDev.uiStore.getState().setCommentsRailVisible(true)`)
    await ctx.sleep(500)

    // the outline row must exist and be clickable
    const clicked = await ctx.evalJs(`(() => {
      const row = document.querySelector('.cmt-outline__row[data-comment-id=${JSON.stringify(idDead)}]')
      if (row === null) return 'no outline row'
      row.click()
      return 'ok'
    })()`)
    check('a detached comment has a clickable outline row', clicked === 'ok', clicked)
    await ctx.sleep(600)

    // REAL visibility, not just a non-empty box: the card used to sit inside
    // a COLLAPSED <details>, where it still measures but no user can see or
    // click it. checkVisibility() and offsetParent both see through that;
    // getBoundingClientRect() does not, and a probe that trusted it passed
    // while the bug was live.
    const cardState = await ctx.evalJs(`(() => {
      const card = document.querySelector('.cmt-card[data-comment-id=${JSON.stringify(idDead)}]')
      if (card === null) return { found: false }
      const rect = card.getBoundingClientRect()
      const group = card.closest('details')
      const buttons = Array.from(card.querySelectorAll('button')).map((b) => b.textContent.trim())
      // does a click at the card's centre actually land inside the card?
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return {
        found: true,
        boxed: rect.width > 0 && rect.height > 0,
        shown: card.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
        attached: card.offsetParent !== null,
        groupOpen: group === null ? null : group.open,
        hittable: hit !== null && card.contains(hit),
        buttons
      }
    })()`)
    check(
      'clicking the outline OPENS the detached group',
      cardState.groupOpen === true,
      JSON.stringify(cardState)
    )
    check(
      'the detached comment\'s card is genuinely visible and clickable',
      cardState.found === true &&
        cardState.boxed === true &&
        cardState.shown === true &&
        cardState.attached === true &&
        cardState.hittable === true,
      JSON.stringify(cardState)
    )
    check(
      'the detached card offers Resolve and Delete',
      cardState.found === true &&
        cardState.buttons.some((b) => b === 'Resolve') &&
        cardState.buttons.some((b) => b === 'Delete'),
      JSON.stringify(cardState.buttons)
    )

    // Resolve really works on a detached comment
    await ctx.evalJs(`(() => {
      const card = document.querySelector('.cmt-card[data-comment-id=${JSON.stringify(idDead)}]')
      if (card === null) return 'no card'
      const btn = Array.from(card.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Resolve')
      if (btn === undefined) return 'no resolve button'
      btn.click()
      return 'ok'
    })()`)
    await ctx.sleep(700)
    const resolved = await commentById(idDead)
    check(
      'Resolve works on a detached comment',
      resolved !== null && resolved.resolved === true,
      JSON.stringify(resolved)
    )

    // ---- 3. Delete works on a detached comment too -------------------------
    const idDoomed = await addComment(pickQuote(original, 2), 'this one gets deleted')
    await ctx.evalJs(`(async () => {
      const store = window.__sunaDev.commentsStore
      store.setState({
        comments: store.getState().comments.map((c) =>
          c.id === ${JSON.stringify(idDoomed)}
            ? { ...c, detached: true, target: { ...c.target, anchor: { quote: 'ZZ-ALSO-GONE-ZZ', prefix: '', suffix: '' } } }
            : c
        )
      })
      store.getState().setActive(${JSON.stringify(idDoomed)})
    })()`)
    await ctx.sleep(700)
    const deleteClick = await ctx.evalJs(`(() => {
      const card = document.querySelector('.cmt-card[data-comment-id=${JSON.stringify(idDoomed)}]')
      if (card === null) return 'no card'
      const btn = Array.from(card.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Delete')
      if (btn === undefined) return 'no delete button'
      btn.click()
      return 'ok'
    })()`)
    check('Delete is reachable on a detached comment', deleteClick === 'ok', deleteClick)
    await ctx.sleep(900)
    const gone = await commentById(idDoomed)
    check('Delete removes a detached comment', gone === null, JSON.stringify(gone))
  } finally {
    // restore the copy: drop our comments, put the prose back
    for (const id of created) {
      await ctx
        .evalJs(`window.__sunaDev.commentsStore.getState().removeWithUndo(${JSON.stringify(id)})`)
        .catch(() => undefined)
    }
    writeFileSync(manuscriptPath, original, 'utf8')
    writeFileSync(join(rootDir, 'manuscript', 'comments.json'), originalComments, 'utf8')
    await ctx.sleep(500)
  }

  if (failures.length > 0) throw new Error(`${failures.length} check(s) failed: ${failures.join(', ')}`)
  console.log('comment re-anchor probe: all checks passed')
}

/** A distinctive prose quote from the manuscript, skipping headings. */
function pickQuote(text, skip = 0) {
  const lines = text.split('\n').filter((l) => !l.startsWith('#') && !l.startsWith('!') && l.trim().length >= 60)
  const line = lines[skip]
  if (line === undefined) throw new Error('no prose line long enough to anchor a probe comment')
  const quote = line.trim().slice(0, 48)
  if (text.indexOf(quote) !== text.lastIndexOf(quote)) {
    throw new Error(`probe quote is not unique: ${JSON.stringify(quote)}`)
  }
  return quote
}

function anchorFor(text, quote) {
  const from = text.indexOf(quote)
  const to = from + quote.length
  return {
    quote,
    prefix: text.slice(Math.max(0, from - 32), from),
    suffix: text.slice(to, to + 32)
  }
}
