#!/usr/bin/env node
/**
 * SUNA end-to-end smoke test. Launches the app with a CDP endpoint and
 * drives the full loop: open example project (a fresh COPY under userData)
 * → sidebar resize → reading mode (editable live preview; two-state toggle)
 * → canvas editing suite → sidebar views (explorer CRUD, manuscript outline
 * + the combined manuscript document with title page/section editors/
 * references/scroll-spy, figures, references, git commit, agent) —
 * asserting on real files inside the copy.
 *
 * Reset strategy: the userData example copy is deleted before launch, so
 * every run starts from the pristine examples/demo-paper and the git repo
 * created on open has exactly one "Initial commit".
 *
 * Usage:  node scripts/e2e/smoke.mjs        (or: pnpm smoke)
 * Exit 0 = all steps passed. Artifacts in scripts/e2e/.artifacts/.
 */
import { spawn, execSync } from 'node:child_process'
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
    // modes are two-state: the button (or ⌘E) toggles Source ⇄ Reading,
    // and Reading is the *editable* live preview (widgets with cursor-reveal)
    await evalJs(`document.querySelector('.editor-tab__mode').click()`)
    await sleep(500)
    const label = await evalJs(`document.querySelector('.editor-tab__mode').textContent`)
    assert(label === 'Reading', `mode after click: ${label} (want Reading)`)
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
