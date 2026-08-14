#!/usr/bin/env node
/**
 * SUNA end-to-end smoke test. Launches the app with a CDP endpoint and
 * drives the full loop: open example project (a fresh COPY under userData)
 * → sidebar resize → reading mode (editable live preview; two-state toggle)
 * → canvas editing suite → sidebar views (explorer CRUD, manuscript outline
 * + the combined manuscript document with title page/section editors/
 * references/scroll-spy, figures, references, git commit, agent) —
 * asserting on real files inside the copy — then the layout and citation
 * rendering contract of docs/design/ui-fix-plan.md, *measured* off real
 * boxes (content-kind widths/wrapping, one manuscript measure, cross-ref
 * resolution, the "Rendered as" round trip, the references panel).
 *
 * Reset strategy: the userData example copy is deleted before launch, so
 * every run starts from the pristine examples/demo-paper and the git repo
 * created on open has exactly one "Initial commit". localStorage survives
 * that, so the two persisted view preferences (editor appearance, per-project
 * "Rendered as") are reset in the open step — see the note there.
 *
 * Usage:  node scripts/e2e/smoke.mjs        (or: pnpm smoke)
 * Exit 0 = all steps passed. Artifacts in scripts/e2e/.artifacts/.
 */
import { spawn, execSync, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ARTIFACTS = join(ROOT, 'scripts', 'e2e', '.artifacts')
const PORT = Number(process.env.SUNA_SMOKE_PORT ?? 9321)

// Electron userData for @suna/desktop (package.json name → nested dir).
const USER_DATA =
  process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', '@suna', 'desktop')
    : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), '@suna', 'desktop')
const COPY_DIR = join(USER_DATA, 'example-project')

mkdirSync(ARTIFACTS, { recursive: true })

// ---------------------------------------------------------------- CDP client
let ws
let msgId = 0
const pending = new Map()

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++msgId
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (r.exceptionDetails) {
    throw new Error(`page exception: ${JSON.stringify(r.exceptionDetails.exception ?? {}).slice(0, 400)}`)
  }
  return r.result.value
}

async function screenshot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(ARTIFACTS, name), Buffer.from(shot.data, 'base64'))
}

const mouse = (type, x, y) =>
  send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
const click = async (x, y) => {
  await mouse('mousePressed', x, y)
  await mouse('mouseReleased', x, y)
}
const key = (keyName, code, modifiers = 0) =>
  send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, modifiers })
    .then(() => send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, modifiers }))
const insertText = (text) => send('Input.insertText', { text })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- harness
const results = []
async function step(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`  ✓ ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error: String(error.message ?? error) })
    console.error(`  ✗ ${name}: ${error.message ?? error}`)
    await screenshot(`FAIL-${name}.png`).catch(() => {})
    throw error
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

/** Click an activity-bar view button by its title attribute. */
const activateView = (title) =>
  evalJs(`(() => {
    const btn = [...document.querySelectorAll('.activitybar__item')]
      .find((b) => b.title === ${JSON.stringify(title)});
    if (!btn) throw new Error('activity item missing: ${title}');
    btn.click();
  })()`)

/** Open the explorer context menu on the tree row whose name matches. */
const openTreeMenu = (name) =>
  evalJs(`(() => {
    const row = [...document.querySelectorAll('.tree__row')]
      .find((r) => r.textContent.trim().replace(/^[▾▸]\\s*/, '') === ${JSON.stringify(name)});
    if (!row) throw new Error('tree row missing: ${name}');
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2
    }));
  })()`)

const clickMenuItem = (label) =>
  evalJs(`(() => {
    const item = [...document.querySelectorAll('.ctxmenu__item')]
      .find((b) => b.textContent.startsWith(${JSON.stringify(label)}));
    if (!item) throw new Error('menu item missing: ${label}');
    item.click();
  })()`)

/**
 * Show a sidebar view without the toggle trap: clicking an already-active
 * activity item HIDES the sidebar, so set the store instead.
 */
const showView = (view) =>
  evalJs(
    `window.__sunaDev.uiStore.setState({ activeView: ${JSON.stringify(view)}, sidebarVisible: true })`
  )

/** Set a React-controlled <input>/<textarea>/<select> the way a user would. */
const setFieldJs = (selectorJs, value, tag = 'HTMLInputElement') =>
  `(() => {
    const el = ${selectorJs};
    if (!el) throw new Error('field missing: ' + ${JSON.stringify(selectorJs)});
    const set = Object.getOwnPropertyDescriptor(window.${tag}.prototype, 'value').set;
    el.focus();
    set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('${tag === 'HTMLSelectElement' ? 'change' : 'input'}', { bubbles: true }));
    return true;
  })()`

/**
 * Drag-select `phrase` inside a manuscript section editor with real mouse
 * events (a synthetic DOM Selection is discarded by CodeMirror). Returns the
 * text CodeMirror ended up with selected.
 */
async function dragSelectInSection(phrase) {
  // Scroll the phrase into view first: an off-screen rect would send the
  // mouse press to whatever else happens to sit at those coordinates.
  const locate = `(() => {
    const P = ${JSON.stringify(phrase)};
    for (const host of document.querySelectorAll('.msdoc__editor')) {
      const content = host.querySelector('.cm-content');
      if (!content || !content.textContent.includes(P)) continue;
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const i = node.textContent.indexOf(P);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(node, i); r.setEnd(node, i + P.length);
        return { range: r, node };
      }
    }
    return null;
  })()`
  const scrolled = await evalJs(`(() => {
    const hit = ${locate};
    if (hit === null) return false;
    const el = hit.node.parentElement;
    if (el) el.scrollIntoView({ block: 'center' });
    return true;
  })()`)
  if (!scrolled) return null
  await sleep(400)
  const rect = await evalJs(`(() => {
    const hit = ${locate};
    if (hit === null) return null;
    const b = hit.range.getBoundingClientRect();
    const onScreen = b.width > 0 && b.top > 40 && b.bottom < window.innerHeight - 40;
    return { x: b.x, y: b.y, w: b.width, h: b.height, onScreen };
  })()`)
  if (rect === null) return null
  if (!rect.onScreen) {
    throw new Error(
      `"${phrase}" is not on screen (top ${Math.round(rect.y)}, height ${Math.round(rect.h)})`
    )
  }
  const y = rect.y + rect.h / 2
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: rect.x + 0.5, y, button: 'left', clickCount: 1
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: rect.x + rect.w / 2, y, button: 'left', buttons: 1
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: rect.x + rect.w - 0.5, y, button: 'left', buttons: 1
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: rect.x + rect.w - 0.5, y, button: 'left', clickCount: 1
  })
  await sleep(220)
  return evalJs(`window.getSelection().toString()`)
}

/** Re-run the comments store's load — what a refresh does — and read it back. */
const reloadComments = () =>
  evalJs(`(async () => {
    const root = window.__sunaDev.projectStore.getState().rootDir;
    window.__sunaDev.commentsStore.setState({ loaded: false, loading: false });
    await window.__sunaDev.commentsStore.getState().load(root);
    const s = window.__sunaDev.commentsStore.getState();
    return {
      count: s.comments.length,
      detached: s.comments.map((c) => c.detached),
      authors: s.comments.map((c) => c.author.kind),
      bodies: s.comments.map((c) => c.body),
      anchorsInDom: document.querySelectorAll('.cm-content .cmt-anchor').length,
      lineDots: document.querySelectorAll('.cm-line.cmt-line-dot').length,
      detachedChips: document.querySelectorAll('.cmt__detached').length
    };
  })()`)

const MCP_PROBE = join(ROOT, 'scripts', 'e2e', 'mcp-probe.mjs')

/** Build the standalone MCP bundle if it is not there yet (esbuild, ~50 ms). */
function ensureMcpBundle() {
  if (existsSync(join(ROOT, 'packages', 'agent', 'dist-mcp', 'server.mjs'))) return
  execSync('node build-mcp.mjs', { cwd: join(ROOT, 'packages', 'agent'), stdio: 'ignore' })
}

/** Call one tool on the bundled MCP server over real stdio JSON-RPC. */
function mcpCall(projectDir, name, args) {
  ensureMcpBundle()
  return execFileSync(
    process.execPath,
    [MCP_PROBE, '--project', projectDir, '--call', name, JSON.stringify(args)],
    { cwd: ROOT, encoding: 'utf8' }
  )
}

// ---------------------------------------------------------------- run
console.log('SUNA smoke test')
try {
  execSync('pkill -f "electron-vite dev" ; pkill -f "Electron.app/Contents/MacOS/Electron"', {
    stdio: 'ignore', shell: '/bin/bash'
  })
} catch { /* nothing to kill */ }
await sleep(500)

// Fresh example copy every run (see header).
rmSync(COPY_DIR, { recursive: true, force: true })

const child = spawn('pnpm', ['dev'], {
  cwd: join(ROOT, 'apps', 'desktop'),
  env: { ...process.env, SUNA_DEBUG_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true
})
const devLog = []
child.stdout.on('data', (d) => devLog.push(String(d)))
child.stderr.on('data', (d) => devLog.push(String(d)))

function cleanup() {
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch { /* already gone */ }
  try {
    execSync('pkill -f "Electron.app/Contents/MacOS/Electron"', { stdio: 'ignore' })
  } catch { /* already gone */ }
}
process.on('exit', cleanup)

let FIGURE = null // <copy>/figures/fig-spectrum/figure.svg — known after open
let originalSvg = null

let exitCode = 0
try {
  // wait for CDP
  let target = null
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline && !target) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find((t) => t.type === 'page')
    } catch { /* not up yet */ }
    if (!target) await sleep(500)
  }
  assert(target, `no CDP page target on :${PORT} after 60s\n${devLog.join('').slice(-2000)}`)

  ws = new WebSocket(target.webSocketDebuggerUrl)
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    const p = msg.id && pending.get(msg.id)
    if (p) {
      pending.delete(msg.id)
      msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result)
    }
  }
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('CDP websocket failed'))
  })
  await sleep(1500)

  await step('app-loads-welcome', async () => {
    const ok = await evalJs(`!!document.querySelector('.welcome__title')`)
    assert(ok, 'welcome screen not rendered')
  })

  await step('open-example-project', async () => {
    await evalJs(`(() => {
      const btn = [...document.querySelectorAll('.welcome__actions button')]
        .find((b) => b.textContent.includes('example'));
      if (!btn) throw new Error('Open example button missing');
      btn.click();
    })()`)
    // copy + git init + tree listing take a moment on first open
    const openDeadline = Date.now() + 20_000
    let rootDir = null
    while (Date.now() < openDeadline && !rootDir) {
      rootDir = await evalJs(
        `window.__sunaDev ? window.__sunaDev.projectStore.getState().rootDir : null`
      )
      if (!rootDir) await sleep(400)
    }
    assert(rootDir, 'project rootDir still null after open-example')
    assert(
      rootDir === COPY_DIR,
      `open-example landed at ${rootDir}, expected the userData copy ${COPY_DIR}`
    )
    FIGURE = join(rootDir, 'figures', 'fig-spectrum', 'figure.svg')
    originalSvg = readFileSync(FIGURE, 'utf8')
    // Normalize the two persisted view preferences before anything asserts on
    // them: the editor appearance store (localStorage) and the per-project
    // 'Rendered as' override. The example COPY is recreated every run but
    // localStorage is not, so without this a run that ended on MNRAS would
    // decide the *next* run's citation numbering.
    await evalJs(`(() => {
      window.__sunaDev.editorSettings.getState().reset();
      window.__sunaDev.renderProfileStore.setState({ byProject: {} });
    })()`)
    await sleep(1200)
    const state = await evalJs(`({
      profile: document.querySelector('.statusbar__profile')?.textContent ?? null,
      tree: !!document.querySelector('.tree')
    })`)
    assert(state.profile === 'Nature Astronomy', `profile chip: ${state.profile}`)
    assert(state.tree, 'explorer tree missing')
    assert(existsSync(join(rootDir, '.git')), 'example copy was not git-initialized')
    await screenshot('01-project-open.png')
  })

  await step('editor-opens-section', async () => {
    const text = await evalJs(`document.querySelector('.cm-content')?.textContent ?? ''`)
    assert(text.includes('Galaxies falling'), 'intro section not in editor')
  })

  await step('sidebar-resize', async () => {
    // normalize (a previous aborted run may have left a persisted width)
    await evalJs(`document.querySelector('.sidebar__resize')
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
    await sleep(200)
    const start = await evalJs(
      `document.querySelector('.sidebar').getBoundingClientRect().width`
    )
    assert(Math.round(start) === 272, `sidebar default width: ${start} (want 272)`)

    // drag the gold handle 60px right via real pointer input
    const h = await evalJs(`(() => {
      const el = document.querySelector('.sidebar__resize');
      if (!el) throw new Error('sidebar resize handle missing');
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`)
    await mouse('mousePressed', h.x, h.y)
    for (let i = 1; i <= 6; i++) {
      await mouse('mouseMoved', h.x + i * 10, h.y)
      await sleep(30)
    }
    await mouse('mouseReleased', h.x + 60, h.y)
    await sleep(300)
    const after = await evalJs(`({
      width: document.querySelector('.sidebar').getBoundingClientRect().width,
      store: window.__sunaDev.uiStore.getState().sidebarWidth,
      saved: window.localStorage.getItem('suna.sidebarWidth')
    })`)
    // release point is +60px from the handle CENTER (4px wide) → ±5px slack
    assert(
      Math.abs(after.width - (start + 60)) <= 5,
      `drag +60px: width ${start} → ${after.width} (want ~${start + 60})`
    )
    assert(after.store === Math.round(after.width), `store width ${after.store} ≠ DOM ${after.width}`)
    assert(
      after.saved === String(after.store),
      `localStorage suna.sidebarWidth = ${after.saved} (want ${after.store})`
    )

    // double-click resets to the 272px default, also persisted
    await evalJs(`document.querySelector('.sidebar__resize')
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
    await sleep(200)
    const reset = await evalJs(`({
      width: document.querySelector('.sidebar').getBoundingClientRect().width,
      saved: window.localStorage.getItem('suna.sidebarWidth')
    })`)
    assert(Math.round(reset.width) === 272, `dblclick reset width: ${reset.width} (want 272)`)
    assert(reset.saved === '272', `reset not persisted: ${reset.saved}`)
  })

  await step('reading-mode', async () => {
    // modes are two-state: the button (or ⌘E) toggles Source ⇄ Reading, and
    // Reading — the *editable* live preview — is the default markdown mode,
    // so a freshly opened section is already there.
    const opened = await evalJs(`document.querySelector('.editor-tab__mode').textContent`)
    assert(opened === 'Reading', `markdown should open in Reading, got ${opened}`)
    // round-trip through Source proves the toggle still works both ways
    await evalJs(`document.querySelector('.editor-tab__mode').click()`)
    await sleep(400)
    const toggled = await evalJs(`document.querySelector('.editor-tab__mode').textContent`)
    assert(toggled === 'Source', `toggle from Reading gave ${toggled} (want Source)`)
    await evalJs(`document.querySelector('.editor-tab__mode').click()`)
    await sleep(500)
    const label = await evalJs(`document.querySelector('.editor-tab__mode').textContent`)
    assert(label === 'Reading', `mode after toggling back: ${label} (want Reading)`)
    const before = await evalJs(`({
      katex: !!document.querySelector('.cm-content .katex'),
      block: !!document.querySelector('.cm-content .cm-lp-math-block'),
      cite: !!document.querySelector('.cm-content .cm-lp-cite'),
      raw: (document.querySelector('.cm-content')?.textContent ?? '').includes('$$')
    })`)
    assert(before.katex, 'KaTeX widget missing from CodeMirror DOM in reading mode')
    assert(before.block, 'display-math block widget missing in reading mode')
    assert(before.cite, 'citation chip missing in reading mode')
    assert(!before.raw, 'raw $$ visible while display math is rendered')
    await screenshot('reading-mode.png')

    // click into the rendered math → decoration drops, raw $$ source at cursor
    const p = await evalJs(`(() => {
      const el = document.querySelector('.cm-lp-math-block');
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`)
    await click(p.x, p.y)
    await sleep(400)
    const revealed = await evalJs(`({
      raw: (document.querySelector('.cm-content')?.textContent ?? '').includes('$$'),
      widget: !!document.querySelector('.cm-lp-math-block'),
      cursorLine: document.querySelector('.cm-activeLine')?.textContent ?? ''
    })`)
    assert(revealed.raw, 'clicking math did not reveal raw $$ source')
    assert(!revealed.widget, 'block widget still rendered while cursor is inside it')
    assert(
      revealed.cursorLine.includes('$$') || revealed.cursorLine.includes('P_'),
      `cursor not inside the math source (active line: ${revealed.cursorLine.slice(0, 60)})`
    )

    // move the cursor out of the math range → widget re-renders
    for (let i = 0; i < 5; i++) await key('ArrowUp', 'ArrowUp')
    await sleep(400)
    const after = await evalJs(`({
      widget: !!document.querySelector('.cm-lp-math-block .katex'),
      raw: (document.querySelector('.cm-content')?.textContent ?? '').includes('$$')
    })`)
    assert(after.widget, 'math widget did not re-render after cursor left')
    assert(!after.raw, 'raw $$ still visible after cursor left the math range')

    // the reading surface stays editable: type → doc changes → undo reverts
    await insertText('QQSMOKE')
    await sleep(300)
    const typed = await evalJs(
      `(document.querySelector('.cm-content')?.textContent ?? '').includes('QQSMOKE')`
    )
    assert(typed, 'typing in reading mode did not change the document')
    await key('z', 'KeyZ', 4) // ⌘Z
    await sleep(300)
    const reverted = await evalJs(
      `!(document.querySelector('.cm-content')?.textContent ?? '').includes('QQSMOKE')`
    )
    assert(reverted, 'undo did not revert the reading-mode edit')

    await evalJs(`document.querySelector('.editor-tab__mode').click()`) // Reading → Source
    await sleep(300)
    const back = await evalJs(`document.querySelector('.editor-tab__mode').textContent`)
    assert(back === 'Source', `mode label after toggle back: ${back} (want Source)`)
  })

  await step('canvas-opens-figure', async () => {
    await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(FIGURE)})`)
    await sleep(1500)
    const r = await evalJs(`({
      svg: !!document.querySelector('.canvas-world svg'),
      artboard: document.querySelector('.canvas-tab__meta')?.textContent ?? ''
    })`)
    assert(r.svg, 'figure SVG not mounted on canvas')
    assert(r.artboard.includes('180.0'), `artboard label: ${r.artboard}`)
    await screenshot('03-canvas.png')
  })

  await step('compliance-clean', async () => {
    const chip = await evalJs(`document.querySelector('.canvas-tab__issues')?.textContent ?? null`)
    if (chip !== null) {
      await evalJs(`document.querySelector('.canvas-tab__issues').click()`)
      await sleep(200)
      const msgs = await evalJs(
        `[...document.querySelectorAll('.canvas-diagnostics__msg')].map((e) => e.textContent)`
      )
      throw new Error(`example figure should be compliant, got: ${chip} — ${msgs.join(' | ')}`)
    }
  })

  await step('canvas-drag-and-save', async () => {
    // probe inside the target's bbox for a point that actually hits it
    // (text glyphs have gaps; frameless legends are mostly holes)
    const center = await evalJs(`(() => {
      const id = 'ax0.title.left';
      const el = document.querySelector('.canvas-world svg [id="' + id + '"]');
      if (!el) throw new Error(id + ' not found in mounted SVG');
      const r = el.getBoundingClientRect();
      for (let iy = 1; iy < 6; iy++) {
        for (let ix = 1; ix < 6; ix++) {
          const x = r.left + (r.width * ix) / 6;
          const y = r.top + (r.height * iy) / 6;
          const hit = document.elementFromPoint(x, y);
          if (hit && (hit.closest('[id="' + id + '"]') !== null)) return { x, y };
        }
      }
      throw new Error('no hittable point found inside ' + id);
    })()`)
    await mouse('mousePressed', center.x, center.y)
    for (let i = 1; i <= 6; i++) {
      await mouse('mouseMoved', center.x + i * 5, center.y + i * 3)
      await sleep(30)
    }
    await mouse('mouseReleased', center.x + 30, center.y + 18)
    await sleep(400)
    await key('s', 'KeyS', 4) // ⌘S
    await sleep(600)
    const edited = readFileSync(FIGURE, 'utf8')
    const diff = edited.split('\n').filter((line, i) => line !== originalSvg.split('\n')[i])
    assert(edited !== originalSvg, 'file did not change after drag+save')
    assert(diff.length === 1 && diff[0].includes('transform='),
      `expected a 1-line transform diff, got ${diff.length} differing lines`)
    await screenshot('04-dragged.png')
  })

  await step('canvas-undo-restores-bytes', async () => {
    await key('z', 'KeyZ', 4) // ⌘Z
    await sleep(300)
    await key('s', 'KeyS', 4)
    await sleep(600)
    const restored = readFileSync(FIGURE, 'utf8')
    assert(restored === originalSvg, 'undo+save did not restore byte-identical file')
  })

  // ---- editing suite (canvas-editing-suite.md §10) --------------------------
  const focusCanvas = () =>
    evalJs(`(() => {
      const vp = document.querySelector('.canvas-viewport');
      if (!vp) throw new Error('canvas viewport missing');
      vp.focus();
      return document.activeElement === vp;
    })()`)

  /** The one tag carrying id="<id>" in an SVG string ([^>]* stays in-tag). */
  function tagWithId(svg, id) {
    const m = new RegExp('<([a-zA-Z]+)[^>]*\\bid="' + id + '"[^>]*>').exec(svg)
    assert(m, `element id="${id}" not found in saved file`)
    return { name: m[1], markup: m[0] }
  }

  /** Rendered width (screen px) of a mirror element — zoom is held constant. */
  const mirrorWidth = (id) =>
    evalJs(
      `document.querySelector('.canvas-world svg [id="${id}"]').getBoundingClientRect().width`
    )

  let rectId = null

  await step('create-rect', async () => {
    await evalJs(`window.__sunaDev.canvasTools.setTool('rect')`)
    const from = await evalJs(`(() => {
      const r = document.querySelector('.canvas-world svg').getBoundingClientRect();
      return { x: r.left + r.width * 0.16, y: r.top + r.height * 0.16 };
    })()`)
    await mouse('mousePressed', from.x, from.y)
    for (let i = 1; i <= 5; i++) {
      await mouse('mouseMoved', from.x + i * 12, from.y + i * 8)
      await sleep(30)
    }
    await mouse('mouseReleased', from.x + 60, from.y + 40)
    await sleep(400)
    const state = await evalJs(`({
      sel: window.__sunaDev.canvasTools.getSelection(),
      tool: window.__sunaDev.canvasTools.getToolState().tool
    })`)
    assert(state.tool === 'select', `tool after creation: ${state.tool} (want select)`)
    assert(
      state.sel.length === 1 && /^suna-e\d+$/.test(state.sel[0]),
      `expected one new suna-e* id selected, got ${JSON.stringify(state.sel)}`
    )
    rectId = state.sel[0]
    await focusCanvas()
    await key('s', 'KeyS', 4)
    await sleep(600)
    const el = tagWithId(readFileSync(FIGURE, 'utf8'), rectId)
    assert(el.name === 'rect', `id="${rectId}" is a <${el.name}>, want <rect>`)
    // Nature Astronomy palette[0] is #000000 (spec §4: profile defaults).
    assert(
      el.markup.includes('fill="#000000"'),
      `new rect misses profile default fill: ${el.markup}`
    )
    assert(!el.markup.includes('stroke='), `new rect should carry no stroke: ${el.markup}`)
  })

  /** Panels default open only at ≥1200px windows; expand when collapsed. */
  const expandPanel = async (probeSelector, expandTitle) => {
    await evalJs(`(() => {
      if (document.querySelector('${probeSelector}')) return;
      const btn = [...document.querySelectorAll('.canvas-side__expand')]
        .find((b) => b.title === '${expandTitle}');
      if (!btn) throw new Error('${expandTitle} button missing');
      btn.click();
    })()`)
    await sleep(250)
  }

  await step('style-edit', async () => {
    await expandPanel('.canvas-props', 'Show properties')
    // Rect is still selected: pick the Wong orange chip from the fill palette.
    const clicked = await evalJs(`(() => {
      const chip = [...document.querySelectorAll('.canvas-props__chip')]
        .find((c) => c.title.toLowerCase() === '#e69f00');
      if (!chip) return false;
      chip.click();
      return true;
    })()`)
    assert(clicked, 'fill palette chip #e69f00 not found in properties panel')
    await sleep(300)
    await focusCanvas()
    await key('s', 'KeyS', 4)
    await sleep(600)
    const el = tagWithId(readFileSync(FIGURE, 'utf8'), rectId)
    assert(
      el.markup.includes('fill="#e69f00"'),
      `set-style fill did not land in saved file: ${el.markup}`
    )
  })

  await step('resize-handle', async () => {
    const before = await mirrorWidth(rectId)
    const h = await evalJs(`(() => {
      const el = document.querySelector('.canvas-overlay__handle[data-handle="se"]');
      if (!el) throw new Error('SE resize handle not rendered');
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`)
    await mouse('mousePressed', h.x, h.y)
    for (let i = 1; i <= 5; i++) {
      await mouse('mouseMoved', h.x + i * 8, h.y + i * 5)
      await sleep(30)
    }
    await mouse('mouseReleased', h.x + 40, h.y + 25)
    await sleep(400)
    const after = await mirrorWidth(rectId)
    assert(after > before + 10, `SE handle drag did not grow width: ${before} → ${after}`)
    await focusCanvas()
    await key('s', 'KeyS', 4)
    await sleep(600)
    const el = tagWithId(readFileSync(FIGURE, 'utf8'), rectId)
    assert(
      el.markup.includes('transform="matrix('),
      `resize transform missing from saved rect: ${el.markup}`
    )
  })

  await step('text-tool', async () => {
    await evalJs(`window.__sunaDev.canvasTools.setTool('text')`)
    const at = await evalJs(`(() => {
      const r = document.querySelector('.canvas-world svg').getBoundingClientRect();
      return { x: r.left + r.width * 0.62, y: r.top + r.height * 0.2 };
    })()`)
    await mouse('mousePressed', at.x, at.y)
    await mouse('mouseReleased', at.x, at.y)
    await sleep(400)
    const editing = await evalJs(`!!document.querySelector('.canvas-text-edit')`)
    assert(editing, 'text edit overlay did not open after T-click')
    await insertText('Halpha test') // replaces the select-all placeholder
    await sleep(150)
    await key('Enter', 'Enter')
    await sleep(400)
    await focusCanvas()
    await key('s', 'KeyS', 4)
    await sleep(600)
    const saved = readFileSync(FIGURE, 'utf8')
    assert(
      /<text[^>]*>Halpha test<\/text>/.test(saved),
      'committed text "Halpha test" not found in saved file'
    )
  })

  await step('editing-ui-screenshot', async () => {
    await expandPanel('.canvas-layers', 'Show layers')
    await expandPanel('.canvas-props', 'Show properties')
    const ui = await evalJs(`({
      rail: !!document.querySelector('.canvas-toolrail'),
      layers: !!document.querySelector('.canvas-layers'),
      props: !!document.querySelector('.canvas-props'),
      shape: !!document.querySelector('.canvas-world svg [id="${rectId}"]')
    })`)
    assert(ui.rail, 'tool rail missing from editing UI')
    assert(ui.layers, 'layers panel missing from editing UI')
    assert(ui.props, 'properties panel missing from editing UI')
    assert(ui.shape, 'created rect not visible in mirror for screenshot')
    await screenshot('editing-suite.png')
  })

  await step('undo-chain', async () => {
    await focusCanvas()
    // 5 history entries were created above; extra ⌘Z presses are no-ops.
    for (let i = 0; i < 12; i++) {
      await key('z', 'KeyZ', 4)
      await sleep(120)
    }
    await key('s', 'KeyS', 4)
    await sleep(700)
    const restored = readFileSync(FIGURE, 'utf8')
    assert(
      restored === originalSvg,
      'undo chain + save did not restore the byte-identical pre-editing file'
    )
  })

  // ---- sidebar views --------------------------------------------------------

  await step('explorer-create-rename-delete', async () => {
    // create: context menu on a root file targets the project root
    // (suna.json is the only unambiguous root file — README.md also exists in code/)
    await openTreeMenu('suna.json')
    await sleep(200)
    await clickMenuItem('New File')
    await sleep(300)
    const focused = await evalJs(
      `document.activeElement?.className === 'tree__edit-input'`
    )
    assert(focused, 'inline create input did not appear/focus')
    await insertText('scratch-e2e.txt')
    await key('Enter', 'Enter')
    await sleep(700)
    assert(existsSync(join(COPY_DIR, 'scratch-e2e.txt')), 'created file missing on disk')
    const rowShown = await evalJs(`[...document.querySelectorAll('.tree__row')]
      .some((r) => r.textContent.includes('scratch-e2e.txt'))`)
    assert(rowShown, 'created file not listed in the tree')

    // rename: basename is pre-selected, typing replaces it and keeps .txt
    await openTreeMenu('scratch-e2e.txt')
    await sleep(200)
    await clickMenuItem('Rename')
    await sleep(300)
    await insertText('renamed-e2e')
    await key('Enter', 'Enter')
    await sleep(700)
    assert(!existsSync(join(COPY_DIR, 'scratch-e2e.txt')), 'old name still on disk after rename')
    assert(existsSync(join(COPY_DIR, 'renamed-e2e.txt')), 'renamed file missing on disk')

    // delete: two-step arm → confirm, file goes to the trash
    await openTreeMenu('renamed-e2e.txt')
    await sleep(200)
    await clickMenuItem('Delete')
    await sleep(200)
    await screenshot('views-explorer.png') // context menu with armed delete
    await clickMenuItem('Confirm delete?')
    await sleep(700)
    assert(!existsSync(join(COPY_DIR, 'renamed-e2e.txt')), 'deleted file still on disk')
    const rowGone = await evalJs(`![...document.querySelectorAll('.tree__row')]
      .some((r) => r.textContent.includes('renamed-e2e.txt'))`)
    assert(rowGone, 'deleted file still listed in the tree')
  })

  await step('manuscript-view', async () => {
    await activateView('Manuscript')
    await sleep(600)
    const outline = await evalJs(
      `[...document.querySelectorAll('.ms__row .ms__row-label')].map((e) => e.textContent)`
    )
    assert(
      outline.length === 4,
      `outline should list 4 sections, got ${outline.length}: ${outline.join(', ')}`
    )
    assert(
      outline[0] === 'untitled' &&
        outline[1] === 'Results' &&
        outline[2] === 'Discussion' &&
        outline[3] === 'Methods',
      `unexpected outline: ${outline.join(', ')}`
    )
    const meta = await evalJs(
      `[...document.querySelectorAll('.ms__meta')].map((e) => e.textContent).join(' | ')`
    )
    assert(meta.includes('2 authors'), `author count missing: ${meta}`)
    assert(meta.includes('2 figures') && meta.includes('1 table'), `figure/table counts: ${meta}`)
    await screenshot('views-manuscript.png')
    // clicking an outline row opens the combined document and scrolls to it
    await evalJs(`[...document.querySelectorAll('.ms__row')]
      .find((r) => r.textContent.includes('Results')).click()`)
    const spyDeadline = Date.now() + 8_000
    let spy = null
    while (Date.now() < spyDeadline) {
      spy = await evalJs(`({
        tab: !!document.querySelector('.msdoc'),
        tabActive: window.__sunaDev.manuscriptDocStore.getState().tabActive,
        active: window.__sunaDev.manuscriptDocStore.getState().activeSectionIndex
      })`)
      if (spy.tab && spy.tabActive && spy.active === 1) break
      await sleep(300)
    }
    assert(spy.tab, 'combined manuscript tab did not open from the outline click')
    assert(spy.tabActive, 'manuscript tab is not the frontmost dock panel')
    assert(
      spy.active === 1,
      `outline click should scroll to Results (index 1), active is ${spy.active}`
    )
  })

  await step('manuscript-doc', async () => {
    // the view's button opens (here: refocuses) the combined document tab
    // (Manuscript view is usually still active — re-activating would TOGGLE
    // the sidebar closed, so only activate when the view is not showing)
    if (!(await evalJs(`!!document.querySelector('.ms__open')`))) {
      await activateView('Manuscript')
      await sleep(400)
    }
    await evalJs(`document.querySelector('.ms__open').click()`)
    // four live section editors, one CodeMirror per body section
    const edDeadline = Date.now() + 10_000
    let editors = 0
    while (Date.now() < edDeadline && editors !== 4) {
      editors = await evalJs(
        `document.querySelectorAll('.msdoc__editor .cm-content').length`
      )
      if (editors !== 4) await sleep(300)
    }
    assert(editors === 4, `expected 4 section editors, got ${editors}`)

    // title page: KaTeX title, authors with affiliation superscripts,
    // numbered affiliations, Abstract + Significance front-matter blocks
    const tp = await evalJs(`({
      title: document.querySelector('.msdoc__title')?.textContent ?? '',
      titleKatex: !!document.querySelector('.msdoc__title .katex'),
      authors: [...document.querySelectorAll('.msdoc__author')].map((a) => a.textContent),
      adaSup: document.querySelector('.msdoc__author sup')?.textContent ?? null,
      affiliations: document.querySelectorAll('.msdoc__affiliations div').length,
      correspondence: document.querySelector('.msdoc__correspondence')?.textContent ?? '',
      labels: [...document.querySelectorAll('.msdoc__label')].map((e) => e.textContent)
    })`)
    assert(
      tp.title.includes('Rapid quenching by ram-pressure stripping'),
      `title page title: ${tp.title.slice(0, 80)}`
    )
    assert(tp.titleKatex, 'title math ($z = 1.7$) not rendered through KaTeX')
    assert(
      tp.authors.some((a) => a.includes('Ada Researcher')) &&
        tp.authors.some((a) => a.includes('Ben Collaborator')),
      `authors line: ${tp.authors.join(' | ')}`
    )
    assert(tp.adaSup === '1,*', `Ada's superscript markers: ${tp.adaSup} (want 1,*)`)
    assert(tp.affiliations === 2, `affiliation lines: ${tp.affiliations} (want 2)`)
    assert(
      tp.correspondence.includes('ada@observatory.edu'),
      `correspondence line: ${tp.correspondence}`
    )
    assert(
      tp.labels.includes('Abstract') && tp.labels.includes('Significance'),
      `front-matter labels: ${tp.labels.join(', ')}`
    )
    assert(tp.labels.includes('References'), 'References block missing from the document')

    // references numbered by first appearance: gunn1972 is cited first (intro)
    const refs = await evalJs(`({
      count: document.querySelectorAll('.msdoc__ref').length,
      unknown: document.querySelectorAll('.msdoc__ref--unknown').length,
      firstNum: document.querySelector('.msdoc__ref .msdoc__ref-num')?.textContent ?? null,
      firstText: document.querySelector('.msdoc__ref')?.textContent ?? ''
    })`)
    assert(refs.count === 11, `expected 11 references (all cited), got ${refs.count}`)
    assert(refs.unknown === 0, `${refs.unknown} citation keys missing from references.bib`)
    assert(refs.firstNum === '1.', `first reference number: ${refs.firstNum} (want 1.)`)
    assert(
      refs.firstText.includes('Gunn'),
      `entry 1 should be gunn1972 (first-cited): ${refs.firstText.slice(0, 80)}`
    )

    // title page + first section screenshot from the top of the document
    await evalJs(`document.querySelector('.msdoc').scrollTop = 0`)
    await sleep(600)
    await screenshot('manuscript-doc.png')

    // outline click → smooth scroll to Methods; scroll-spy marks the row
    await evalJs(`[...document.querySelectorAll('.ms__row')]
      .find((r) => r.textContent.includes('Methods')).click()`)
    const methodsDeadline = Date.now() + 8_000
    let active = -1
    while (Date.now() < methodsDeadline && active !== 3) {
      active = await evalJs(
        `window.__sunaDev.manuscriptDocStore.getState().activeSectionIndex`
      )
      if (active !== 3) await sleep(300)
    }
    assert(active === 3, `after Methods click, active section is ${active} (want 3)`)
    const outline = await evalJs(`({
      activeLabel: document.querySelector('.ms__row--active .ms__row-label')?.textContent ?? null,
      counts: [...document.querySelectorAll('.ms__count')].map((e) => Number(e.textContent))
    })`)
    assert(
      outline.activeLabel === 'Methods',
      `outline active row: ${outline.activeLabel} (want Methods)`
    )
    assert(
      outline.counts.length === 4 && outline.counts.every((c) => Number.isFinite(c) && c > 0),
      `per-section word counts missing/empty: ${outline.counts.join(', ')}`
    )
    await screenshot('manuscript-outline-active.png')

    // ⌘S routes to the focused section only: edit Methods, save, restore
    const methodsPath = join(COPY_DIR, 'manuscript', 'sections', '04-methods.md')
    const methodsOriginal = readFileSync(methodsPath, 'utf8')
    const line = await evalJs(`(() => {
      const ed = document.querySelectorAll('.msdoc__editor')[3];
      const l = ed.querySelector('.cm-line');
      if (!l) throw new Error('Methods section has no rendered lines');
      const r = l.getBoundingClientRect();
      return { x: r.left + Math.min(30, r.width / 2), y: r.top + r.height / 2 };
    })()`)
    await click(line.x, line.y)
    await sleep(200)
    await insertText('QQSMOKE ')
    await sleep(200)
    await key('s', 'KeyS', 4) // ⌘S
    await sleep(700)
    assert(
      readFileSync(methodsPath, 'utf8').includes('QQSMOKE'),
      '⌘S in the Methods editor did not save sections/04-methods.md'
    )
    await key('z', 'KeyZ', 4) // ⌘Z
    await sleep(200)
    await key('s', 'KeyS', 4)
    await sleep(700)
    assert(
      readFileSync(methodsPath, 'utf8') === methodsOriginal,
      'undo+save did not restore the Methods section byte-identical'
    )
  })

  await step('figures-view', async () => {
    await activateView('Figures')
    await sleep(800)
    const cards = await evalJs(`({
      names: [...document.querySelectorAll('.figs__name')].map((e) => e.textContent),
      thumbs: document.querySelectorAll('.figs__thumb img').length
    })`)
    assert(
      cards.names.length === 2 &&
        cards.names.includes('fig-spectrum') &&
        cards.names.includes('fig-velocity-map'),
      `figure cards: ${cards.names.join(', ')}`
    )
    assert(cards.thumbs === 2, `expected 2 SVG thumbnails, got ${cards.thumbs}`)
    await screenshot('views-figures.png')
    // clicking a card opens that figure on the canvas
    await evalJs(`[...document.querySelectorAll('.figs__card')]
      .find((c) => c.textContent.includes('fig-velocity-map')).click()`)
    await sleep(1500)
    const r = await evalJs(`({
      svg: !!document.querySelector('.canvas-world svg'),
      artboard: document.querySelector('.canvas-tab__meta')?.textContent ?? ''
    })`)
    assert(r.svg, 'velocity-map SVG not mounted on canvas')
    assert(r.artboard.includes('88.0'), `velocity-map artboard label: ${r.artboard}`)
    const chip = await evalJs(`document.querySelector('.canvas-tab__issues')?.textContent ?? null`)
    assert(chip === null, `velocity-map should be compliant (300 dpi raster), got: ${chip}`)
  })

  await step('references-view', async () => {
    await activateView('References')
    await sleep(800)
    const rows = await evalJs(`document.querySelectorAll('.refs__row').length`)
    assert(rows === 11, `expected 11 reference rows, got ${rows}`)
    const before = await evalJs(
      `document.querySelector('.refs__preview')?.textContent ?? ''`
    )
    assert(before !== '', 'rendered reference preview is empty')
    await screenshot('views-references.png')
    // toggling the style profile re-renders the reference differently
    await evalJs(`[...document.querySelectorAll('.refs__style')]
      .find((b) => b.textContent === 'MNRAS').click()`)
    await sleep(400)
    const after = await evalJs(`({
      text: document.querySelector('.refs__preview')?.textContent ?? '',
      pressed: [...document.querySelectorAll('.refs__style')]
        .find((b) => b.textContent === 'MNRAS').getAttribute('aria-pressed')
    })`)
    assert(after.pressed === 'true', 'MNRAS style button did not activate')
    assert(
      after.text !== '' && after.text !== before,
      'rendered reference did not change between profiles'
    )
  })

  await step('git-view', async () => {
    // dirty the copy through the app's own fs channel, then open the view
    await evalJs(`(async () => {
      const root = window.__sunaDev.projectStore.getState().rootDir;
      const path = root + '/README.md';
      const { content } = await window.suna.invoke('fs:read-text', { path });
      await window.suna.invoke('fs:write-text', {
        path, content: content + '\\nSmoke-edit marker.\\n'
      });
      return true;
    })()`)
    await activateView('Source Control')
    await sleep(900)
    const state = await evalJs(`({
      branch: document.querySelector('.git__branch')?.textContent?.trim() ?? null,
      changes: [...document.querySelectorAll('.git__row .git__path')].map((e) => e.textContent),
      letters: [...document.querySelectorAll('.git__letter')].map((e) => e.textContent),
      history: document.querySelectorAll('.git__log-row').length
    })`)
    assert(state.branch === 'main', `branch label: ${state.branch}`)
    assert(
      state.changes.length === 1 && state.changes[0] === 'README.md',
      `expected exactly the README.md change, got: ${state.changes.join(', ')}`
    )
    assert(state.letters[0] === 'M', `README change letter: ${state.letters[0]} (want M)`)
    assert(state.history === 1, `fresh copy should have 1 commit, got ${state.history}`)

    // row click shows the colored diff
    await evalJs(`document.querySelector('.git__row').click()`)
    await sleep(600)
    const diffAdds = await evalJs(
      `[...document.querySelectorAll('.git__diff-line--add')].map((e) => e.textContent).join('\\n')`
    )
    assert(diffAdds.includes('Smoke-edit marker'), `diff missing added line: ${diffAdds.slice(0, 120)}`)
    await screenshot('views-git.png')

    // commit all → tree clean, history grows
    await evalJs(`document.querySelector('.view__textarea').focus()`)
    await insertText('smoke: annotate readme')
    await sleep(200)
    await evalJs(`[...document.querySelectorAll('button')]
      .find((b) => b.textContent === 'Commit all').click()`)
    await sleep(1200)
    const committed = await evalJs(`({
      clean: [...document.querySelectorAll('.view__hint')]
        .some((e) => e.textContent.includes('Working tree clean')),
      history: [...document.querySelectorAll('.git__log-row .git__subject')].map((e) => e.textContent)
    })`)
    assert(committed.clean, 'working tree not clean after Commit all')
    assert(
      committed.history.length === 2 && committed.history[0] === 'smoke: annotate readme',
      `history after commit: ${committed.history.join(' | ')}`
    )
  })

  await step('agent-view', async () => {
    await activateView('Agent')
    await sleep(600)
    const agent = await evalJs(`({
      options: [...document.querySelectorAll('.view__select option')].map((o) => o.textContent),
      status: document.querySelector('.agent__status')?.textContent ?? null,
      composer: !!document.querySelector('.agent__composer .view__textarea')
    })`)
    assert(
      agent.options.length === 3 &&
        agent.options.includes('Anthropic') &&
        agent.options.includes('OpenAI') &&
        agent.options.includes('Ollama'),
      `provider options: ${agent.options.join(', ')}`
    )
    assert(agent.status !== null && agent.status !== '…', `provider status not loaded: ${agent.status}`)
    assert(agent.composer, 'chat composer missing')
    // switching to Ollama needs no key and says so
    await evalJs(`(() => {
      const sel = document.querySelector('.view__select');
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      set.call(sel, 'ollama');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    })()`)
    await sleep(300)
    const ollama = await evalJs(`({
      status: document.querySelector('.agent__status')?.textContent ?? '',
      hint: [...document.querySelectorAll('.view__hint')].map((e) => e.textContent).join(' ')
    })`)
    assert(ollama.status.includes('local'), `ollama status: ${ollama.status}`)
    assert(ollama.hint.includes('no key required'), 'ollama no-key hint missing')
    await screenshot('views-agent.png')
  })

  await step('agent-cli-mcp-config', async () => {
    // the subscription path: SUNA registers its MCP server in the project so
    // an agent CLI (billed to the user's own plan) can use manuscript tools
    const buttons = await evalJs(
      `[...document.querySelectorAll('button')].map((b) => b.textContent.trim())`
    )
    assert(
      buttons.some((t) => t.includes('Claude Code')),
      'Open Claude Code button missing from the agent view'
    )
    const written = await evalJs(`(async () => {
      const dir = window.__sunaDev.projectStore.getState().rootDir;
      const { path } = await window.suna.invoke('agent:write-mcp-config', { dir });
      const { content } = await window.suna.invoke('fs:read-text', { path });
      return { path, config: JSON.parse(content) };
    })()`)
    const server = written.config.mcpServers?.suna
    assert(server !== undefined, `.mcp.json has no suna server: ${JSON.stringify(written.config)}`)
    assert(
      String(server.args?.[0] ?? '').endsWith('server.mjs'),
      `mcp server path looks wrong: ${JSON.stringify(server.args)}`
    )
    assert(existsSync(server.args[0]), `mcp server bundle missing at ${server.args[0]}`)
  })

  await step('terminal-panel', async () => {
    const opened = await evalJs(`(async () => {
      const btn = [...document.querySelectorAll('.statusbar__btn')]
        .find((b) => b.textContent.includes('Terminal'));
      if (btn.getAttribute('aria-pressed') !== 'true') btn.click();
      return true;
    })()`)
    assert(opened, 'terminal toggle missing')
    await sleep(2500)
    const ready = await evalJs(`({
      panel: !!document.querySelector('.termpanel'),
      xterm: !!document.querySelector('.xterm')
    })`)
    assert(ready.panel && ready.xterm, `terminal did not mount: ${JSON.stringify(ready)}`)

    // a real shell: echo a marker through the pty and read it back
    const echoed = await evalJs(`(async () => {
      const dir = window.__sunaDev.projectStore.getState().rootDir;
      const chunks = [];
      const { id } = await window.suna.invoke('term:create', { cwd: dir, cols: 80, rows: 24, envPath: null });
      const off = window.suna.onTermData(id, (d) => chunks.push(d));
      await new Promise((r) => setTimeout(r, 900));
      await window.suna.invoke('term:write', { id, data: 'echo SUNA_PTY_OK\\n' });
      await new Promise((r) => setTimeout(r, 1600));
      off();
      await window.suna.invoke('term:kill', { id });
      return chunks.join('');
    })()`)
    assert(echoed.includes('SUNA_PTY_OK'), 'pty did not echo the marker')
    await screenshot('terminal-panel.png')
  })

  await step('settings-tab', async () => {
    await evalJs(`(() => {
      const btn = [...document.querySelectorAll('.statusbar__btn')]
        .find((b) => b.textContent.includes('Settings'));
      btn.click();
    })()`)
    await sleep(900)
    const sections = await evalJs(
      `[...document.querySelectorAll('.settings__section-title, .view__section-title')].map((e) => e.textContent.trim())`
    )
    assert(sections.length > 0, 'settings tab rendered no sections')
    // round-trip a real setting through the main process
    const roundTrip = await evalJs(`(async () => {
      await window.suna.invoke('settings:set', { patch: { 'smoke.probe': 'yes' } });
      const { settings } = await window.suna.invoke('settings:get', {});
      await window.suna.invoke('settings:set', { patch: { 'smoke.probe': null } });
      return settings['smoke.probe'];
    })()`)
    assert(roundTrip === 'yes', `settings did not persist: ${roundTrip}`)
    await screenshot('settings-tab.png')
  })

  await step('csv-data-grid', async () => {
    const dir = await evalJs(`window.__sunaDev.projectStore.getState().rootDir`)
    await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify('__DIR__/data/members.csv')}.replace('__DIR__', ${JSON.stringify(dir)}))`)
    await sleep(1200)
    const grid = await evalJs(`({
      table: !!document.querySelector('table.dataview__table'),
      headers: [...document.querySelectorAll('.dataview__table th')].map((t) => t.textContent.trim()).slice(0, 5),
      rows: document.querySelectorAll('.dataview__table tbody tr').length,
      toggle: !!document.querySelector('.dataview__toggle')
    })`)
    assert(grid.table, 'csv did not open as a data grid')
    assert(grid.headers.some((h) => h.includes('mass')), `unexpected headers: ${grid.headers.join('|')}`)
    assert(grid.rows > 10, `expected the demo members table to have rows, got ${grid.rows}`)
    await screenshot('csv-grid.png')
  })

  await step('bib-diagnostics', async () => {
    // the .bib language pack's pure diagnostics core, exercised on real text
    const diagnostics = await evalJs(`(() => {
      const dup = '@article{a1,\\n title = {T},\\n author = {A},\\n journal = {J},\\n year = {2020}\\n}\\n@article{a1,\\n title = {T2},\\n author = {B},\\n journal = {J},\\n year = {2021}\\n}\\n';
      const missing = '@article{b1,\\n title = {No author}\\n}\\n';
      const fn = window.__sunaDev.editorBibDiagnostics;
      return {
        wired: typeof fn === 'function',
        dup: fn(dup).map((d) => d.message),
        missing: fn(missing).map((d) => d.message)
      };
    })()`)
    assert(diagnostics.wired, 'bib diagnostics seam not exposed')
    assert(
      diagnostics.dup.some((m) => /duplicate/i.test(m)),
      `no duplicate-key diagnostic: ${diagnostics.dup.join(' | ')}`
    )
    assert(
      diagnostics.missing.some((m) => /author/i.test(m)),
      `no missing-required-field diagnostic: ${diagnostics.missing.join(' | ')}`
    )
  })

  await step('references-cited-filter', async () => {
    await activateView('References')
    await sleep(1200)
    const counts = await evalJs(
      `[...document.querySelectorAll('.refs__usage-btn')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim())`
    )
    assert(counts.length === 3, `usage filter buttons: ${counts.join(', ')}`)
    assert(
      counts.some((c) => c.startsWith('Cited') && !c.endsWith('0')),
      `nothing counted as cited: ${counts.join(', ')}`
    )
    await screenshot('references-filters.png')
  })

  // ---- layout & citation rendering (docs/design/ui-fix-plan.md) -------------

  /** Layout facts of the frontmost editor tab, measured off the real boxes. */
  const editorLayout = () =>
    evalJs(`(() => {
      const tab = document.querySelector('.editor-tab');
      if (!tab) throw new Error('no editor tab mounted');
      const content = tab.querySelector('.cm-content');
      const scroller = tab.querySelector('.cm-scroller');
      const gutters = tab.querySelector('.cm-gutters');
      if (!content) throw new Error('editor tab has no .cm-content');
      const cs = getComputedStyle(content);
      const cr = content.getBoundingClientRect();
      const sr = scroller.getBoundingClientRect();
      // one character in the content's own font — makes "chars per line" real
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
      probe.style.font = cs.font;
      probe.textContent = 'x'.repeat(100);
      content.appendChild(probe);
      const charWidth = probe.getBoundingClientRect().width / 100;
      probe.remove();
      // widest rendered visual line (post-wrap), via range rects
      let widest = 0;
      for (const line of content.querySelectorAll('.cm-line')) {
        const range = document.createRange();
        range.selectNodeContents(line);
        for (const rect of range.getClientRects()) widest = Math.max(widest, rect.width);
      }
      return {
        cls: tab.className,
        maxWidth: cs.maxWidth,
        whiteSpace: cs.whiteSpace,
        fontFamily: cs.fontFamily,
        contentWidth: cr.width,
        // distance from the gutter's right edge to the text column, and from
        // the text column to the scrollport's right edge. clientWidth, not the
        // bounding right: a vertical scrollbar sits inside the scroller's
        // border box and would fake a 15px asymmetry in the centering check.
        gutterGap: gutters === null ? null : cr.left - gutters.getBoundingClientRect().right,
        rightGap: sr.left + scroller.clientWidth - cr.right,
        charsPerLine: Math.round(widest / charWidth)
      };
    })()`)

  const setWidth = async (ch) => {
    await evalJs(`window.__sunaDev.editorSettings.getState().setContentWidthCh(${ch})`)
    await sleep(500)
  }

  await step('layout-by-content-kind', async () => {
    const dir = await evalJs(`window.__sunaDev.projectStore.getState().rootDir`)
    // a persisted slider position must not decide what this step measures
    await evalJs(`window.__sunaDev.editorSettings.getState().reset()`)
    // the terminal-panel step left the panel open over the bottom half of the
    // window; every layout measurement (and every click) below wants the full
    // editor height back
    await evalJs(`(() => {
      const btn = [...document.querySelectorAll('.statusbar__btn')]
        .find((b) => b.textContent.includes('Terminal'));
      if (btn && btn.getAttribute('aria-pressed') === 'true') btn.click();
    })()`)
    await sleep(400)

    // --- code/data: width never applies, never wraps, hugs the gutter, mono
    for (const file of ['code/stripping_model.py', 'figures/fig-spectrum/figure.svg.suna.json']) {
      await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify('__D__/' + file)}.replace('__D__', ${JSON.stringify(dir)}))`)
      await sleep(1400)
      const kind = await evalJs(
        `window.__sunaDev.editorContentKindFor(${JSON.stringify(file.split('/').pop())})`
      )
      assert(kind === 'code', `${file} classified as ${kind} (want code)`)
      const seen = []
      for (const ch of [50, 150]) {
        await setWidth(ch)
        const m = await editorLayout()
        seen.push(m)
        assert(
          m.cls.includes('editor-tab--code'),
          `${file} @${ch}ch root class: ${m.cls} (want editor-tab--code)`
        )
        assert(m.maxWidth === 'none', `${file} @${ch}ch is width-constrained: ${m.maxWidth}`)
        assert(
          m.whiteSpace === 'pre',
          `${file} @${ch}ch soft-wraps (white-space: ${m.whiteSpace}, want pre)`
        )
        assert(
          /mono/i.test(m.fontFamily),
          `${file} @${ch}ch is not monospace: ${m.fontFamily}`
        )
        assert(
          m.gutterGap !== null && Math.abs(m.gutterGap) <= 4,
          `${file} @${ch}ch floats ${m.gutterGap}px from the gutter (want ≤4)`
        )
      }
      assert(
        Math.abs(seen[0].contentWidth - seen[1].contentWidth) <= 1,
        `${file} width changed with the prose measure: ${seen[0].contentWidth} → ${seen[1].contentWidth}`
      )
      // squeeze the host below the longest line: code must scroll, not reflow
      const squeezed = await evalJs(`(async () => {
        const style = document.createElement('style');
        style.textContent = '.editor-tab .editor-tab__source, .editor-tab .dataview__text { width: 420px !important; }';
        document.head.appendChild(style);
        await new Promise((r) => setTimeout(r, 500));
        const tab = document.querySelector('.editor-tab');
        const scroller = tab.querySelector('.cm-scroller');
        const content = tab.querySelector('.cm-content');
        let maxLine = 0;
        for (const l of content.querySelectorAll('.cm-line')) {
          maxLine = Math.max(maxLine, l.getBoundingClientRect().height);
        }
        const out = {
          scrollW: scroller.scrollWidth,
          clientW: scroller.clientWidth,
          maxLineHeight: maxLine,
          lineHeight: parseFloat(getComputedStyle(content).lineHeight)
        };
        style.remove();
        return out;
      })()`)
      assert(
        squeezed.scrollW > squeezed.clientW + 1,
        `${file} squeezed to 420px did not overflow horizontally (${squeezed.scrollW} ≤ ${squeezed.clientW}) — it wrapped instead`
      )
      assert(
        squeezed.maxLineHeight <= squeezed.lineHeight * 1.2,
        `${file} squeezed to 420px produced ${squeezed.maxLineHeight}px lines (one line is ${squeezed.lineHeight}px) — text wrapped`
      )
      if (file.endsWith('.py')) {
        await setWidth(50)
        await screenshot('fix-code-fullwidth.png')
      }
    }

    // --- prose source: wraps at the measure, block starts at the gutter
    await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify('__D__/manuscript/sections/01-introduction.md')}.replace('__D__', ${JSON.stringify(dir)}))`)
    await sleep(1600)
    const toMode = async (want) => {
      for (let i = 0; i < 3; i++) {
        if ((await evalJs(`document.querySelector('.editor-tab__mode').textContent`)) === want) return
        await evalJs(`document.querySelector('.editor-tab__mode').click()`)
        await sleep(600)
      }
      throw new Error(`could not reach ${want} mode`)
    }
    await toMode('Source')
    const source = {}
    for (const ch of [50, 150]) {
      await setWidth(ch)
      source[ch] = await editorLayout()
      assert(
        source[ch].cls.includes('editor-tab--prose'),
        `markdown root class: ${source[ch].cls} (want editor-tab--prose)`
      )
      assert(
        Math.abs(source[ch].gutterGap) <= 4,
        `source @${ch}ch floats ${source[ch].gutterGap}px from the gutter (want ≤4)`
      )
    }
    assert(
      source[150].contentWidth > source[50].contentWidth + 100,
      `the measure did not grow: ${source[50].contentWidth} → ${source[150].contentWidth}`
    )
    assert(
      source[150].charsPerLine > source[50].charsPerLine + 5,
      `chars/line did not change with the setting: ${source[50].charsPerLine} → ${source[150].charsPerLine}`
    )
    await setWidth(60)
    await screenshot('fix-prose-widths.png')

    // --- prose reading: the same measure, centered
    await toMode('Reading')
    for (const ch of [50, 150]) {
      await setWidth(ch)
      const m = await editorLayout()
      assert(
        Math.abs(m.gutterGap - m.rightGap) <= 8,
        `reading @${ch}ch is not centered: left ${m.gutterGap} vs right ${m.rightGap}`
      )
    }
    await evalJs(`window.__sunaDev.editorSettings.getState().reset()`)
    await sleep(400)
  })

  /** Focus the combined manuscript tab (already created by manuscript-doc). */
  const focusManuscript = async () => {
    if (!(await evalJs(`!!document.querySelector('.ms__open')`))) {
      await activateView('Manuscript')
      await sleep(500)
    }
    await evalJs(`document.querySelector('.ms__open').click()`)
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const n = await evalJs(`document.querySelectorAll('.msdoc__editor .cm-content').length`)
      if (n === 4) return
      await sleep(300)
    }
    throw new Error('combined manuscript tab did not come forward with 4 editors')
  }

  /** Content-box width of a selector's first match (padding excluded). */
  const innerWidth = (selector) =>
    evalJs(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('missing element: ' + ${JSON.stringify(selector)});
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    })()`)

  await step('manuscript-settings-parity', async () => {
    await focusManuscript()
    // the gear exists in the manuscript tab and opens the shared popover
    const gear = await evalJs(`!!document.querySelector('.msdoc__toolbar .editor-tab__gear')`)
    assert(gear, 'manuscript tab has no settings gear')
    await evalJs(`document.querySelector('.msdoc__toolbar .editor-tab__gear').click()`)
    await sleep(350)
    const labels = await evalJs(
      `[...document.querySelectorAll('.editor-settings label')].map((l) => l.textContent.trim())`
    )
    assert(
      labels.some((l) => l.startsWith('Content width')) &&
        labels.some((l) => l.startsWith('Font size')) &&
        labels.includes('Font') &&
        labels.includes('Theme'),
      `manuscript popover controls: ${labels.join(' | ')}`
    )
    await screenshot('fix-manuscript-settings.png')
    await evalJs(`document.querySelector('.msdoc__toolbar .editor-tab__gear').click()`)
    await sleep(250)

    // ONE MEASURE: a title-page paragraph and a section line resolve to the
    // same text width, at two different settings, and both actually reflow.
    const at = {}
    for (const ch of [50, 150]) {
      await evalJs(`window.__sunaDev.editorSettings.getState().setContentWidthCh(${ch})`)
      await sleep(700)
      const title = await innerWidth('.msdoc__titlepage .msdoc__front-text')
      const section = await innerWidth('.msdoc__editor .cm-line')
      const refs = await innerWidth('.msdoc__references .msdoc__ref')
      assert(
        Math.abs(title - section) <= 4,
        `@${ch}ch title page (${Math.round(title)}px) and section (${Math.round(section)}px) disagree`
      )
      assert(
        Math.abs(title - refs) <= 4,
        `@${ch}ch title page (${Math.round(title)}px) and references (${Math.round(refs)}px) disagree`
      )
      at[ch] = title
    }
    assert(
      at[150] > at[50] + 100,
      `changing the width did not reflow the document: ${Math.round(at[50])} → ${Math.round(at[150])}`
    )
    // the tab really publishes the editor vars (not the 68ch fallback)
    const vars = await evalJs(
      `getComputedStyle(document.querySelector('.msdoc')).getPropertyValue('--ed-content-width').trim()`
    )
    assert(vars === '150ch', `manuscript --ed-content-width: ${vars} (want 150ch)`)
    await evalJs(`window.__sunaDev.editorSettings.getState().reset()`)
    await sleep(500)
  })

  /** Every crossref chip currently in the document, scrolled end to end. */
  const collectXrefs = () =>
    evalJs(`(async () => {
      const doc = document.querySelector('.msdoc');
      const seen = new Map();
      const collect = () => {
        for (const el of document.querySelectorAll('.msdoc__editor .cm-lp-xref')) {
          seen.set(el.textContent + '|' + el.className, {
            text: el.textContent, cls: el.className
          });
        }
        for (const el of document.querySelectorAll('.msdoc__editor .cm-lp-eq-label')) {
          seen.set('EQLABEL' + el.textContent, { text: el.textContent, cls: el.className });
        }
      };
      doc.scrollTop = 0;
      await new Promise((r) => setTimeout(r, 400));
      collect();
      for (let y = 0; y <= doc.scrollHeight; y += 300) {
        doc.scrollTop = y;
        await new Promise((r) => setTimeout(r, 150));
        collect();
      }
      doc.scrollTop = 0;
      await new Promise((r) => setTimeout(r, 300));
      return [...seen.values()];
    })()`)

  await step('crossref-resolution', async () => {
    await focusManuscript()
    const chips = await collectXrefs()
    const texts = chips.map((c) => c.text)
    // @eq:stripping -> equation (1); the display equation's own label -> (1)
    assert(texts.includes('equation (1)'), `no "equation (1)" chip: ${texts.join(' | ')}`)
    assert(
      chips.some((c) => c.text === '(1)' && c.cls.includes('cm-lp-eq-label--numbered')),
      `display equation label not numbered: ${chips.map((c) => c.text).join(' | ')}`
    )
    // figures number by manuscript.json order, panel suffixes append directly
    assert(texts.includes('Fig. 1'), `no "Fig. 1" chip: ${texts.join(' | ')}`)
    assert(texts.includes('Fig. 2'), `no "Fig. 2" chip: ${texts.join(' | ')}`)
    assert(
      texts.includes('Fig. 1a') && texts.includes('Fig. 1b'),
      `panel-suffix crossrefs "(@fig:fig-spectrum{a})" did not resolve: ${texts.join(' | ')}`
    )
    assert(
      chips.every((c) => !c.cls.includes('cm-lp-xref--unresolved')),
      `example manuscript has unresolved crossrefs: ${chips
        .filter((c) => c.cls.includes('unresolved'))
        .map((c) => c.text)
        .join(', ')}`
    )
    // the parenthesised form must not leak raw braces into the prose. The
    // cursor's own line legitimately shows raw source (live-preview reveals
    // what you are editing), so it is excluded.
    const raw = await evalJs(
      `[...document.querySelectorAll('.msdoc__editor .cm-line')]
        .filter((l) => !l.classList.contains('cm-activeLine'))
        .map((l) => l.textContent).join('\\n')`
    )
    assert(!raw.includes('@fig:'), 'raw "@fig:" text still visible in the rendered document')
    // frame the intro's display equation: its numbered "(1)" label plus the
    // "equation (1)" / "Fig. 1" / "Fig. 2" prose chips are all on screen there
    await evalJs(`(() => {
      const eq = document.querySelector('.msdoc__editor .cm-lp-math-block');
      if (eq) eq.scrollIntoView({ block: 'center' });
    })()`)
    await sleep(700)
    await screenshot('fix-crossrefs.png')

    // a bogus id keeps its raw text and is flagged — typed live, then undone
    // (never saved: the section file on disk is untouched)
    const spot = await evalJs(`(async () => {
      const editor = document.querySelectorAll('.msdoc__editor')[0];
      editor.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 600));
      const line = editor.querySelector('.cm-line');
      const r = line.getBoundingClientRect();
      const x = r.right - 4;
      const y = r.top + r.height / 2;
      // the point must really be over the editor — a panel covering it would
      // silently send the keystrokes somewhere else (e.g. the terminal)
      const hit = document.elementFromPoint(x, y);
      if (hit === null || hit.closest('.msdoc__editor') === null) {
        throw new Error('click point is not over the section editor: ' + (hit ? hit.className : 'nothing'));
      }
      return { x, y };
    })()`)
    await click(spot.x, spot.y)
    await sleep(250)
    await insertText(' @fig:nope ')
    await sleep(300)
    await key('ArrowDown', 'ArrowDown')
    await key('ArrowDown', 'ArrowDown')
    await sleep(700)
    const bogus = await evalJs(
      `[...document.querySelectorAll('.msdoc__editor .cm-lp-xref--unresolved')]
        .map((el) => el.textContent)`
    )
    assert(
      bogus.includes('fig:nope'),
      `a bogus @fig:nope should stay raw and flagged, got: ${bogus.join(', ')}`
    )
    const introPath = join(COPY_DIR, 'manuscript', 'sections', '01-introduction.md')
    const introBefore = readFileSync(introPath, 'utf8')
    for (let i = 0; i < 6; i++) {
      await key('z', 'KeyZ', 4)
      await sleep(120)
    }
    await sleep(400)
    const cleared = await evalJs(
      `![...document.querySelectorAll('.msdoc__editor .cm-line')]
        .some((l) => l.textContent.includes('nope'))`
    )
    assert(cleared, 'undo did not remove the bogus crossref from the document')
    assert(
      readFileSync(introPath, 'utf8') === introBefore,
      'the bogus-crossref probe wrote to sections/01-introduction.md (it must never save)'
    )
  })

  await step('rendered-as-round-trip', async () => {
    await focusManuscript()
    const bodyState = () =>
      evalJs(`(() => {
        const chips = [...document.querySelectorAll('.msdoc__editor .cm-lp-cite')]
          .map((c) => ({ text: c.textContent, cls: c.className }));
        return {
          renderedAs: document.querySelector('.msdoc__rendered-as')?.textContent ?? null,
          chips,
          refNums: [...document.querySelectorAll('.msdoc__references .msdoc__ref-num')]
            .map((n) => n.textContent),
          refFirst: document.querySelector('.msdoc__references .msdoc__ref')?.textContent ?? '',
          refCount: document.querySelectorAll('.msdoc__references .msdoc__ref').length,
          sidebarNums: [...document.querySelectorAll('.refs__num')].map((n) => n.textContent),
          sidebarKeys: [...document.querySelectorAll('.refs__key')].map((k) => k.textContent.trim())
        };
      })()`)

    const pickProfile = async (label) => {
      if (!(await evalJs(`!!document.querySelector('.refs__style')`))) {
        await activateView('References')
        await sleep(1200)
      }
      await evalJs(`(() => {
        const b = [...document.querySelectorAll('.refs__style')]
          .find((x) => x.textContent === ${JSON.stringify(label)});
        if (!b) throw new Error('no Rendered as button: ' + ${JSON.stringify(label)});
        b.click();
      })()`)
      await sleep(1600)
    }

    // --- ApJ (AAS): author-year in the body, alphabetical unnumbered list
    await pickProfile('ApJ (AAS)')
    const apj = await bodyState()
    assert(
      apj.renderedAs !== null && apj.renderedAs.includes('Astrophysical Journal'),
      `manuscript still says: ${apj.renderedAs}`
    )
    assert(apj.chips.length > 0, 'no citation chips rendered in the manuscript body')
    assert(
      apj.chips.every((c) => /\(\w+.*\d{4}\)/.test(c.text)),
      `body chips are not author-year: ${apj.chips.map((c) => c.text).join(' | ')}`
    )
    assert(
      apj.chips.every((c) => c.cls.includes('cm-lp-cite--inline')),
      'author-year chips are still styled as raised superscripts'
    )
    assert(
      apj.refNums.length === 0,
      `author-year reference list should be unnumbered, got: ${apj.refNums.join(' ')}`
    )
    assert(apj.refCount === 11, `reference count under ApJ: ${apj.refCount}`)
    assert(
      apj.refFirst.includes('Astropy'),
      `alphabetical list should start at Astropy, got: ${apj.refFirst.slice(0, 60)}`
    )
    assert(
      apj.sidebarNums.length === 0 && apj.sidebarKeys[0] === 'astropy2022',
      `sidebar list not alphabetical/unnumbered: ${apj.sidebarKeys.slice(0, 3).join(', ')}`
    )
    await screenshot('fix-authoryear.png')

    // --- back to Nature Astronomy: superscript numerals return
    await pickProfile('Nat. Astron.')
    const nat = await bodyState()
    assert(
      nat.renderedAs !== null && nat.renderedAs.includes('Nature Astronomy'),
      `manuscript did not switch back: ${nat.renderedAs}`
    )
    assert(
      nat.chips.every((c) => /^\d+([,–-]\d+)*$/.test(c.text)),
      `body chips are not numeric: ${nat.chips.map((c) => c.text).join(' | ')}`
    )
    assert(
      nat.chips.every((c) => !c.cls.includes('cm-lp-cite--inline')),
      'numeric chips lost their superscript form'
    )
    assert(nat.refNums[0] === '1.', `numeric list should restart at 1., got: ${nat.refNums[0]}`)
    assert(
      nat.refFirst.includes('Gunn'),
      `entry 1 should be gunn1972 again: ${nat.refFirst.slice(0, 60)}`
    )
    assert(
      nat.sidebarKeys[0] === 'gunn1972' && nat.sidebarNums[0] === '1.',
      `sidebar list did not renumber: ${nat.sidebarKeys.slice(0, 3).join(', ')}`
    )
  })

  await step('references-panel-fits', async () => {
    // re-activating a showing view TOGGLES the sidebar shut — only click when
    // the References panel is not already on screen
    if (!(await evalJs(`!!document.querySelector('.refs__list')`))) {
      await activateView('References')
      await sleep(900)
    }
    const panel = await evalJs(`(() => {
      const list = document.querySelector('.refs__list');
      const view = document.querySelector('.view.refs');
      const rows = [...document.querySelectorAll('.refs__row')];
      const rects = rows.map((r) => r.getBoundingClientRect());
      const overlaps = [];
      for (let i = 1; i < rects.length; i++) {
        if (rects[i].top < rects[i - 1].bottom - 0.5) overlaps.push(i);
      }
      const spill = [];
      for (const row of rows) {
        const rb = row.getBoundingClientRect();
        for (const child of row.querySelectorAll('*')) {
          const cb = child.getBoundingClientRect();
          if (cb.width > 0 && (cb.right > rb.right + 1 || cb.bottom > rb.bottom + 1)) {
            spill.push(child.className);
          }
        }
      }
      return {
        rows: rows.length,
        listScrollW: list.scrollWidth,
        listClientW: list.clientWidth,
        viewScrollW: view.scrollWidth,
        viewClientW: view.clientWidth,
        maxHeight: getComputedStyle(list).maxHeight,
        overlaps,
        spill: [...new Set(spill)],
        titleClamp: getComputedStyle(document.querySelector('.refs__title')).webkitLineClamp
      };
    })()`)
    assert(panel.rows === 11, `reference rows: ${panel.rows}`)
    assert(
      panel.listScrollW <= panel.listClientW,
      `reference list scrolls horizontally: ${panel.listScrollW} > ${panel.listClientW}`
    )
    assert(
      panel.viewScrollW <= panel.viewClientW,
      `references panel scrolls horizontally: ${panel.viewScrollW} > ${panel.viewClientW}`
    )
    assert(panel.maxHeight === 'none', `reference list is still height-trapped: ${panel.maxHeight}`)
    assert(panel.overlaps.length === 0, `reference rows overlap at index ${panel.overlaps.join(', ')}`)
    assert(panel.spill.length === 0, `row content spills past its row: ${panel.spill.join(', ')}`)
    assert(panel.titleClamp === '2', `titles not clamped to 2 lines: ${panel.titleClamp}`)

    // the sidebar manuscript summary renders its title math, like the title page
    await activateView('Manuscript')
    await sleep(900)
    const title = await evalJs(`(() => {
      const el = document.querySelector('.ms__title');
      return { text: el?.textContent ?? '', katex: !!el?.querySelector('.katex') };
    })()`)
    assert(title.katex, 'sidebar manuscript title does not render KaTeX')
    assert(!title.text.includes('$'), `sidebar title still shows raw TeX: ${title.text}`)
  })

  // ======================= feature-plan-2.md acceptance =====================
  // docs/design/feature-plan-2.md §1–4. Everything below asserts on real
  // files inside the example copy, or on measured DOM boxes.

  const MANUSCRIPT_JSON = join(COPY_DIR, 'manuscript', 'manuscript.json')
  const COMMENTS_JSON = join(COPY_DIR, 'manuscript', 'comments.json')
  const RESULTS_MD = join(COPY_DIR, 'manuscript', 'sections', '02-results.md')
  const BIB = join(COPY_DIR, 'manuscript', 'references.bib')

  /** Make the combined manuscript tab the active dock panel. */
  const openManuscriptDoc = async () => {
    const focused = await evalJs(`(() => {
      const tab = [...document.querySelectorAll('.dv-tab')]
        .find((t) => t.textContent.trim().replace(/\\s*[•✕×]\\s*$/, '') === 'Manuscript');
      if (!tab) return false;
      tab.click();
      return true;
    })()`)
    if (!focused) {
      await showView('manuscript')
      await sleep(700)
      await evalJs(`document.querySelector('.ms__open').click()`)
    }
    await sleep(2000)
    assert(
      await evalJs(`!!document.querySelector('.msdoc__titlepage')`),
      'combined manuscript tab did not come up'
    )
  }

  await step('title-page-edits-manuscript-json', async () => {
    await openManuscriptDoc()
    const shape = await evalJs(`({
      titlepage: !!document.querySelector('.msdoc__titlepage'),
      authorLine: document.querySelector('.msdoc__authors')?.textContent ?? '',
      affs: [...document.querySelectorAll('.msdoc__affiliation')].map((d) => d.textContent),
      clickToEdit: document.querySelector('.msdoc__authors')?.getAttribute('role') ?? null
    })`)
    assert(shape.titlepage, 'combined manuscript tab has no title page')
    // The journal rendering — with DERIVED superscripts — is what you see
    // until you click; the editors must never replace it permanently.
    assert(
      shape.authorLine.includes('Ada Researcher') && shape.authorLine.includes('Ben Collaborator'),
      `author line: ${shape.authorLine}`
    )
    assert(
      shape.affs.length === 2 && shape.affs[0].startsWith('1') && shape.affs[1].startsWith('2'),
      `affiliation superscripts: ${JSON.stringify(shape.affs)}`
    )
    assert(shape.clickToEdit === 'button', 'authors block is not click-to-edit')

    // --- rename an author -> manuscript.json on disk, still schema-valid ----
    await evalJs(`document.querySelector('.msdoc__authors').click()`)
    await sleep(250)
    await evalJs(
      setFieldJs(
        `[...document.querySelectorAll('.tp__author-row')][1].querySelector('.tp__author-family')`,
        'Kowalczyk'
      )
    )
    await evalJs(
      `[...document.querySelectorAll('.tp__author-row')][1].querySelector('.tp__author-family').blur()`
    )
    await sleep(1000)
    const renamed = JSON.parse(readFileSync(MANUSCRIPT_JSON, 'utf8'))
    assert(
      renamed.authors[1].family === 'Kowalczyk',
      `manuscript.json author 2: ${renamed.authors[1].family}`
    )
    assert(renamed.authors[0].family === 'Researcher', 'the other author was disturbed')
    assert(Array.isArray(renamed.affiliations) && renamed.affiliations.length === 2,
      'affiliations were disturbed by an author rename')

    // --- an invalid ORCID: inline error, file byte-identical ---------------
    const before = readFileSync(MANUSCRIPT_JSON)
    await evalJs(
      setFieldJs(
        `[...document.querySelectorAll('.tp__author-row')][0].querySelector('.tp__author-orcid')`,
        '1234-nope'
      )
    )
    await evalJs(
      `[...document.querySelectorAll('.tp__author-row')][0].querySelector('.tp__author-orcid').blur()`
    )
    await sleep(1200)
    const rejected = await evalJs(`({
      error: document.querySelector('.tp__authors-editor .tp__field-error')?.textContent ?? null,
      invalidInput: !!document.querySelector('.tp__author-orcid--invalid')
    })`)
    assert(rejected.error !== null && /ORCID/i.test(rejected.error),
      `no visible ORCID error, got: ${rejected.error}`)
    assert(rejected.invalidInput, 'the offending ORCID input is not marked invalid')
    assert(
      readFileSync(MANUSCRIPT_JSON).equals(before),
      'an invalid ORCID reached manuscript.json — the file changed'
    )

    // put a valid ORCID back so the doc is writable again
    await evalJs(
      setFieldJs(
        `[...document.querySelectorAll('.tp__author-row')][0].querySelector('.tp__author-orcid')`,
        '0000-0002-1825-0097'
      )
    )
    await evalJs(
      `[...document.querySelectorAll('.tp__author-row')][0].querySelector('.tp__author-orcid').blur()`
    )
    await sleep(900)

    // --- reorder authors -> derived superscripts renumber -------------------
    await evalJs(
      `[...document.querySelectorAll('.tp__author-row')][1].querySelector('.tp__author-move-up').click()`
    )
    await sleep(900)
    await evalJs(`document.querySelector('.tp__group-done')?.click()`)
    await sleep(500)
    const reordered = await evalJs(`({
      authorLine: document.querySelector('.msdoc__authors')?.textContent ?? '',
      affs: [...document.querySelectorAll('.msdoc__affiliation')].map((d) => d.textContent)
    })`)
    // Ben now leads, so HIS affiliation becomes superscript 1 — numbering is
    // derived from author order, never stored.
    assert(
      reordered.authorLine.startsWith('Ben Kowalczyk1'),
      `author line after reorder: ${reordered.authorLine}`
    )
    assert(
      reordered.affs[0].includes('Institute for Cosmic Discovery') &&
        reordered.affs[1].includes('Department of Astronomy'),
      `affiliations did not renumber: ${JSON.stringify(reordered.affs)}`
    )
    const onDisk = JSON.parse(readFileSync(MANUSCRIPT_JSON, 'utf8'))
    assert(onDisk.authors[0].id === 'a2', `author order on disk: ${onDisk.authors.map((a) => a.id)}`)
    // superscripts are derived: nothing numeric is persisted
    assert(
      !JSON.stringify(onDisk.affiliations).includes('"number"'),
      'affiliation numbers were persisted — they must stay derived'
    )
    await screenshot('20-title-page-edit.png')
  })

  await step('comments-select-create-anchor', async () => {
    await openManuscriptDoc()
    const selected = await dragSelectInSection('best-fit centroid')
    assert(selected === 'best-fit centroid', `selection in the section editor: ${selected}`)
    await key('m', 'KeyM', 12) // ⌘⇧M
    await sleep(700)
    const draft = await evalJs(`(() => {
      const d = window.__sunaDev.commentsStore.getState().draft;
      return {
        path: d?.target?.path ?? null,
        quote: d?.target?.anchor?.quote ?? null,
        view: window.__sunaDev.uiStore.getState().activeView,
        composer: !!document.querySelector('.cmt__draft')
      };
    })()`)
    assert(draft.quote === 'best-fit centroid', `draft anchor quote: ${draft.quote}`)
    assert(draft.path === 'sections/02-results.md', `draft target: ${draft.path}`)
    assert(draft.view === 'comments', `selection did not open the Comments view: ${draft.view}`)
    assert(draft.composer, 'no comment composer appeared')

    await evalJs(
      setFieldJs(
        `document.querySelector('.cmt__draft .view__textarea')`,
        'Should this be the vacuum wavelength?',
        'HTMLTextAreaElement'
      )
    )
    await sleep(150)
    await evalJs(`[...document.querySelectorAll('.cmt__draft .cmt__btn')]
      .find((b) => b.textContent.trim() === 'Comment').click()`)
    await sleep(1200)

    const file = JSON.parse(readFileSync(COMMENTS_JSON, 'utf8'))
    assert(file.schemaVersion === 1, `comments.json schemaVersion: ${file.schemaVersion}`)
    assert(file.comments.length === 1, `comments.json entries: ${file.comments.length}`)
    assert(
      file.comments[0].target.anchor.quote === 'best-fit centroid',
      `stored anchor: ${JSON.stringify(file.comments[0].target.anchor)}`
    )
    assert(file.comments[0].author.kind === 'human', 'comment is not attributed to the human')
    // sidecar only: the prose must be untouched
    assert(
      !readFileSync(RESULTS_MD, 'utf8').includes(file.comments[0].id),
      'a comment marker leaked into the section prose'
    )
    const ui = await evalJs(`({
      cards: document.querySelectorAll('.cmt__card').length,
      anchors: [...document.querySelectorAll('.cm-content .cmt-anchor')].map((a) => a.textContent),
      lineDots: document.querySelectorAll('.cm-line.cmt-line-dot').length
    })`)
    assert(ui.cards === 1, `comment cards in the panel: ${ui.cards}`)
    assert(
      ui.anchors.length === 1 && ui.anchors[0] === 'best-fit centroid',
      `anchor highlight: ${JSON.stringify(ui.anchors)}`
    )
    assert(ui.lineDots === 1, `anchor line dots: ${ui.lineDots}`)
  })

  await step('comments-survive-edits-then-detach', async () => {
    await openManuscriptDoc()
    // edit AROUND the quote -> still attached
    const sel = await dragSelectInSection('with a ')
    assert(sel === 'with a ', `could not select the surrounding text: ${sel}`)
    await insertText('with a carefully measured ')
    await sleep(300)
    await key('s', 'KeyS', 4)
    await sleep(1200)
    let state = await reloadComments()
    assert(state.count === 1, `comment count after editing around it: ${state.count}`)
    assert(state.detached[0] === false, 'editing around the anchor detached the comment')
    assert(state.anchorsInDom === 1, 'anchor highlight lost after an edit around it')

    // delete the quoted text -> detached, NEVER dropped
    const quote = await dragSelectInSection('best-fit centroid')
    assert(quote === 'best-fit centroid', `could not select the quote: ${quote}`)
    await key('Backspace', 'Backspace')
    await sleep(300)
    await key('s', 'KeyS', 4)
    await sleep(1200)
    state = await reloadComments()
    assert(state.count === 1, `deleting the quote dropped the comment (count ${state.count})`)
    assert(state.detached[0] === true, 'deleting the quoted text did not mark the comment detached')
    assert(state.detachedChips === 1, 'the panel does not show a "detached" chip')
    assert(state.anchorsInDom === 0, 'a detached comment still paints an anchor highlight')
    assert(
      JSON.parse(readFileSync(COMMENTS_JSON, 'utf8')).comments.length === 1,
      'comments.json lost the detached comment'
    )

    // restore the quote -> it re-attaches (re-locate, never delete)
    const gap = await dragSelectInSection('carefully measured  of')
    assert(gap === 'carefully measured  of', `could not select the gap: ${gap}`)
    await insertText('best-fit centroid of')
    await sleep(300)
    await key('s', 'KeyS', 4)
    await sleep(1200)
    state = await reloadComments()
    assert(state.detached[0] === false, 'the comment did not re-attach once its quote came back')
  })

  await step('comments-mcp-add-shows-in-app', async () => {
    await openManuscriptDoc()
    const out = mcpCall(COPY_DIR, 'add_comment', {
      path: 'sections/02-results.md',
      quote: 'regular rotation pattern',
      body: 'The kinematic asymmetry needs an uncertainty here.'
    })
    assert(/^added c-/.test(out.trim()), `MCP add_comment said: ${out.trim()}`)
    const state = await reloadComments()
    assert(state.count === 2, `comments after the MCP call: ${state.count}`)
    assert(state.authors.includes('agent'), 'the agent-authored comment is missing')
    assert(state.anchorsInDom === 2, `anchors after the MCP comment: ${state.anchorsInDom}`)
    const agentBadge = await evalJs(
      `document.querySelectorAll('.cmt__badge--agent').length`
    )
    assert(agentBadge === 1, 'the agent comment is not visually distinct in the panel')
    await screenshot('21-comments.png')
  })

  // Two figures get canvas tabs during this run, and dockview keeps the
  // hidden one in the DOM with zero-size boxes — a plain `document.
  // querySelector('.canvas-viewport')` would measure the wrong (invisible)
  // panel and make geometry assertions pass vacuously. Always scope to the
  // one canvas tab that is actually on screen.
  const CANVAS = `[...document.querySelectorAll('.canvas-tab')]
    .find((t) => t.getBoundingClientRect().width > 0)`
  const canvasJs = (body) =>
    `(() => { const CT = ${CANVAS}; if (!CT) throw new Error('no visible canvas tab'); ${body} })()`

  await step('canvas-align-and-rulers', async () => {
    await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(FIGURE)})`)
    await sleep(2000)
    const which = await evalJs(canvasJs(`return CT.closest('.dv-content-container') ?
      'ok' : 'ok';`))
    assert(which === 'ok', 'no canvas tab is visible')

    // --- rulers: mm ticks whose 0 and max land on the artboard's edges -----
    const ruler = await evalJs(canvasJs(`
      const vp = CT.querySelector('.canvas-viewport').getBoundingClientRect();
      const svg = CT.querySelector('.canvas-world svg').getBoundingClientRect();
      const h = [...CT.querySelectorAll('.canvas-ruler--h .canvas-ruler__tick')];
      const v = [...CT.querySelectorAll('.canvas-ruler--v .canvas-ruler__tick')];
      const px = (el, prop) => parseFloat(el.style[prop]);
      return {
        artboardLabel: CT.querySelector('.canvas-tab__meta').textContent,
        hCount: h.length,
        vCount: v.length,
        hLabels: [...CT.querySelectorAll('.canvas-ruler--h .canvas-ruler__label')].map((l) => l.textContent),
        hFirst: px(h[0], 'left'),
        hLast: px(h[h.length - 1], 'left'),
        hLastMm: h[h.length - 1].dataset.mm,
        vFirst: px(v[0], 'top'),
        vLast: px(v[v.length - 1], 'top'),
        vLastMm: v[v.length - 1].dataset.mm,
        artLeft: svg.left - vp.left,
        artRight: svg.right - vp.left,
        artTop: svg.top - vp.top,
        artBottom: svg.bottom - vp.top,
        artWidthPx: svg.width,
        artHeightPx: svg.height
      };
    `))
    // guard against a degenerate (hidden/zero-size) measurement making the
    // alignment comparisons below trivially true
    assert(ruler.artWidthPx > 100 && ruler.artHeightPx > 20,
      `artboard is not really on screen: ${ruler.artWidthPx}×${ruler.artHeightPx} px`)
    assert(ruler.hLast - ruler.hFirst > 100,
      `ruler spans ${ruler.hLast - ruler.hFirst} px — it is not tracking the artboard`)
    // 180 mm artboard -> 1 mm minor ticks 0..180 and labels every 10 mm
    assert(ruler.hCount === 181, `horizontal mm ticks: ${ruler.hCount} (want 181 for 180 mm)`)
    assert(ruler.vCount === 59, `vertical mm ticks: ${ruler.vCount} (want 59 for 58 mm)`)
    assert(ruler.hLabels[0] === '0' && ruler.hLabels[1] === '10' && ruler.hLabels.at(-1) === '180',
      `major labels: ${ruler.hLabels.join(',')}`)
    assert(ruler.artboardLabel.includes('180.0'), `artboard readout: ${ruler.artboardLabel}`)
    // origin at the artboard's top-left, max tick at its far edge (±1 px)
    assert(Math.abs(ruler.hFirst - ruler.artLeft) < 1,
      `ruler 0 mm at ${ruler.hFirst}px, artboard left edge at ${ruler.artLeft}px`)
    assert(Math.abs(ruler.hLast - ruler.artRight) < 1,
      `ruler ${ruler.hLastMm} mm at ${ruler.hLast}px, artboard right edge at ${ruler.artRight}px`)
    assert(Math.abs(ruler.vFirst - ruler.artTop) < 1,
      `ruler 0 mm at ${ruler.vFirst}px, artboard top edge at ${ruler.artTop}px`)
    assert(Math.abs(ruler.vLast - ruler.artBottom) < 1,
      `ruler ${ruler.vLastMm} mm at ${ruler.vLast}px, artboard bottom edge at ${ruler.artBottom}px`)

    // --- align: two shapes, one click, one undo ----------------------------
    await evalJs(canvasJs(`CT.querySelector('.canvas-viewport').focus(); return true;`))
    // Draw inside the ARTBOARD: the SVG clips anything outside its viewBox,
    // so a shape created next to the artboard would exist but be unhittable.
    const box = await evalJs(canvasJs(`
      const r = CT.querySelector('.canvas-world svg').getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    `))
    assert(box.w > 100 && box.h > 40, `artboard is only ${box.w}×${box.h} px on screen`)
    const dragRect = async (x0, y0, x1, y1) => {
      await evalJs(`window.__sunaDev.canvasTools.setTool('rect')`)
      assert(
        (await evalJs(`window.__sunaDev.canvasTools.getToolState().tool`)) === 'rect',
        'the rect tool did not activate'
      )
      await mouse('mousePressed', x0, y0)
      for (let i = 1; i <= 5; i++) {
        await send('Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: x0 + ((x1 - x0) * i) / 5, y: y0 + ((y1 - y0) * i) / 5,
          button: 'left', buttons: 1
        })
        await sleep(25)
      }
      await mouse('mouseReleased', x1, y1)
      await sleep(350)
    }
    const rectIds = () =>
      evalJs(canvasJs(`return [...CT.querySelectorAll('.canvas-world svg rect[id^="suna-e"]')].map((e) => e.id);`))
    const idsBefore = await rectIds()
    await dragRect(box.x + box.w * 0.10, box.y + box.h * 0.15, box.x + box.w * 0.22, box.y + box.h * 0.40)
    await dragRect(box.x + box.w * 0.40, box.y + box.h * 0.50, box.x + box.w * 0.55, box.y + box.h * 0.75)
    await evalJs(`window.__sunaDev.canvasTools.setTool('select')`)

    const all = await rectIds()
    const ids = all.filter((id) => !idsBefore.includes(id))
    assert(ids.length === 2, `expected 2 new rects, got ${ids.length} (all: ${all.join(',')})`)

    const centerOf = (elId) =>
      evalJs(canvasJs(`
        const r = CT.querySelector('.canvas-world svg [id="${elId}"]').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      `))
    /** Left edge of an element in world (user) units — the engine's own space. */
    const worldX = (elId) =>
      evalJs(canvasJs(`
        const el = CT.querySelector('.canvas-world svg [id="${elId}"]');
        const b = el.getBBox();
        return new DOMPoint(b.x, b.y).matrixTransform(el.getCTM()).x;
      `))

    const c0 = await centerOf(ids[0])
    await click(c0.x, c0.y)
    await sleep(200)
    const c1 = await centerOf(ids[1])
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: c1.x, y: c1.y, button: 'left', clickCount: 1, modifiers: 8
    })
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: c1.x, y: c1.y, button: 'left', clickCount: 1, modifiers: 8
    })
    await sleep(300)
    const selection = await evalJs(`window.__sunaDev.canvasTools.getSelection()`)
    assert(selection.length === 2, `selection after shift-click: ${selection.length}`)

    const alignState = await evalJs(canvasJs(`
      const b = [...CT.querySelectorAll('.canvas-align__button')];
      const left = b.find((x) => x.getAttribute('aria-label') === 'Align left');
      const dist = b.find((x) => x.getAttribute('aria-label') === 'Distribute horizontally');
      return { alignDisabled: left.disabled, distDisabled: dist.disabled, distTitle: dist.title };
    `))
    assert(!alignState.alignDisabled, 'Align left is disabled with 2 objects selected')
    assert(alignState.distDisabled, 'Distribute is enabled with only 2 objects selected')
    assert(/at least 3/.test(alignState.distTitle), `distribute hint: ${alignState.distTitle}`)

    const beforeX = [await worldX(ids[0]), await worldX(ids[1])]
    assert(Math.abs(beforeX[0] - beforeX[1]) > 10, 'the two rects already share a left edge')
    await evalJs(canvasJs(`
      [...CT.querySelectorAll('.canvas-align__button')]
        .find((x) => x.getAttribute('aria-label') === 'Align left').click();
      return true;
    `))
    await sleep(500)
    const afterX = [await worldX(ids[0]), await worldX(ids[1])]
    assert(Math.abs(afterX[0] - afterX[1]) < 0.01,
      `align left left them at x=${afterX[0]} and x=${afterX[1]}`)
    assert(Math.abs(afterX[0] - Math.min(...beforeX)) < 0.01,
      `aligned to ${afterX[0]}, expected the leftmost edge ${Math.min(...beforeX)}`)

    await evalJs(canvasJs(`CT.querySelector('.canvas-viewport').focus(); return true;`))
    await key('z', 'KeyZ', 4)
    await sleep(500)
    const undoneX = [await worldX(ids[0]), await worldX(ids[1])]
    assert(Math.abs(undoneX[1] - beforeX[1]) < 0.01,
      `one undo did not restore x (${undoneX[1]} vs ${beforeX[1]})`)

    // clean the two scratch rects back out of the document
    for (let i = 0; i < 2; i++) {
      await key('z', 'KeyZ', 4)
      await sleep(350)
    }
    const leftover = await rectIds()
    assert(
      leftover.filter((id) => !idsBefore.includes(id)).length === 0,
      `scratch rects survived the undo chain: ${leftover.join(',')}`
    )
  })

  await step('canvas-auto-letter-panels', async () => {
    const boldCount = () =>
      evalJs(canvasJs(`return CT.querySelectorAll('.canvas-world svg text[font-weight="bold"]').length;`))
    const before = await boldCount()
    await evalJs(canvasJs(`
      [...CT.querySelectorAll('.canvas-figure__action')]
        .find((b) => b.textContent.includes('Auto-letter')).click();
      return true;
    `))
    await sleep(1000)
    const labels = await evalJs(canvasJs(`
      return [...CT.querySelectorAll('.canvas-world svg text[font-weight="bold"]')]
        .map((t) => ({
          text: t.textContent.trim(),
          x: Number(t.getAttribute('x')),
          size: Number(t.getAttribute('font-size')),
          family: t.getAttribute('font-family')
        }))
        .sort((a, b) => a.x - b.x);
    `))
    assert(labels.length === before + 2,
      `auto-letter inserted ${labels.length - before} labels (want 2 for the two-panel demo figure)`)
    // Nature Astronomy's convention: lowercase, bold, no wrapper
    assert(labels[0].text === 'a' && labels[1].text === 'b',
      `panel letters: ${labels.map((l) => l.text).join(',')}`)
    assert(labels[0].x < labels[1].x, 'panel letters are not in reading order')
    assert(labels.every((l) => l.size > 0 && l.family), 'panel letters carry no font')
    // ONE batch command -> ONE undo reverts the whole lettering pass
    await evalJs(canvasJs(`CT.querySelector('.canvas-viewport').focus(); return true;`))
    await key('z', 'KeyZ', 4)
    await sleep(600)
    const afterUndo = await boldCount()
    assert(afterUndo === before, `one undo left ${afterUndo - before} panel letters behind`)
  })

  await step('canvas-png-export-matches-readout', async () => {
    // journal-spec raster: the width presets come from the ACTIVE profile
    const selectJs = (i) => `[...CT.querySelectorAll('.canvas-props__field--wide select')][${i}]`
    const optionText = await evalJs(canvasJs(`return [...${selectJs(0)}.options].map((o) => o.value + '|' + o.text);`))
    assert(
      optionText.some((o) => o.startsWith('double|') && o.includes('180 mm')),
      `width presets are not profile-driven: ${optionText.join(', ')}`
    )
    const setSelect = (i, value) =>
      evalJs(canvasJs(`
        const el = ${selectJs(i)};
        const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return el.value;
      `))
    assert((await setSelect(0, 'double')) === 'double', 'width preset did not switch to double column')
    await sleep(300)
    assert((await setSelect(1, '300')) === '300', 'resolution did not switch to 300 dpi')
    await sleep(400)
    const readout = await evalJs(canvasJs(`
      return [...CT.querySelectorAll('.canvas-props__mm')].map((e) => e.textContent).find((t) => t.includes('dpi')) ?? '';
    `))
    const m = /(\d+)×(\d+) px/.exec(readout)
    assert(m, `no pixel readout: ${readout}`)
    assert(/180 × 58 mm @ 300 dpi/.test(readout), `readout: ${readout}`)
    const wantW = Number(m[1])
    const wantH = Number(m[2])
    // 180 mm at 300 dpi is 2126 px — the arithmetic, not a magic number
    assert(wantW === Math.round((180 / 25.4) * 300), `readout width ${wantW} px is not 180 mm @ 300 dpi`)

    const png = join(COPY_DIR, 'output', 'fig-spectrum.png')
    rmSync(png, { force: true })
    await evalJs(canvasJs(`
      [...CT.querySelectorAll('.canvas-figure__action')].find((b) => b.textContent.trim() === 'PNG').click();
      return true;
    `))
    const deadline = Date.now() + 40_000
    while (Date.now() < deadline && !existsSync(png)) await sleep(400)
    assert(existsSync(png), `PNG export produced no file at ${png}`)
    await sleep(600)
    const bytes = readFileSync(png)
    assert(
      bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
      'exported file is not a PNG'
    )
    assert(bytes.subarray(12, 16).toString('ascii') === 'IHDR', 'PNG has no IHDR chunk')
    const gotW = bytes.readUInt32BE(16)
    const gotH = bytes.readUInt32BE(20)
    assert(
      gotW === wantW && gotH === wantH,
      `PNG IHDR says ${gotW}×${gotH}, the readout promised ${wantW}×${wantH}`
    )
    await screenshot('22-canvas-rail.png')
  })

  await step('literature-search-and-add', async () => {
    await showView('references')
    await sleep(900)
    await evalJs(`[...document.querySelectorAll('.refs__tab')]
      .find((b) => b.textContent.trim() === 'Search').click()`)
    await sleep(400)
    const providers = await evalJs(
      `[...document.querySelectorAll('.lit-search__providers .refs__style')].map((b) => b.textContent)`
    )
    assert(providers.length === 4, `provider buttons: ${providers.join(' | ')}`)
    assert(providers[0].includes('Crossref'), 'Crossref is not the default provider')

    await evalJs(setFieldJs(`document.querySelector('.lit-search__query .view__input')`, 'ram pressure stripping'))
    await sleep(200)
    await evalJs(`document.querySelector('.lit-search__go').click()`)
    const searchDeadline = Date.now() + 30_000
    let outcome = null
    while (Date.now() < searchDeadline) {
      outcome = await evalJs(`({
        loading: [...document.querySelectorAll('.view__hint')].some((h) => h.textContent.startsWith('Searching')),
        results: document.querySelectorAll('.lit-search__results > li').length,
        error: document.querySelector('.view__error')?.textContent ?? null
      })`)
      if (!outcome.loading && (outcome.results > 0 || outcome.error !== null)) break
      await sleep(500)
    }
    // LIVE network. Either it answered, or the failure is surfaced honestly —
    // never an empty list pretending nothing matched.
    if (outcome.results === 0) {
      assert(
        outcome.error !== null && outcome.error.trim().length > 0,
        'Crossref returned nothing AND showed no error — a silent empty result'
      )
      console.log(`    (Crossref unavailable right now: ${outcome.error.slice(0, 120)})`)
      return
    }

    const cards = await evalJs(`
      [...document.querySelectorAll('.lit-search__results > li')].slice(0, 3).map((li) => ({
        title: li.querySelector('.lit-card__title')?.textContent ?? li.textContent.slice(0, 60),
        actions: [...li.querySelectorAll('button')].map((b) => b.textContent.trim())
      }))
    `)
    assert(
      cards[0].actions.some((a) => a.includes('Add to references.bib')),
      `result card actions: ${cards[0].actions.join(', ')}`
    )

    const bibBefore = readFileSync(BIB, 'utf8')
    await evalJs(`(() => {
      const li = document.querySelector('.lit-search__results > li');
      const btn = [...li.querySelectorAll('button')].find((b) => b.textContent.includes('Add to references.bib'));
      if (!btn) throw new Error('no add button on the first result');
      btn.click();
    })()`)
    await sleep(2500)
    const bibAfter = readFileSync(BIB, 'utf8')
    assert(bibAfter.length > bibBefore.length, 'references.bib did not grow after Add')
    assert(bibAfter.startsWith(bibBefore.trimEnd().slice(0, 200)), 'existing bib entries were rewritten')
    const addedKey = /@\w+\{([^,]+),/.exec(bibAfter.slice(bibBefore.trimEnd().length))
    assert(addedKey, `no new BibTeX entry found:\n${bibAfter.slice(bibBefore.length)}`)
    assert(
      /^[a-z]+\d{4}[a-z0-9]*$/.test(addedKey[1]),
      `generated cite key is not firstauthorYEARword: ${addedKey[1]}`
    )

    // parseBibtex round-trips it, and the Library tab counts it as UNCITED
    await evalJs(`[...document.querySelectorAll('.refs__tab')]
      .find((b) => b.textContent.trim() === 'Library').click()`)
    await sleep(1500)
    const usage = await evalJs(`(() => {
      const btns = [...document.querySelectorAll('.refs__usage-btn')];
      return {
        counts: btns.map((b) => b.textContent),
        parseErrors: document.querySelector('.refs__missing')?.textContent ?? null
      };
    })()`)
    const uncited = /Uncited\s+(\d+)/.exec(usage.counts.join(' '))
    const all = /All\s+(\d+)/.exec(usage.counts.join(' '))
    assert(uncited && Number(uncited[1]) >= 1,
      `the added entry is not counted as uncited: ${usage.counts.join(' | ')}`)
    assert(all && Number(all[1]) === 12,
      `library entry count after the add: ${usage.counts.join(' | ')}`)
    await screenshot('23-lit-search.png')
  })

  await step('literature-openalex-is-honest', async () => {
    await evalJs(`[...document.querySelectorAll('.refs__tab')]
      .find((b) => b.textContent.trim() === 'Search').click()`)
    await sleep(400)
    await evalJs(`[...document.querySelectorAll('.lit-search__providers .refs__style')]
      .find((b) => b.textContent.includes('OpenAlex')).click()`)
    await sleep(400)
    await evalJs(`document.querySelector('.lit-search__go').click()`)
    const deadline = Date.now() + 30_000
    let state = null
    while (Date.now() < deadline) {
      state = await evalJs(`({
        loading: [...document.querySelectorAll('.view__hint')].some((h) => h.textContent.startsWith('Searching')),
        results: document.querySelectorAll('.lit-search__results > li').length,
        error: document.querySelector('.view__error')?.textContent ?? null,
        suggestion: document.querySelector('.lit-search__suggestion')?.textContent ?? null
      })`)
      if (!state.loading && (state.results > 0 || state.error !== null)) break
      await sleep(500)
    }
    // OpenAlex now meters requests: a keyless search is EXPECTED to 429 here.
    // Either it answered (someone added budget/a key) or the 429 is spelled
    // out with the provider switch inline — never a silent empty list.
    if (state.results > 0) {
      console.log('    (OpenAlex answered — this machine has budget or a key)')
      return
    }
    assert(state.error !== null, 'OpenAlex returned nothing and said nothing')
    assert(
      /rate-limit|429|budget|key/i.test(state.error),
      `OpenAlex error is not the honest rate-limit message: ${state.error}`
    )
    assert(
      state.suggestion !== null && /Crossref/.test(state.suggestion),
      `no inline provider switch offered: ${state.suggestion}`
    )
  })

  await step('mcp-server-exposes-all-verbs', async () => {
    ensureMcpBundle()
    const out = execFileSync(
      process.execPath,
      [MCP_PROBE, '--project', COPY_DIR, '--tools-only', '--json'],
      { cwd: ROOT, encoding: 'utf8' }
    )
    const probe = JSON.parse(out.trim().split('\n').at(-1))
    assert(probe.ok, `MCP probe failed: ${out}`)
    for (const name of [
      'list_comments', 'add_comment', 'reply_comment', 'resolve_comment',
      'search_literature', 'lookup_doi', 'add_reference'
    ]) {
      assert(probe.tools.includes(name), `bundled MCP server is missing ${name}`)
    }
    assert(probe.tools.length === 15, `MCP tool count: ${probe.tools.length}`)
  })

  console.log(`\nALL ${results.length} STEPS PASSED`)
} catch {
  exitCode = 1
  const failed = results.filter((r) => !r.ok)
  console.error(`\nFAILED: ${failed.map((f) => f.name).join(', ')}`)
  console.error(`artifacts: ${ARTIFACTS}`)
} finally {
  // leave the example copy's figure pristine for whoever opens it next
  if (FIGURE && originalSvg !== null && existsSync(FIGURE)) {
    writeFileSync(FIGURE, originalSvg)
  }
  cleanup()
}
process.exit(exitCode)
