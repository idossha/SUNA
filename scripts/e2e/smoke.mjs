#!/usr/bin/env node
/**
 * SUNA end-to-end smoke test. Launches the app HIDDEN by default (no window,
 * no dock icon) with a CDP endpoint and drives the full loop: open example
 * project (a fresh COPY under an isolated userData) → sidebar resize →
 * reading mode (editable live preview; two-state toggle) → canvas editing
 * suite → sidebar views (explorer CRUD, manuscript outline + the combined
 * manuscript document with title page/section editors/references/scroll-spy,
 * figures, references, git commit, agent) — asserting on real files inside
 * the copy — then the layout and citation rendering contract of
 * docs/design/ui-fix-plan.md, *measured* off real boxes (content-kind
 * widths/wrapping, one manuscript measure, cross-ref resolution, the
 * "Rendered as" round trip, the references panel).
 *
 * Isolation/reset strategy: the app runs against a scratch userData at
 * scripts/e2e/.userdata-smoke, wiped at the start of every run — the
 * developer's real profile (settings.json, recents, localStorage) is never
 * touched, and every run starts from the pristine examples/demo-paper with
 * a git repo holding exactly one "Initial commit".
 *
 * Usage:  node scripts/e2e/smoke.mjs [flags]   (or: pnpm smoke)
 *   --show          show the window (SUNA_SMOKE_SHOW=1 works too)
 *   --list          print all step names and exit — nothing is launched
 *   --only a,b,c    run only the named steps (include their prerequisites)
 *   --from X        start execution at step X (earlier steps are skipped)
 *   --until Y       stop after step Y (later steps are skipped)
 *   --keep          leave the app running at exit; prints how to stop it
 * Env: SUNA_SMOKE_PORT (CDP port, default 9321), SUNA_SMOKE_KEEP_GOING=1
 * (keep running past a failed step — diagnostics only, see below).
 * Exit 0 = all steps passed. Artifacts in scripts/e2e/.artifacts/.
 */
import { execSync, execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import { connect, launchApp, sleep } from './cdp.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ARTIFACTS = join(ROOT, 'scripts', 'e2e', '.artifacts')
const PORT = Number(process.env.SUNA_SMOKE_PORT ?? 9321)

// ---------------------------------------------------------------- CLI flags
const argv = process.argv.slice(2)
const flagValue = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
}
const SHOW = argv.includes('--show') || process.env.SUNA_SMOKE_SHOW === '1'
const KEEP = argv.includes('--keep')
const ONLY = flagValue('--only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null
const FROM = flagValue('--from')
const UNTIL = flagValue('--until')

// --list: print every step name and exit — read statically out of this
// file's own source, nothing is launched.
const stepNames = () => {
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  return [...source.matchAll(/await step\('([^']+)'/g)].map((m) => m[1])
}
if (argv.includes('--list')) {
  for (const name of stepNames()) console.log(name)
  process.exit(0)
}

// A typo'd filter name would match nothing, skip all steps and exit green —
// a false-green regression gate. Validate against the canonical list first.
if (ONLY || FROM || UNTIL) {
  const known = new Set(stepNames())
  const bad = [...(ONLY ?? []), FROM, UNTIL].filter((n) => n && !known.has(n))
  if (bad.length > 0) {
    console.error(`unknown step name(s): ${bad.join(', ')} — see --list`)
    process.exit(1)
  }
}

// Isolated Electron userData for this suite, wiped at the start of every run
// — the developer's real @suna/desktop profile is never touched.
const USER_DATA = join(ROOT, 'scripts', 'e2e', '.userdata-smoke')
const COPY_DIR = join(USER_DATA, 'example-project')

mkdirSync(ARTIFACTS, { recursive: true })

// The CDP plumbing (launch, connect, send/evalJs/screenshot/click/…) lives in
// cdp.mjs, shared with drive.mjs; the client is connected in the run section
// below and destructured into the same names the step bodies always used.

// ---------------------------------------------------------------- harness
const results = []
/**
 * Diagnostic mode: keep running after a failed step instead of aborting the
 * run. The exit code and the FAILED summary are unchanged, so it can never
 * turn a red run green — it exists because one broken step otherwise hides
 * every assertion below it, and the steps are largely independent (each opens
 * the view or tab it measures). Never set it in CI: a step that fails halfway
 * leaves state the next one did not ask for.
 */
const KEEP_GOING = process.env.SUNA_SMOKE_KEEP_GOING === '1'
/**
 * Step filtering (--only / --from / --until). Filtered runs are best-effort:
 * some steps consume state earlier steps create (open-example-project is the
 * near-universal prerequisite; canvas steps also need canvas-opens-figure),
 * so include the prerequisites in --only lists.
 */
let fromReached = FROM === null
let untilDone = false
async function step(name, fn) {
  if (name === FROM) fromReached = true
  const skip = !fromReached || untilDone || (ONLY !== null && !ONLY.includes(name))
  if (name === UNTIL) untilDone = true
  if (skip) {
    console.log(`  ↷ ${name}`)
    results.push({ name, ok: true, skipped: true })
    return
  }
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`  ✓ ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error: String(error.message ?? error) })
    console.error(`  ✗ ${name}: ${error.message ?? error}`)
    // surface renderer/main errors piped through electron-vite dev — a React
    // unmount-on-error is invisible to DOM assertions otherwise
    const errLines = devLogText().split('\n').filter((l) => /error|Error|unhandled|Warning/.test(l))
    if (errLines.length > 0) console.error('    dev log errors:\n      ' + errLines.slice(-8).join('\n      '))
    await screenshot(`FAIL-${name}.png`).catch(() => {})
    if (!KEEP_GOING) throw error
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

/** Click an activity-bar view button by its label. Prefix rather than
 *  equality: the title is now `<label> (<shortcut> to toggle)`. */
const activateView = (title) =>
  evalJs(`(() => {
    const btn = [...document.querySelectorAll('.activitybar__item')]
      .find((b) => b.title.startsWith(${JSON.stringify(title)}));
    if (!btn) throw new Error('activity item missing: ${title}');
    btn.click();
  })()`)

/** Open the explorer context menu on the tree row for `name`. Matched on the
 *  basename of `data-path`, not on textContent: a row's text is now an icon
 *  plus a name, and it also carries a title, so anything read off the row's
 *  own text would break the moment a row grows a second label. */
const openTreeMenu = (name) =>
  evalJs(`(() => {
    const row = [...document.querySelectorAll('.tree__row')]
      .find((r) => (r.dataset.path ?? '').split('/').pop() === ${JSON.stringify(name)});
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
 *
 * Since feature-plan-5 §3 the coordinates have to be re-measured *after* the
 * caret lands, not just once up front. True live preview replaces markdown
 * syntax with zero-width decorations and reveals it under the cursor, so
 * moving the caret can re-wrap a line and shift every line below it — a rect
 * measured while some *other* line was revealed points a row off by the time
 * the press is delivered. Observed exactly that way: a drag aimed at "infall
 * direction" selected the 16 characters directly below it, same x, one line
 * down. So: click once to settle the reveal state, re-measure, then drag, and
 * verify the gesture actually produced `phrase` — retrying with fresh
 * coordinates rather than trusting a single measurement.
 */
/**
 * Select a phrase by setting the DOM selection directly (CodeMirror syncs
 * from it). Use this when a *second* selection is needed in the same
 * document: true live preview reveals a line's markdown when the caret lands
 * on it, which re-wraps that line and shifts everything below — so
 * coordinates measured before a drag are stale by the time the drag's own
 * pointer motion moves the caret again. Mouse-drag selection is still
 * exercised by dragSelectInSection in the earlier comment steps.
 */
async function selectPhraseInSection(phrase) {
  return evalJs(`(() => {
    const P = ${JSON.stringify(phrase)};
    for (const host of document.querySelectorAll('.msdoc__editor')) {
      const content = host.querySelector('.cm-content');
      if (!content || !content.textContent.includes(P)) continue;
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const i = node.textContent.indexOf(P);
        if (i < 0) continue;
        content.focus();
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + P.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        return sel.toString();
      }
    }
    return null;
  })()`)
}

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
  // Drag from the START of the phrase's FIRST line box to the END of its
  // LAST one. A phrase that soft-wraps has a multi-line range, and its
  // getBoundingClientRect() is the union of those lines — whose vertical
  // centre lands in the gap BETWEEN them, so pressing there selected a whole
  // paragraph instead of the phrase. Per-line-box rects make the gesture
  // independent of where the measure happens to break the text.
  const measureBox = () =>
    evalJs(`(() => {
      const hit = ${locate};
      if (hit === null) return null;
      const rects = [...hit.range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (rects.length === 0) return null;
      const first = rects[0];
      const last = rects[rects.length - 1];
      return {
        lines: rects.length,
        from: { x: first.left, y: first.top + first.height / 2 },
        to: { x: last.right, y: last.top + last.height / 2 },
        onScreen: first.top > 40 && last.bottom < window.innerHeight - 40
      };
    })()`)

  let selection = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const probe = await measureBox()
    if (probe === null) return null
    if (!probe.onScreen) {
      throw new Error(
        `"${phrase}" is not fully on screen (first line top ${Math.round(probe.from.y)})`
      )
    }
    // Land the caret on the phrase's own line FIRST. Any reveal the caret
    // triggers happens now, so the measurement taken after it is the layout
    // the drag will actually be delivered into.
    await click(probe.from.x + 0.5, probe.from.y)
    await sleep(250)

    const box = await measureBox()
    if (box === null || !box.onScreen) continue
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: box.from.x + 0.5, y: box.from.y, button: 'left', clickCount: 1
    })
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: (box.from.x + box.to.x) / 2,
      y: (box.from.y + box.to.y) / 2,
      button: 'left',
      buttons: 1
    })
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: box.to.x - 0.5, y: box.to.y, button: 'left', buttons: 1
    })
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: box.to.x - 0.5, y: box.to.y, button: 'left', clickCount: 1
    })
    await sleep(220)
    selection = await evalJs(`window.getSelection().toString()`)
    if (selection === phrase) return selection
    if (process.env.SUNA_SMOKE_DEBUG_SELECT) {
      const diag = await evalJs(`(() => {
        const at = document.elementFromPoint(${box.from.x + 0.5}, ${box.from.y});
        const hosts = [...document.querySelectorAll('.msdoc__editor')];
        const host = hosts.find((h) => h.querySelector('.cm-content')?.textContent.includes(${JSON.stringify(phrase)}));
        const lines = host ? [...host.querySelectorAll('.cm-line')].map((l) => {
          const r = l.getBoundingClientRect();
          return { top: Math.round(r.top), h: Math.round(r.height), text: l.textContent.slice(0, 46) };
        }) : null;
        return {
          hosts: hosts.length,
          elementAtPress: at ? at.className + ' :: ' + (at.textContent ?? '').slice(0, 40) : null,
          hostTop: host ? Math.round(host.getBoundingClientRect().top) : null,
          scrollTop: Math.round(document.querySelector('.msdoc__body')?.scrollTop ?? -1),
          lines
        };
      })()`)
      console.log(`    [debug attempt ${attempt}] box=${JSON.stringify(box)}`)
      console.log(`    [debug] selection=${JSON.stringify(selection)} ${JSON.stringify(diag, null, 1)}`)
      for (const dy of [-22, -11, 0]) {
        await click(box.from.x + 0.5, box.from.y + dy)
        await sleep(200)
        const where = await evalJs(`(() => {
          const host = [...document.querySelectorAll('.msdoc__editor')]
            .find((h) => h.querySelector('.cm-content')?.textContent.includes(${JSON.stringify(phrase)}));
          const active = host?.querySelector('.cm-activeLine');
          const cs = host ? getComputedStyle(host.querySelector('.cm-content')) : null;
          return { caret: active ? active.textContent.slice(0, 44) : null,
                   fontSize: cs?.fontSize ?? null, lineHeight: cs?.lineHeight ?? null };
        })()`)
        console.log(`      dy=${String(dy).padStart(3)} caret=${JSON.stringify(where.caret)} font=${where.fontSize}/${where.lineHeight}`)
      }
    }
  }
  // Return whatever the last attempt produced; the caller asserts on it, so a
  // persistent mismatch still fails loudly with the text it really selected.
  return selection
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
      detachedChips: document.querySelectorAll('.cmt__detached').length
    };
  })()`)

/**
 * Page count of a PDF read HEADLESSLY, with the same pdf.js the renderer
 * uses — the ground truth the viewer's "of N" readout is compared against,
 * rather than a number typed into this file. `pdfjs-dist` is a dependency of
 * apps/desktop (not of this script), and its default build needs DOM globals,
 * so this resolves the *legacy* Node build from the app's own dependency tree.
 */
async function pdfPageCountHeadless(file) {
  const require_ = createRequire(import.meta.url)
  const entry = require_.resolve('pdfjs-dist/legacy/build/pdf.mjs', {
    paths: [join(ROOT, 'apps', 'desktop')]
  })
  const { getDocument } = await import(pathToFileURL(entry).href)
  const doc = await getDocument({ data: new Uint8Array(readFileSync(file)) }).promise
  return doc.numPages
}

/**
 * Write a flat grey PNG of exactly `width`×`height`.
 *
 * The block-layout step needs raster art whose intrinsic size it can assert
 * the rendered box against, and the demo project ships none — every figure in
 * it is SVG. Encoded here (8-bit greyscale, one zlib'd IDAT, no pHYs chunk so
 * one image pixel is one CSS pixel) rather than checked in as a binary, since
 * CLAUDE.md keeps binaries out of the sources of truth.
 */
function writePng(file, width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body) >>> 0, body.length + 4)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // colour type: greyscale
  // Each scanline is prefixed with its filter byte; 0 = none.
  const raw = Buffer.alloc((width + 1) * height, 0x88)
  for (let y = 0; y < height; y++) raw[y * (width + 1)] = 0
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from('89504e470d0a1a0a', 'hex'),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0))
    ])
  )
}

/** Dimensions a PNG really has, decoded from its IHDR chunk. */
function pngIhdr(file) {
  const bytes = readFileSync(file)
  assert(bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', `${file} is not a PNG`)
  assert(bytes.subarray(12, 16).toString('ascii') === 'IHDR', `${file} has no IHDR chunk`)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

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

// Fresh scratch userData every run (see header): example copy, settings.json,
// localStorage and recents all start from zero, so no stash/restore of the
// developer's preferences is needed anywhere.
rmSync(USER_DATA, { recursive: true, force: true })
mkdirSync(USER_DATA, { recursive: true })

// launchApp frees the CDP port first (scoped lsof kill, no global pkill),
// then spawns `pnpm dev` — hidden unless --show — against the scratch
// userData. Under --keep the app must outlive this process, so its stdio
// goes to a log file (dead pipes would EPIPE a chatty electron-vite dev)
// and the child is unref()ed by launchApp.
const LOG_FILE = join(USER_DATA, 'dev.log')
const appHandle = await launchApp({
  root: ROOT,
  port: PORT,
  hidden: !SHOW,
  userData: USER_DATA,
  ...(KEEP ? { logFile: LOG_FILE } : {})
})
const { devLog } = appHandle
const devLogText = () => (KEEP && existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8') : devLog.join(''))

let cleanedUp = false
function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  if (KEEP) {
    console.log(`--keep: app left running (CDP port ${PORT})`)
    console.log(`stop with: node scripts/e2e/drive.mjs --stop --port ${PORT}`)
    return
  }
  appHandle.stop()
}
process.on('exit', cleanup)

let FIGURE = null // <copy>/figures/fig-spectrum/figure.svg — known after open
let originalSvg = null
/** Scratch project directories the feature-plan-5 steps create outside the
 *  example copy; removed in the finally block however the run ends. */
const TEMP_PROJECT_DIRS = []
/** Scratch FILES a step wrote inside the example copy; same cleanup, so a
 *  --keep run leaves the copy as the app first opened it. */
const TEMP_FILES = []

// Connect over CDP and take the client's verbs under the exact names the
// step bodies have always used. screenshot() keeps its artifacts-relative
// signature as a local wrapper (the client's wants an absolute path).
// A connect timeout must still report like a failed run (summary line +
// artifacts pointer) rather than dying as a bare top-level rejection.
let cdp
try {
  cdp = await connect({ port: PORT, diagnostics: () => devLogText().slice(-2000) })
} catch (error) {
  console.error(`\nFAILED: ${error.message ?? error}`)
  console.error(`artifacts: ${ARTIFACTS}`)
  process.exit(1)
}
const { send, evalJs, click, rclick, mouse, key, insertText } = cdp
const screenshot = (name) => cdp.screenshot(join(ARTIFACTS, name))
await sleep(1500) // let the renderer finish booting before anything measures

let exitCode = 0
try {
  /**
   * Pin the viewport before anything measures geometry.
   *
   * macOS window tiling remembers a per-app state across launches and hands
   * the window back at whatever size it likes (observed 1265×1334 AND
   * 900×1334 on the same machine, same commit), so anything width-dependent
   * — the comment gutter's 1100 px card/dot breakpoint, the properties
   * panel's 1200 px auto-open, the canvas click targets — turns into a coin
   * flip. Electron does not implement CDP's Browser domain, so the OS window
   * cannot be resized from here; the *renderer's* viewport is emulated
   * instead, which is what every assertion actually reads, and input events
   * arrive in the same coordinate space so real mouse/drag steps keep
   * working. The mechanics (Emulation override in device-independent pixels,
   * zoom-corrected for displays with a non-integral scale factor) now live
   * in cdp.mjs's pinViewport.
   */
  const VIEWPORT = { width: 1600, height: 1100 }
  const pinned = await cdp.pinViewport(VIEWPORT)

  await step('viewport-is-pinned', async () => {
    // ±1 px: the override is applied in device-independent pixels, so a
    // non-integral page zoom can round the CSS width by a pixel.
    assert(
      Math.abs(pinned.w - VIEWPORT.width) <= 1 && Math.abs(pinned.h - VIEWPORT.height) <= 1,
      `viewport override did not take: ${pinned.w}×${pinned.h} (want ${VIEWPORT.width}×${VIEWPORT.height})`
    )
    // Above the gutter's 1100px breakpoint, so the margin-comment steps
    // measure the card layout rather than the narrow dot fallback.
    assert(pinned.w >= 1100, `viewport ${pinned.w}px is below the comment gutter's card/dot breakpoint`)
  })

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
    // Normalize the persisted view preferences before anything asserts on
    // them: the editor appearance store (localStorage), the per-project
    // 'Rendered as' override, and the left nav's two visibility flags.
    // The scratch-userData wipe already resets localStorage each run, so
    // this is now a belt-and-braces guard — it keeps the run deterministic
    // even if the wipe is ever skipped or the suite is pointed at a live
    // instance, where a run that ended on MNRAS would otherwise decide the
    // next run's citation numbering.
    await evalJs(`(() => {
      window.__sunaDev.editorSettings.getState().reset();
      window.__sunaDev.renderProfileStore.setState({ byProject: {} });
      const ui = window.__sunaDev.uiStore.getState();
      ui.setRailVisible(true);
      ui.setSidebarVisible(true);
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
    // Dispatch the pointer sequence in the page rather than through CDP:
    // Input.dispatchMouseEvent coordinates are mapped through the device-metrics
    // override this suite installs, and on a fractional-scale display that
    // mapping lands the press off the 4px handle (measured: a 60px drag moved
    // the sidebar 7px). The handler under test only reads clientX/pointerId, so
    // synthetic PointerEvents exercise exactly the same code path.
    await evalJs(`(() => {
      const el = document.querySelector('.sidebar__resize');
      const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: ${h.x}, clientY: ${h.y} }));
      for (let i = 1; i <= 6; i++) {
        el.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: ${h.x} + i * 10, clientY: ${h.y} }));
      }
      el.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0, clientX: ${h.x} + 60, clientY: ${h.y} }));
    })()`)
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
    // Activating the Manuscript view opens (or refocuses) the combined
    // document tab directly (feature-plan-7 §2 — the old .ms__open button is
    // gone; outline rows and the activity bar are the entry points).
    if (!(await evalJs(`!!document.querySelector('.msdoc__titlepage')`))) {
      await activateView('Manuscript')
      await sleep(1200)
    }
    // ONE CodeMirror over the whole flat manuscript.md (feature-plan-7 §1)
    const edDeadline = Date.now() + 10_000
    let editors = 0
    while (Date.now() < edDeadline && editors !== 1) {
      editors = await evalJs(
        `document.querySelectorAll('.msdoc__editor .cm-content').length`
      )
      if (editors !== 1) await sleep(300)
    }
    assert(editors === 1, `expected the single flat-manuscript editor, got ${editors}`)

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

    // ⌘S saves the whole flat manuscript (one file since feature-plan-7):
    // edit a visible line, save, then undo+save restores byte-identical.
    const prosePath = join(COPY_DIR, 'manuscript', 'manuscript.md')
    const proseOriginal = readFileSync(prosePath, 'utf8')
    const line = await evalJs(`(() => {
      const l = [...document.querySelectorAll('.msdoc__editor .cm-line')].find((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.top > 90 && r.bottom < window.innerHeight - 40;
      });
      if (!l) throw new Error('no visible manuscript line to click');
      const r = l.getBoundingClientRect();
      return { x: r.left + Math.min(30, r.width / 2), y: r.top + r.height / 2 };
    })()`)
    await click(line.x, line.y)
    await sleep(200)
    await insertText('QQSMOKE ')
    await sleep(200)
    await key('s', 'KeyS', 4) // ⌘S
    await sleep(900)
    assert(
      readFileSync(prosePath, 'utf8').includes('QQSMOKE'),
      '⌘S in the manuscript editor did not save manuscript.md'
    )
    await key('z', 'KeyZ', 4) // ⌘Z
    await sleep(200)
    await key('s', 'KeyS', 4)
    await sleep(900)
    assert(
      readFileSync(prosePath, 'utf8') === proseOriginal,
      'undo+save did not restore manuscript.md byte-identical'
    )
  })

  /* =======================================================================
     Measured geometry and shell behaviour.

     Every assertion in the four steps below has a KNOWN-BAD baseline measured
     against the build before this batch, so each one fails on the old code
     and passes on the new. None of them can move into a unit test:
     apps/desktop has no jsdom, so every renderer test is node-env and pure,
     and what is being asserted here is the size of a real box.
     ======================================================================= */

  /**
   * Open (or focus) the combined manuscript tab. Activating the Manuscript
   * view IS the open gesture since feature-plan-7 §2 — there is no longer a
   * button in the view to click — and the action toggles the sidebar when its
   * own view is already active, so this always activates it from another one.
   */
  const openManuscript = async () => {
    await evalJs(`(() => {
      const ui = window.__sunaDev.uiStore;
      if (ui.getState().activeView === 'manuscript') ui.setState({ activeView: 'explorer' });
      ui.getState().setActiveView('manuscript');
    })()`)
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if (await evalJs(`!!document.querySelector('.msdoc__editor .cm-content')`)) return
      await sleep(300)
    }
    throw new Error('the combined manuscript tab did not come forward')
  }

  /**
   * A document the demo project does not contain: a viewBox-only SVG figure,
   * a raster taller than the viewport, a raster narrower than the measure, a
   * GFM-aligned table and a display equation — the five block kinds whose
   * geometry the reading surface has to get right, in one file so they are
   * measured against the SAME measure.
   *
   * Written into the project copy (the fs IPC is root-confined, so nothing
   * outside it can be read) and deleted again in the step's finally: the
   * git-view step below asserts the working tree holds exactly ONE change.
   */
  const BL_FILE = join(COPY_DIR, 'block-probe.md')
  const BL_TALL = join(COPY_DIR, 'block-probe-tall.png')
  const BL_SMALL = join(COPY_DIR, 'block-probe-small.png')
  const BL_TALL_PX = { width: 600, height: 1500 }
  const BL_SMALL_PX = { width: 120, height: 80 }
  // Two properties of the running order matter. The file opens with the
  // caret at offset 0 and live preview reveals the source under it, so line 1
  // is BLANK — otherwise the first construct is raw text and not a widget to
  // measure. And the tall image goes last, because it alone is 60vh: with it
  // anywhere earlier, everything after it starts below the fold, where
  // CodeMirror has not rendered a line to measure.
  const BL_FIXTURE = [
    '',
    '$$',
    'E = mc^2',
    '$$',
    '',
    '| Left | Centre | Right |',
    '| :--- | :----: | ----: |',
    '| a | b | c |',
    '',
    '![[fig:fig-spectrum]]',
    '',
    '![small raster](block-probe-small.png)',
    '',
    'Plain prose line for the left-edge reference.',
    '',
    '![tall raster](block-probe-tall.png)',
    ''
  ].join('\n')

  await step('block-layout', async () => {
    try {
      // --- title block: centred on screen, as both exporters already write it
      await openManuscript()
      const title = await evalJs(`(() => {
        const el = document.querySelector('.msdoc__title');
        if (!el) throw new Error('the manuscript tab has no title block');
        return {
          title: getComputedStyle(el).textAlign,
          authors: getComputedStyle(document.querySelector('.msdoc__authors')).textAlign
        };
      })()`)
      // Baseline: 'start' for both, while export-html's pageCss and
      // export-docx's title paragraphs centre them.
      assert(title.title === 'center', `.msdoc__title text-align: ${title.title} (want center)`)
      assert(title.authors === 'center', `.msdoc__authors text-align: ${title.authors}`)

      // Centring must not leak into the click-to-edit faces: those are form
      // rows mounted INSIDE .msdoc__authors, so they inherit it unless they
      // opt back out.
      await evalJs(`document.querySelector('.msdoc__authors.tp__group').click()`)
      await sleep(500)
      const editing = await evalJs(`(() => {
        const el = document.querySelector('.tp__authors-editor');
        if (!el) throw new Error('clicking the authors block did not open its editor');
        return getComputedStyle(el).textAlign;
      })()`)
      assert(editing === 'left', `.tp__authors-editor text-align: ${editing} (want left)`)
      await key('Escape', 'Escape')
      await sleep(400)

      // --- block geometry, on the fixture
      writePng(BL_TALL, BL_TALL_PX.width, BL_TALL_PX.height)
      writePng(BL_SMALL, BL_SMALL_PX.width, BL_SMALL_PX.height)
      assert(
        pngIhdr(BL_TALL).height === BL_TALL_PX.height &&
          pngIhdr(BL_SMALL).width === BL_SMALL_PX.width,
        'the generated PNG fixtures do not decode at the sizes they were written at'
      )
      writeFileSync(BL_FILE, BL_FIXTURE, 'utf8')
      // A persisted slider position must not decide what this step measures.
      await evalJs(`window.__sunaDev.editorSettings.getState().reset()`)
      await evalJs(`window.__sunaDev.dock.clearDock()`)
      await sleep(300)
      await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(BL_FILE)})`)
      await sleep(1600)
      const mode = await evalJs(`document.querySelector('.editor-tab__mode')?.textContent`)
      assert(mode === 'Reading', `fixture did not open in Reading (got ${mode})`)

      // Both assets are read over IPC, so the widgets paint themselves in
      // asynchronously — measuring before that is measuring the placeholder.
      let painted = false
      for (let i = 0; i < 40 && !painted; i++) {
        painted = await evalJs(`(() => {
          const svg = document.querySelector('.cm-lp-figure__svg > svg');
          const imgs = [...document.querySelectorAll('.cm-lp-image .cm-lp-figure__img')];
          return svg !== null && imgs.length === 2 &&
            imgs.every((i) => i.complete && i.naturalWidth > 0);
        })()`)
        if (!painted) await sleep(300)
      }
      assert(painted, 'the figure/image widgets never finished loading their assets')
      await sleep(400)
      await screenshot('block-layout.png')

      const geometry = await evalJs(`(() => {
        const host = [...document.querySelectorAll('.editor-tab')]
          .find((h) => h.getBoundingClientRect().width > 0);
        if (!host) throw new Error('no visible editor tab');
        const content = host.querySelector('.cm-content');
        // Content-box left, not the border box: a block widget shares the
        // prose's left edge by carrying .cm-line's own padding, so the border
        // boxes are equal either way and only the content edges tell them apart.
        const box = (el, what) => {
          if (!el) throw new Error('missing from the reading surface: ' + what);
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            width: r.width,
            height: r.height,
            right: r.right,
            centre: r.left + r.width / 2,
            contentLeft: r.left + parseFloat(cs.paddingLeft)
          };
        };
        const svg = host.querySelector('.cm-lp-figure__svg > svg');
        const viewBox = (svg ? svg.getAttribute('viewBox') : '').trim().split(/[\\s,]+/);
        // Picked by natural size rather than document order, so reordering
        // the fixture cannot silently swap which image each guard measures.
        const imgs = [...host.querySelectorAll('.cm-lp-image .cm-lp-figure__img')];
        const shot = (naturalHeight, what) => {
          const img = imgs.find((i) => i.naturalHeight === naturalHeight);
          return {
            ...box(img, what),
            naturalRatio: img.naturalWidth / img.naturalHeight
          };
        };
        return {
          viewportHeight: window.innerHeight,
          imageCap: getComputedStyle(host).getPropertyValue('--ed-img-max-h').trim(),
          content: box(content, '.cm-content'),
          line: box(
            [...host.querySelectorAll('.cm-line')].find((l) => l.textContent.includes('Plain prose')),
            'the plain prose line'
          ),
          figure: box(host.querySelector('.cm-lp-figure:not(.cm-lp-image)'), 'the figure embed'),
          svg: box(svg, 'the inlined figure SVG'),
          svgRatio: Number(viewBox[2]) / Number(viewBox[3]),
          table: box(host.querySelector('.cm-lp-table'), 'the table widget'),
          tableInner: box(host.querySelector('.cm-lp-table table'), 'the rendered table'),
          math: box(host.querySelector('.cm-lp-math-block'), 'the display-math widget'),
          katex: box(host.querySelector('.cm-lp-math-block .katex-display'), 'the rendered equation'),
          tall: shot(${BL_TALL_PX.height}, 'the tall raster'),
          small: shot(${BL_SMALL_PX.height}, 'the small raster')
        };
      })()`)

      // 1. An inlined viewBox-only SVG has a real size. Baseline: 0×0 — it was
      //    a flex item with no intrinsic size, so every SVG figure in reading
      //    mode was invisible.
      assert(
        geometry.svg.width > 0 && geometry.svg.height > 0,
        `the inlined figure SVG renders ${geometry.svg.width}×${geometry.svg.height} (want non-zero)`
      )
      assert(
        Math.abs(geometry.svg.width / geometry.svg.height - geometry.svgRatio) < 0.01,
        `figure SVG aspect ${geometry.svg.width / geometry.svg.height} ≠ viewBox ${geometry.svgRatio}`
      )

      // 2. A tall raster is clamped, and clamping scales it rather than
      //    squashing it. Baseline: no max-height anywhere in the editor zone,
      //    so a 2074×1895 PNG rendered 1012×925 — taller than the window.
      assert(geometry.imageCap === '60vh', `image cap token: ${geometry.imageCap} (want 60vh)`)
      const cap = geometry.viewportHeight * 0.6
      assert(
        geometry.tall.height <= cap + 1,
        `a ${BL_TALL_PX.width}×${BL_TALL_PX.height} PNG renders ${geometry.tall.height}px tall (cap ${cap})`
      )
      assert(
        geometry.tall.width <= geometry.content.width,
        `the tall image is ${geometry.tall.width}px wide, past the ${geometry.content.width}px measure`
      )
      assert(
        Math.abs(geometry.tall.width / geometry.tall.height - geometry.tall.naturalRatio) < 0.01,
        `clamping distorted the raster: ${geometry.tall.width / geometry.tall.height} vs natural ${geometry.tall.naturalRatio}`
      )
      // 3. …and the clamp is max-*, not a definite size: an image smaller than
      //    the measure is not blown up to fill it.
      assert(
        Math.abs(geometry.small.width - BL_SMALL_PX.width) < 0.5 &&
          Math.abs(geometry.small.height - BL_SMALL_PX.height) < 0.5,
        `a ${BL_SMALL_PX.width}×${BL_SMALL_PX.height} PNG was resized to ${geometry.small.width}×${geometry.small.height}`
      )

      // 4. Every block widget starts where the prose starts. Baseline: the
      //    figure overhung its neighbours by 16px per side, because
      //    .cm-lp-figure had `padding: 0` while its siblings added .cm-line's
      //    own padding back by hand.
      for (const [what, measured] of [
        ['figure', geometry.figure],
        ['table', geometry.table],
        ['math block', geometry.math]
      ]) {
        assert(
          Math.abs(measured.contentLeft - geometry.line.contentLeft) < 0.5,
          `the ${what}'s left edge is at ${measured.contentLeft}, prose is at ${geometry.line.contentLeft}`
        )
      }

      // 5. A display equation sits on the measure centre. Baseline: 943.0
      //    against a content centre of 959.0 — the equation-number chip's room
      //    was reserved asymmetrically on the padding.
      assert(
        Math.abs(geometry.katex.centre - geometry.content.centre) <= 1,
        `equation centre ${geometry.katex.centre} vs measure centre ${geometry.content.centre}`
      )
      // 6. …and so does a table. Baseline: 629.5 against 959.0 — a shrink-wrapped
      //    table with neither a width nor auto margins hugs the left edge.
      assert(
        Math.abs(geometry.tableInner.centre - geometry.content.centre) <= 1,
        `table centre ${geometry.tableInner.centre} vs measure centre ${geometry.content.centre}`
      )
      assert(
        geometry.tableInner.width < geometry.table.width,
        `the table did not shrink-wrap (${geometry.tableInner.width} of ${geometry.table.width}) — centring it proves nothing`
      )
    } finally {
      for (const file of [BL_FILE, BL_TALL, BL_SMALL]) rmSync(file, { force: true })
      await evalJs(`window.__sunaDev.dock.closePanel(${JSON.stringify(BL_FILE)})`).catch(() => {})
      await evalJs(`window.__sunaDev.projectStore.getState().refreshTree()`).catch(() => {})
    }
  })

  await step('vim-motions', async () => {
    // The scratch userData starts every run with no settings.json, so vim is
    // off for every other step and this one has to turn it on itself — and
    // turn it back off, or every later step's typing lands in normal mode.
    const VIM_FILE = join(COPY_DIR, 'vim-probe.md')
    try {
      writeFileSync(VIM_FILE, 'first line\nsecond line\nthird line\n', 'utf8')
      await evalJs(
        `window.__sunaDev.settingsStore.getState().setGlobal('editor.vimMotions', true)`
      )
      let resolved = null
      for (let i = 0; i < 20 && resolved !== true; i++) {
        resolved = await evalJs(
          `window.__sunaDev.settingsStore.getState().resolved.value['editor.vimMotions']`
        )
        if (resolved !== true) await sleep(250)
      }
      assert(resolved === true, `the resolver never reported vim on: ${resolved}`)

      // Both surfaces, each measured while it is the frontmost panel: dockview
      // renders `onlyWhenVisible`, so a hidden panel's DOM is detached and a
      // single read could only ever see one of them. Baseline: the single-file
      // tab was true and the manuscript tab false — ManuscriptEditor built its
      // editor options without a `vim` key at all, and a project lands on it.
      const vimClassOn = (selector) =>
        evalJs(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          return el === null ? null : el.classList.contains('cm-vimMode');
        })()`)
      await openManuscript()
      await sleep(1200)
      const source = await evalJs(
        `window.__sunaDev.settingsStore.getState().resolved.sources['editor.vimMotions']`
      )
      assert(source === 'global', `vim resolved from ${source} (want global)`)
      assert(
        (await vimClassOn('.msdoc__editor .cm-scroller')) === true,
        'the manuscript editor has no vim keymap'
      )

      // The mode chip: the only feedback that normal mode is swallowing plain
      // typing, so it has to be on screen the moment vim is.
      const chip = await evalJs(`(() => {
        const el = document.querySelector('.statusbar__vim');
        if (!el) throw new Error('no vim mode indicator in the status bar');
        return { text: el.textContent.trim(), transform: getComputedStyle(el).textTransform };
      })()`)
      assert(chip.transform === 'uppercase', `mode chip text-transform: ${chip.transform}`)
      assert(chip.text === 'normal', `mode chip reads ${JSON.stringify(chip.text)} (want normal)`)

      // Normal-mode motion in the MANUSCRIPT editor, which had no vim at all.
      // `j` must move the caret and leave the document alone; without vim it
      // would type the letter.
      const caretAt = () => evalJs(`(() => {
        const host = document.querySelector('.msdoc__editor');
        return {
          line: host.querySelector('.cm-activeLine')?.textContent ?? null,
          doc: host.querySelector('.cm-content').textContent,
          blockCursor: host.querySelectorAll('.cm-vimCursorLayer .cm-fat-cursor').length
        };
      })()`)
      // The title page sits above the editor inside the scrolling .msdoc, so
      // the first prose line can start below the fold — measure after
      // scrolling it into view, or the click lands on whatever is at those
      // coordinates instead.
      await evalJs(
        `document.querySelector('.msdoc__editor .cm-line').scrollIntoView({ block: 'center' })`
      )
      await sleep(500)
      const first = await evalJs(`(() => {
        const line = document.querySelector('.msdoc__editor .cm-line');
        const r = line.getBoundingClientRect();
        return { x: r.left + Math.min(30, r.width / 2), y: r.top + r.height / 2 };
      })()`)
      await click(first.x, first.y)
      await sleep(300)
      await key('Escape', 'Escape')
      await sleep(300)
      const before = await caretAt()
      assert(before.blockCursor > 0, 'normal mode draws no block cursor in the manuscript editor')
      for (let i = 0; i < 3; i++) {
        await key('j', 'KeyJ')
        await sleep(120)
      }
      await sleep(300)
      const after = await caretAt()
      assert(after.doc === before.doc, "'j' in normal mode typed into the manuscript instead of moving")
      assert(
        after.line !== before.line,
        `'j' did not move the caret (active line stayed ${JSON.stringify(before.line)})`
      )

      // `i` → insert, Escape → normal, both reported by the chip.
      const chipText = () =>
        evalJs(`document.querySelector('.statusbar__vim')?.textContent.trim() ?? null`)
      await key('i', 'KeyI')
      await sleep(300)
      assert((await chipText()) === 'insert', `mode chip after 'i': ${await chipText()}`)
      await key('Escape', 'Escape')
      await sleep(300)
      assert((await chipText()) === 'normal', `mode chip after Escape: ${await chipText()}`)

      // `:w` on a scratch file in a single-file tab — the other surface, and
      // the one `:q` and `:w` were written for. Baseline: `:w` was a
      // guaranteed no-op, because vim's own `write` is
      // `CM.commands.save ?? cm.save()` and the CM6 shim defines neither.
      await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(VIM_FILE)})`)
      await sleep(1800)
      assert(
        (await vimClassOn('.editor-tab__cm .cm-scroller')) === true,
        'the single-file editor tab has no vim keymap'
      )
      await evalJs(`document.querySelector('.editor-tab__cm .cm-content').focus()`)
      await sleep(200)
      await key('Escape', 'Escape')
      await sleep(200)
      await key('i', 'KeyI')
      await sleep(200)
      await insertText('VIMSMOKE ')
      await sleep(300)
      await key('Escape', 'Escape')
      await sleep(300)
      await evalJs(`window.__sunaDev.uiStore.getState().setStatusNote(null)`)
      await key(':', 'Semicolon', 8)
      await sleep(500)
      const commandLine = await evalJs(
        `document.querySelector('.editor-tab .cm-panels-bottom input') !== null`
      )
      assert(commandLine, "':' did not open vim's command line")
      await insertText('w')
      await sleep(250)
      const typed = await evalJs(
        `document.querySelector('.editor-tab .cm-panels-bottom input').value`
      )
      assert(typed === 'w', `the command line holds ${JSON.stringify(typed)} (want "w")`)
      // The vim dialog's own submit handler tests `event.keyCode == 13`, and
      // CDP leaves keyCode at 0 unless the virtual key code is passed — so
      // this Enter cannot go through the suite's `key()` helper.
      for (const type of ['keyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', {
          type,
          key: 'Enter',
          code: 'Enter',
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13
        })
      }
      await sleep(900)
      const saved = await evalJs(`window.__sunaDev.uiStore.getState().statusNote`)
      assert(
        String(saved).startsWith('Saved'),
        `':w' did not reach the host's save path (status note: ${JSON.stringify(saved)})`
      )
      assert(
        readFileSync(VIM_FILE, 'utf8').includes('VIMSMOKE'),
        `':w' did not write the file:\n${readFileSync(VIM_FILE, 'utf8')}`
      )
    } finally {
      await evalJs(
        `window.__sunaDev.settingsStore.getState().setGlobal('editor.vimMotions', false)`
      ).catch(() => {})
      await sleep(600)
      await evalJs(`window.__sunaDev.dock.closePanel(${JSON.stringify(VIM_FILE)})`).catch(() => {})
      rmSync(VIM_FILE, { force: true })
      await evalJs(`window.__sunaDev.projectStore.getState().refreshTree()`).catch(() => {})
    }
  })

  await step('left-nav-collapse', async () => {
    /** Everything the three nav states are asserted on, in one read. */
    const chrome = () => evalJs(`(() => {
      const workbench = document.querySelector('.workbench');
      const toggle = document.querySelector('.titlebar__nav-toggle');
      const stage = document.querySelector('.dock-stage');
      const ui = window.__sunaDev.uiStore.getState();
      return {
        cls: workbench.className,
        rail: !!document.querySelector('.activitybar'),
        panel: !!document.querySelector('.sidebar'),
        toggleVisible: toggle !== null && toggle.getBoundingClientRect().width > 0,
        stageWidth: stage.getBoundingClientRect().width,
        panelWidth: document.querySelector('.sidebar')?.getBoundingClientRect().width ?? 0,
        storeWidth: ui.sidebarWidth,
        savedWidth: window.localStorage.getItem('suna.sidebarWidth'),
        savedPanel: window.localStorage.getItem('suna.sidebarVisible'),
        savedRail: window.localStorage.getItem('suna.activityBarVisible')
      };
    })()`)
    const runCommand = (id) =>
      evalJs(`window.__sunaDev.commands.runCommand(${JSON.stringify(id)})`)

    /**
     * Put the shell back however this step ends. It is the only step that can
     * leave the app with no activity bar, and every later step reaches its
     * view by clicking one — so a failure here would otherwise fail the whole
     * suite behind it. showView writes the store directly and cannot restore
     * railVisible, so this goes through the actions.
     */
    const restoreChrome = async () => {
      await evalJs(`(() => {
        const ui = window.__sunaDev.uiStore.getState();
        ui.setRailVisible(true);
        ui.setSidebarVisible(true);
        ui.setSidebarWidth(272);
      })()`)
      await evalJs(`window.__sunaDev.dock.clearDock()`)
      await sleep(500)
    }

    try {
      // A non-default width, so "restores what the user chose" is a real claim.
      await evalJs(`window.__sunaDev.uiStore.getState().setSidebarWidth(330)`)
      await sleep(400)
      const full = await chrome()
      assert(full.rail && full.panel, 'the nav did not start in its full state')
      assert(Math.round(full.panelWidth) === 330, `sidebar width: ${full.panelWidth} (want 330)`)

      // full → rail only
      assert(await runCommand('view.sidebar.toggle'), 'view.sidebar.toggle is not registered')
      await sleep(500)
      const rail = await chrome()
      assert(rail.cls.includes('workbench--sidebar-hidden'), `rail-only class: ${rail.cls}`)
      assert(rail.rail && !rail.panel, `rail-only state: rail=${rail.rail} panel=${rail.panel}`)
      assert(
        Math.abs(rail.stageWidth - (full.stageWidth + 330)) <= 1,
        `hiding the panel widened the dock by ${rail.stageWidth - full.stageWidth} (want 330)`
      )

      // rail only → nothing. Baseline: unreachable — sidebarVisible was the
      // only flag, ActivityBar rendered unconditionally, neither was persisted.
      assert(await runCommand('view.leftnav.toggle'), 'view.leftnav.toggle is not registered')
      await sleep(500)
      const hidden = await chrome()
      assert(hidden.cls.includes('workbench--nav-hidden'), `nav-hidden class: ${hidden.cls}`)
      assert(!hidden.rail && !hidden.panel, `hidden: rail=${hidden.rail} panel=${hidden.panel}`)
      assert(
        Math.abs(hidden.stageWidth - (full.stageWidth + 330 + 46)) <= 1,
        `hiding the rail widened the dock by ${hidden.stageWidth - full.stageWidth} (want 376)`
      )
      assert(
        hidden.savedPanel === 'false' && hidden.savedRail === 'false',
        `the hidden state was not persisted: ${JSON.stringify(hidden)}`
      )
      // The restore button in EVERY state, this one above all: the flags
      // survive a restart, so an app that starts fully hidden with a
      // conditional button would have no way back.
      for (const [what, state] of [['full', full], ['rail-only', rail], ['hidden', hidden]]) {
        assert(state.toggleVisible, `.titlebar__nav-toggle is not visible in the ${what} state`)
      }
      await screenshot('left-nav-hidden.png')

      // …and back, to the width the user chose rather than the default.
      assert(await runCommand('view.leftnav.toggle'), 'view.leftnav.toggle did not run twice')
      await sleep(500)
      const restored = await chrome()
      assert(
        restored.rail && restored.panel && !restored.cls.includes('--hidden'),
        `restoring the nav left ${restored.cls}`
      )
      assert(
        Math.round(restored.panelWidth) === 330,
        `restored width ${restored.panelWidth} (want the chosen 330, not the 272 default)`
      )
      assert(
        restored.savedPanel === 'true' && restored.savedRail === 'true',
        `the restored state was not persisted: ${JSON.stringify(restored)}`
      )

      // Dragging the handle past the collapse threshold hides the panel and
      // leaves the remembered width alone. Baseline: clampSidebarWidth floored
      // at 180, so a drag to the left edge just parked there.
      const handle = await evalJs(`(() => {
        const el = document.querySelector('.sidebar__resize');
        const aside = document.querySelector('.sidebar');
        const r = el.getBoundingClientRect();
        const a = aside.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, target: a.left - 60 };
      })()`)
      // Synthetic PointerEvents for the same reason sidebar-resize uses them:
      // CDP mouse coordinates go through the device-metrics override and miss
      // the 4px handle on a fractional-scale display.
      await evalJs(`(() => {
        const el = document.querySelector('.sidebar__resize');
        const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 };
        el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: ${handle.x}, clientY: ${handle.y} }));
        el.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: ${handle.target}, clientY: ${handle.y} }));
        el.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0, clientX: ${handle.target}, clientY: ${handle.y} }));
      })()`)
      await sleep(500)
      const dragged = await chrome()
      assert(!dragged.panel, 'dragging the handle past the collapse threshold did not hide the panel')
      assert(dragged.rail, 'collapsing the panel by drag also took the rail with it')
      assert(
        dragged.storeWidth === 330 && dragged.savedWidth === '330',
        `the collapse drag overwrote the remembered width: ${dragged.storeWidth}/${dragged.savedWidth}`
      )

      // With an editor open, hiding the whole nav has to leave CodeMirror's
      // coordinate map correct — the only real proof that no manual
      // remeasure() is needed after the grid loses a column. Measured on the
      // SCROLLER: .cm-content is capped at the content-width measure on a
      // prose file, so it does not grow with the pane and would prove nothing.
      await evalJs(`window.__sunaDev.dock.clearDock()`)
      await sleep(300)
      await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(join(COPY_DIR, 'README.md'))})`)
      await sleep(1600)
      const scroller = () =>
        evalJs(`document.querySelector('.editor-tab .cm-scroller').getBoundingClientRect().width`)
      const narrow = await scroller()
      await runCommand('view.leftnav.toggle')
      await sleep(700)
      const wide = await scroller()
      assert(
        Math.abs(wide - (narrow + 46)) <= 1,
        `hiding the rail widened the editor by ${wide - narrow} (want the rail's 46px)`
      )
      const secondLine = await evalJs(`(() => {
        const line = [...document.querySelectorAll('.cm-line')][1];
        const r = line.getBoundingClientRect();
        return { text: line.textContent, x: r.left + 2, y: r.top + r.height / 2 };
      })()`)
      await click(secondLine.x, secondLine.y)
      await sleep(400)
      const landed = await evalJs(`document.querySelector('.cm-activeLine')?.textContent ?? null`)
      assert(
        landed === secondLine.text,
        `after the resize a click on line 2 landed on ${JSON.stringify(landed)} (want ${JSON.stringify(secondLine.text)})`
      )
    } finally {
      await restoreChrome()
    }
    const finalState = await chrome()
    assert(
      finalState.rail && finalState.panel,
      `the nav was left in ${finalState.cls} for the steps below`
    )
  })

  await step('tree-icons', async () => {
    const EMPTY_DIR = join(COPY_DIR, 'empty-e2e')
    const BIB = join(COPY_DIR, 'manuscript', 'references.bib')
    try {
      await evalJs(`(async () => {
        await window.suna.invoke('fs:mkdir', { path: ${JSON.stringify(EMPTY_DIR)} });
        await window.__sunaDev.projectStore.getState().refreshTree();
      })()`)
      await showView('explorer')
      await sleep(600)
      // A file open in a tab, so the open-row treatment has something to mark.
      await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(BIB)})`)
      await sleep(1200)
      await showView('explorer')
      await sleep(500)

      const rows = await evalJs(`(() => {
        const all = [...document.querySelectorAll('.tree__row')];
        const byName = (name) => all.find((r) => (r.dataset.path ?? '').split('/').pop() === name);
        const icon = (row) => row.querySelector('.tree__icon svg');
        const railIcon = [...document.querySelectorAll('.activitybar__item')]
          .find((b) => b.title.startsWith('Figures'))?.querySelector('svg');
        const figures = byName('figures');
        const empty = byName('empty-e2e');
        const manuscript = byName('manuscript.md');
        const bib = byName('references.bib');
        if (!figures || !empty || !manuscript || !bib) {
          throw new Error('expected tree rows are missing: ' + all.map((r) => r.dataset.path).join(','));
        }
        return {
          total: all.length,
          withOneIcon: all.filter((r) => r.querySelectorAll('.tree__icon svg').length === 1).length,
          glyphRows: all.filter((r) => /[▾▸]/.test(r.textContent)).length,
          figuresIcon: icon(figures).innerHTML,
          railFiguresIcon: railIcon ? railIcon.innerHTML : null,
          manuscriptIcon: icon(manuscript).innerHTML,
          bibIcon: icon(bib).innerHTML,
          folderClosed: icon(empty).innerHTML,
          emptyClass: empty.className,
          emptyChevron: empty.querySelectorAll('.tree__chevron svg').length,
          emptyExpanded: empty.getAttribute('aria-expanded'),
          openIcon: getComputedStyle(bib.querySelector('.tree__icon')).color,
          plainIcon: getComputedStyle(manuscript.querySelector('.tree__icon')).color
        };
      })()`)
      // Baseline: rows carried a '▾'/'▸' text glyph and no icon element at all.
      assert(
        rows.withOneIcon === rows.total,
        `${rows.total - rows.withOneIcon} of ${rows.total} tree rows carry no single .tree__icon svg`
      )
      assert(rows.glyphRows === 0, `${rows.glyphRows} tree rows still print a chevron text glyph`)
      assert(
        rows.manuscriptIcon !== rows.bibIcon,
        'manuscript.md and references.bib draw the same icon — the file-kind map is not wired'
      )
      assert(
        rows.figuresIcon === rows.railFiguresIcon,
        'the figures/ folder does not reuse the Figures activity-bar icon'
      )
      assert(
        rows.folderClosed !== rows.figuresIcon,
        'a plain folder and a project directory draw the same icon'
      )
      // An empty directory promises nothing it cannot deliver.
      assert(rows.emptyClass.includes('tree__row--empty'), `empty folder classes: ${rows.emptyClass}`)
      assert(rows.emptyChevron === 0, 'an empty folder still draws a disclosure chevron')
      assert(rows.emptyExpanded === null, `an empty folder reports aria-expanded=${rows.emptyExpanded}`)
      // The open marker moved onto the icon: tinting the NAME would resolve to
      // the same --s-ink a directory row uses and make an open file read as
      // a folder.
      assert(
        rows.openIcon !== rows.plainIcon,
        `an open file's icon is not distinguished (${rows.openIcon})`
      )

      // Folder open vs closed are two different marks, not one rotated glyph.
      // Measured on fig-spectrum/, not on a suna.json directory: those carry
      // their own semantic icon and never switch.
      const folderIcon = () => evalJs(`(() => {
        const row = [...document.querySelectorAll('.tree__row')]
          .find((r) => (r.dataset.path ?? '').split('/').pop() === 'fig-spectrum');
        if (!row) throw new Error('no fig-spectrum/ row in the tree');
        return { path: row.dataset.path, icon: row.querySelector('.tree__icon svg').innerHTML,
                 expanded: row.getAttribute('aria-expanded') };
      })()`)
      const opened = await folderIcon()
      assert(opened.expanded === 'true', `fig-spectrum/ starts collapsed (${opened.expanded})`)
      await evalJs(
        `window.__sunaDev.explorerStore.getState().toggleExpanded(${JSON.stringify(opened.path)})`
      )
      await sleep(400)
      const closed = await folderIcon()
      assert(closed.expanded === 'false', `collapsing fig-spectrum/ left aria-expanded=${closed.expanded}`)
      assert(
        closed.icon !== opened.icon,
        'the folder icon is identical open and closed — no open/closed mark is drawn'
      )
      await evalJs(
        `window.__sunaDev.explorerStore.getState().toggleExpanded(${JSON.stringify(opened.path)})`
      )
      await sleep(300)

      // The confirmed CSS load-order defect: app.css is injected after
      // explorer.css, so at equal specificity its .tree__row:hover repainted a
      // hovered selected row with the hover tint.
      const hovered = await evalJs(`(() => {
        const row = [...document.querySelectorAll('.tree__row')]
          .find((r) => (r.dataset.path ?? '').split('/').pop() === 'references.bib');
        window.__sunaDev.explorerStore.setState({ selection: [row.dataset.path] });
        const r = row.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`)
      await sleep(300)
      await mouse('mouseMoved', hovered.x, hovered.y)
      await sleep(300)
      const bands = await evalJs(`(() => {
        const row = [...document.querySelectorAll('.tree__row')]
          .find((r) => (r.dataset.path ?? '').split('/').pop() === 'references.bib');
        const norm = (v) => v.replace(/\\s+/g, '');
        const root = getComputedStyle(document.documentElement);
        return {
          hovering: row.matches(':hover'),
          background: norm(getComputedStyle(row).backgroundColor),
          selected: norm(root.getPropertyValue('--s-bg-selected')),
          hover: norm(root.getPropertyValue('--s-bg-hover')),
          icon: getComputedStyle(row.querySelector('.tree__icon')).color
        };
      })()`)
      assert(bands.hovering, 'the pointer is not over the selected row — the band test proves nothing')
      assert(
        bands.background === bands.selected,
        `a hovered selected row paints ${bands.background} (want the selected band ${bands.selected}, not the hover tint ${bands.hover})`
      )
      // Same defect class, one layer down: `.tree__row:hover .tree__icon` is
      // (0,3,0) and `.tree__row--open .tree__icon` is (0,2,0), so hovering an
      // open row used to erase the only per-row 'this file is open' signal.
      // references.bib is open (a tab was opened above) and is the row the
      // pointer is on, so this is the exact case.
      assert(
        bands.icon === rows.openIcon,
        `hovering an open row repaints its icon ${bands.icon} (unhovered it is ${rows.openIcon})`
      )
      await screenshot('tree-icons.png')
    } finally {
      await evalJs(`window.__sunaDev.dock.closePanel(${JSON.stringify(BIB)})`).catch(() => {})
      await evalJs(`window.__sunaDev.explorerStore.setState({ selection: [] })`).catch(() => {})
      rmSync(EMPTY_DIR, { recursive: true, force: true })
      await evalJs(`window.__sunaDev.projectStore.getState().refreshTree()`).catch(() => {})
    }
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
      const read = async (p) =>
        (await window.suna.invoke('fs:read-text', { path: dir + '/' + p }).catch(() => ({ content: '' }))).content;
      return {
        path,
        config: JSON.parse(content),
        agents: await read('AGENTS.md'),
        claude: await read('CLAUDE.md'),
        notebook: await read('context/NOTEBOOK.md'),
        gitignore: await read('.gitignore')
      };
    })()`)
    const server = written.config.mcpServers?.suna
    assert(server !== undefined, `.mcp.json has no suna server: ${JSON.stringify(written.config)}`)
    assert(
      String(server.args?.[0] ?? '').endsWith('server.mjs'),
      `mcp server path looks wrong: ${JSON.stringify(server.args)}`
    )
    assert(existsSync(server.args[0]), `mcp server bundle missing at ${server.args[0]}`)
    // adr-004: the write heals the whole agent layer, not just .mcp.json
    assert(written.agents.includes('suna:agent-stub'), 'AGENTS.md stub missing after heal')
    assert(written.claude.includes('suna:agent-stub'), 'CLAUDE.md stub missing after heal')
    assert(written.notebook.includes('Session log'), 'context/NOTEBOOK.md missing after heal')
    assert(
      written.gitignore.split('\n').some((l) => l.trim() === '.mcp.json'),
      '.gitignore does not ignore .mcp.json after heal'
    )
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
    await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify('__D__/manuscript/manuscript.md')}.replace('__D__', ${JSON.stringify(dir)}))`)
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
    // The combined tab opens by focusing its dock tab (or activating the
    // Manuscript view, which opens it directly — the .ms__open button is
    // gone). ONE editor over the flat manuscript.md since feature-plan-7.
    const focused = await evalJs(`(() => {
      const tab = [...document.querySelectorAll('.dv-tab')]
        .find((t) => t.textContent.trim().replace(/\s*[•✕×]\s*$/, '') === 'Manuscript');
      if (!tab) return false;
      // dockview activates on POINTERDOWN — a plain click() only ever
      // "worked" when the panel was already the active one in its group
      const r = tab.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 };
      tab.dispatchEvent(new PointerEvent('pointerdown', opts));
      tab.dispatchEvent(new PointerEvent('pointerup', opts));
      tab.dispatchEvent(new MouseEvent('click', opts));
      return true;
    })()`)
    if (!focused) {
      await activateView('Manuscript')
      await sleep(500)
    }
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const n = await evalJs(`document.querySelectorAll('.msdoc__editor .cm-content').length`)
      if (n === 1) return
      await sleep(300)
    }
    throw new Error('combined manuscript tab did not come forward with its editor')
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
      // ONE editor over the whole flat file now: centering it would put its
      // first line far above the viewport. Scroll to the top and pick a
      // VISIBLE line instead.
      document.querySelector('.msdoc').scrollTop = 0;
      await new Promise((r) => setTimeout(r, 600));
      const line = [...document.querySelectorAll('.msdoc__editor .cm-line')].find((l) => {
        const b = l.getBoundingClientRect();
        return b.width > 0 && b.top > 90 && b.bottom < window.innerHeight - 40;
      });
      if (!line) throw new Error('no visible manuscript line');
      const r = line.getBoundingClientRect();
      // near the line's LEFT edge: the right edge can sit under the scroll
      // container's overlay-scrollbar strip, which hit-tests to .msdoc
      const x = r.left + Math.min(30, r.width / 2);
      const y = r.top + r.height / 2;
      // the point must really be over the editor — a panel covering it would
      // silently send the keystrokes somewhere else (e.g. the terminal)
      const hit = document.elementFromPoint(x, y);
      if (hit === null || hit.closest('.msdoc__editor') === null) {
        throw new Error('click point is not over the section editor: ' + (hit ? hit.className : 'nothing'));
      }
      return { x, y };
    })()`)
    const introPath = join(COPY_DIR, 'manuscript', 'manuscript.md')
    const introBefore = readFileSync(introPath, 'utf8')
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
    // Autosave (on by default) writes the typing out and writes the undo back,
    // so the invariant is the end state, not "never written": this probe must
    // leave manuscript.md exactly as it found it. Waits out one autosave idle.
    await sleep(1600)
    assert(
      readFileSync(introPath, 'utf8') === introBefore,
      'the bogus-crossref probe left manuscript.md changed'
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
  const AUTHORS_JSON = join(COPY_DIR, 'manuscript', 'authors.json')
  const COMMENTS_JSON = join(COPY_DIR, 'manuscript', 'comments.json')
  const MANUSCRIPT_MD = join(COPY_DIR, 'manuscript', 'manuscript.md')
  const BIB = join(COPY_DIR, 'manuscript', 'references.bib')

  /** Make the combined manuscript tab the active dock panel. */
  const openManuscriptDoc = async () => {
    const focused = await evalJs(`(() => {
      const tab = [...document.querySelectorAll('.dv-tab')]
        .find((t) => t.textContent.trim().replace(/\\s*[•✕×]\\s*$/, '') === 'Manuscript');
      if (!tab) return false;
      // dockview activates on POINTERDOWN — a plain click() only ever
      // "worked" when the panel was already the active one in its group
      const r = tab.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 };
      tab.dispatchEvent(new PointerEvent('pointerdown', opts));
      tab.dispatchEvent(new PointerEvent('pointerup', opts));
      tab.dispatchEvent(new MouseEvent('click', opts));
      return true;
    })()`)
    if (!focused) {
      // activating the Manuscript view opens the combined tab directly
      await showView('manuscript')
      await sleep(700)
    }
    await sleep(2000)
    const up = await evalJs(`!!document.querySelector('.msdoc__titlepage')`)
    if (!up) {
      const diag = await evalJs(`({
        tabs: [...document.querySelectorAll('.dv-tab')].map((t) => t.textContent.trim()),
        msdoc: !!document.querySelector('.msdoc'),
        hint: document.querySelector('.msdoc__hint')?.textContent ?? null,
        error: document.querySelector('.msdoc__error')?.textContent ?? null,
        app: !!document.querySelector('.app')
      })`)
      assert(false, 'combined manuscript tab did not come up: ' + JSON.stringify(diag))
    }
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
    const renamed = JSON.parse(readFileSync(AUTHORS_JSON, 'utf8'))
    assert(
      renamed.authors[1].family === 'Kowalczyk',
      `authors.json author 2: ${renamed.authors[1].family}`
    )
    assert(renamed.authors[0].family === 'Researcher', 'the other author was disturbed')
    assert(Array.isArray(renamed.affiliations) && renamed.affiliations.length === 2,
      'affiliations were disturbed by an author rename')

    // --- an invalid ORCID: inline error, file byte-identical ---------------
    const before = readFileSync(AUTHORS_JSON)
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
      readFileSync(AUTHORS_JSON).equals(before),
      'an invalid ORCID reached authors.json — the file changed'
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
    const onDisk = JSON.parse(readFileSync(AUTHORS_JSON, 'utf8'))
    assert(onDisk.authors[0].id === 'a2', `author order on disk: ${onDisk.authors.map((a) => a.id)}`)
    // superscripts are derived: nothing numeric is persisted
    assert(
      !JSON.stringify(onDisk.affiliations).includes('"number"'),
      'affiliation numbers were persisted — they must stay derived'
    )
    await screenshot('20-title-page-edit.png')
  })

  /**
   * feature-plan-3 §1 acceptance, measured against the FILE ON DISK: ⌘B wraps
   * the selection in `**`, ⌘B again removes it, the context menu offers the
   * documented items with Comment enabled only on a selection, and a menu
   * action is exactly one undo step. Runs before the comment steps so
   * 02-results.md is still pristine.
   */
  await step('markdown-formatting-and-context-menu', async () => {
    await openManuscriptDoc()
    const original = readFileSync(MANUSCRIPT_MD, 'utf8')
    const saveSection = async () => {
      await key('s', 'KeyS', 4)
      await sleep(1200)
    }

    // --- ⌘B on a word -> **word** on disk, ⌘B again -> back ----------------
    assert(
      (await dragSelectInSection('centroid')) === 'centroid',
      'could not select the word to format'
    )
    await key('b', 'KeyB', 4)
    await sleep(350)
    await saveSection()
    assert(
      readFileSync(MANUSCRIPT_MD, 'utf8').includes('**centroid**'),
      '⌘B did not write **centroid** to the section file'
    )
    await key('b', 'KeyB', 4)
    await sleep(350)
    await saveSection()
    assert(
      readFileSync(MANUSCRIPT_MD, 'utf8') === original,
      '⌘B a second time did not restore the file byte-for-byte'
    )

    // --- right-click WITH a selection: the documented menu ------------------
    assert((await dragSelectInSection('centroid')) === 'centroid', 'could not reselect')
    const at = await evalJs(`(() => {
      const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)
    await rclick(at.x, at.y)
    await sleep(500)
    const menu = await evalJs(`(() => {
      const m = document.querySelector('.md-ctxmenu');
      if (!m) return null;
      return [...m.querySelectorAll('.md-ctxmenu__item')]
        .map((b) => ({ id: b.dataset.action, disabled: b.disabled }));
    })()`)
    assert(menu !== null, 'right-click did not open the editor context menu')
    const ids = menu.map((i) => i.id)
    for (const want of ['comment', 'bold', 'italic', 'code', 'strikethrough', 'link', 'insertCitation', 'cut', 'copy', 'paste']) {
      assert(ids.includes(want), `context menu is missing "${want}": ${ids.join(', ')}`)
    }
    assert(
      menu.find((i) => i.id === 'comment').disabled === false,
      'Comment is disabled even though there is a selection'
    )
    await screenshot('text-context-menu.png')

    // --- a menu action is ONE undo step ------------------------------------
    await evalJs(`document.querySelector('.md-ctxmenu__item[data-action="bold"]').click()`)
    await sleep(400)
    await saveSection()
    assert(readFileSync(MANUSCRIPT_MD, 'utf8').includes('**centroid**'), 'menu Bold did not apply')
    await evalJs(`(() => {
      const cm = [...document.querySelectorAll('.msdoc .cm-editor')].find((e) => e.textContent.includes('centroid'));
      cm.querySelector('.cm-content').focus();
    })()`)
    await sleep(200)
    await key('z', 'KeyZ', 4)
    await sleep(400)
    await saveSection()
    assert(
      readFileSync(MANUSCRIPT_MD, 'utf8') === original,
      'ONE ⌘Z did not undo the whole menu action'
    )

    // --- right-click with NO selection: Comment disabled, Paste enabled -----
    const line = await evalJs(`(() => {
      const cm = [...document.querySelectorAll('.msdoc .cm-editor')].find((e) => e.textContent.includes('centroid'));
      const l = [...cm.querySelectorAll('.cm-line')].find((x) => x.textContent.includes('centroid'));
      const r = l.getBoundingClientRect();
      return { x: r.left + 12, y: r.top + r.height / 2 };
    })()`)
    await click(line.x, line.y)
    await sleep(250)
    await rclick(line.x, line.y)
    await sleep(500)
    const plain = await evalJs(`(() => {
      const m = document.querySelector('.md-ctxmenu');
      if (!m) return null;
      return [...m.querySelectorAll('.md-ctxmenu__item')]
        .map((b) => ({ id: b.dataset.action, disabled: b.disabled }));
    })()`)
    assert(plain !== null, 'right-click with no selection did not open a menu')
    assert(
      plain.find((i) => i.id === 'comment').disabled === true,
      'Comment is enabled with an empty selection'
    )
    assert(
      plain.find((i) => i.id === 'paste').disabled === false,
      'Paste is disabled with no selection'
    )
    await evalJs(`document.querySelector('.md-ctxmenu-scrim')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
    await sleep(300)

    // --- menu "Comment" == ⌘⇧M: same anchored draft ------------------------
    assert((await dragSelectInSection('centroid')) === 'centroid', 'could not reselect for Comment')
    const at2 = await evalJs(`(() => {
      const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)
    await rclick(at2.x, at2.y)
    await sleep(500)
    await evalJs(`document.querySelector('.md-ctxmenu__item[data-action="comment"]').click()`)
    await sleep(700)
    const viaMenu = await evalJs(`(() => {
      const d = window.__sunaDev.commentsStore.getState().draft;
      return d === null ? null : { path: d.target.path, quote: d.target.anchor.quote, preview: d.preview };
    })()`)
    assert(viaMenu !== null, 'menu Comment did not start a draft')
    await evalJs(`window.__sunaDev.commentsStore.getState().cancelDraft()`)
    await sleep(250)

    assert((await dragSelectInSection('centroid')) === 'centroid', 'could not reselect for ⌘⇧M')
    await key('m', 'KeyM', 12)
    await sleep(700)
    const viaKey = await evalJs(`(() => {
      const d = window.__sunaDev.commentsStore.getState().draft;
      return d === null ? null : { path: d.target.path, quote: d.target.anchor.quote, preview: d.preview };
    })()`)
    assert(viaKey !== null, '⌘⇧M did not start a draft')
    assert(
      JSON.stringify(viaKey) === JSON.stringify(viaMenu),
      `menu Comment and ⌘⇧M differ:\n  menu ${JSON.stringify(viaMenu)}\n  key  ${JSON.stringify(viaKey)}`
    )
    // leave no draft/comment behind for the comment steps that follow
    await evalJs(`window.__sunaDev.commentsStore.getState().cancelDraft()`)
    await sleep(250)
    assert(
      readFileSync(MANUSCRIPT_MD, 'utf8') === original,
      'the formatting step left the section file modified'
    )
  })

  await step('comments-select-create-anchor', async () => {
    await openManuscriptDoc()
    const selected = await dragSelectInSection('best-fit centroid of')
    assert(selected === 'best-fit centroid of', `selection in the section editor: ${selected}`)
    await key('m', 'KeyM', 12) // ⌘⇧M
    await sleep(700)
    // The comments rail (comments/CommentsRail): ⌘⇧M sets the store draft AND
    // summons the rail (auto-open), where the composer renders in the list.
    const draft = await evalJs(`(() => {
      const d = window.__sunaDev.commentsStore.getState().draft;
      return {
        path: d?.target?.path ?? null,
        quote: d?.target?.anchor?.quote ?? null,
        railOpen: window.__sunaDev.uiStore.getState().commentsRailVisible,
        composer: !!document.querySelector('.cmt-rail .cmt__draft')
      };
    })()`)
    assert(draft.quote === 'best-fit centroid of', `draft anchor quote: ${draft.quote}`)
    assert(draft.path === 'manuscript.md', `draft target: ${draft.path}`)
    assert(draft.railOpen, 'starting a comment did not auto-open the rail')
    assert(draft.composer, 'no comment composer appeared in the rail')

    await evalJs(
      setFieldJs(
        `document.querySelector('.cmt-rail .cmt__draft .cmt-textarea')`,
        'Should this be the vacuum wavelength?',
        'HTMLTextAreaElement'
      )
    )
    await sleep(150)
    await evalJs(`[...document.querySelectorAll('.cmt-rail .cmt__draft .cmt__btn')]
      .find((b) => b.textContent.trim() === 'Comment').click()`)
    await sleep(1200)

    const file = JSON.parse(readFileSync(COMMENTS_JSON, 'utf8'))
    assert(file.schemaVersion === 1, `comments.json schemaVersion: ${file.schemaVersion}`)
    assert(file.comments.length === 1, `comments.json entries: ${file.comments.length}`)
    assert(
      file.comments[0].target.anchor.quote === 'best-fit centroid of',
      `stored anchor: ${JSON.stringify(file.comments[0].target.anchor)}`
    )
    assert(file.comments[0].author.kind === 'human', 'comment is not attributed to the human')
    // sidecar only: the prose must be untouched
    assert(
      !readFileSync(MANUSCRIPT_MD, 'utf8').includes(file.comments[0].id),
      'a comment marker leaked into the section prose'
    )
    const ui = await evalJs(`({
      // cards carry data-comment-id; the draft composer does not, so this
      // counts REAL threads only even if the composer failed to close.
      cards: document.querySelectorAll('.cmt-rail .cmt-card[data-comment-id]').length,
      drafts: document.querySelectorAll('.cmt-rail .cmt__draft').length,
      anchors: [...document.querySelectorAll('.cm-content .cmt-anchor')].map((a) => a.textContent)
    })`)
    assert(ui.cards === 1, `comment cards in the rail: ${ui.cards}`)
    assert(ui.drafts === 0, 'the draft composer stayed open after the comment was submitted')
    assert(
      ui.anchors.length === 1 && ui.anchors[0] === 'best-fit centroid of',
      `anchor highlight: ${JSON.stringify(ui.anchors)}`
    )
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
    const quote = await dragSelectInSection('best-fit centroid of')
    assert(quote === 'best-fit centroid of', `could not select the quote: ${quote}`)
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
    const gap = await dragSelectInSection('carefully measured ')
    assert(gap === 'carefully measured ', `could not select the gap: ${gap}`)
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
      path: 'manuscript.md',
      quote: 'regular rotation pattern',
      body: 'The kinematic asymmetry needs an uncertainty here.'
    })
    assert(/^added c-/.test(out.trim()), `MCP add_comment said: ${out.trim()}`)
    const state = await reloadComments()
    assert(state.count === 2, `comments after the MCP call: ${state.count}`)
    assert(state.authors.includes('agent'), 'the agent-authored comment is missing')
    assert(state.anchorsInDom === 2, `anchors after the MCP comment: ${state.anchorsInDom}`)

    // Rail cards always render (no viewport-strip collapse any more), sorted
    // by document offset. The flash still proves card -> anchor navigation.
    const agentId = await evalJs(`(() => {
      const c = window.__sunaDev.commentsStore.getState().comments.find((x) => x.author.kind === 'agent');
      if (!c) throw new Error('no agent-authored comment in the store');
      window.__sunaDev.commentsStore.getState().requestFlash(c.id);
      return c.id;
    })()`)
    await sleep(1200)
    const agent = await evalJs(`(() => {
      const card = document.querySelector('.cmt-rail .cmt-card[data-comment-id="' + ${JSON.stringify(agentId)} + '"]');
      const ordered = [...document.querySelectorAll('.cmt-rail .cmt-card[data-comment-id]')]
        .map((c) => c.dataset.commentId);
      const anchors = [...document.querySelectorAll('.msdoc .cm-content .cmt-anchor[data-comment-id]')]
        .map((a) => a.dataset.commentId);
      return {
        card: !!card,
        badge: card ? card.querySelectorAll('.cmt__badge--agent').length : 0,
        listOrder: ordered,
        docOrder: anchors
      };
    })()`)
    assert(agent.card, 'the agent comment has no card in the rail')
    assert(agent.badge === 1, `the agent comment is not visually distinct: ${JSON.stringify(agent)}`)
    assert(
      JSON.stringify(agent.listOrder) === JSON.stringify(agent.docOrder),
      `rail order ${JSON.stringify(agent.listOrder)} != document order ${JSON.stringify(agent.docOrder)}`
    )
    await screenshot('21-comments.png')
  })

  /**
   * The comments rail (flux model): rail interactions measured off real DOM —
   * highlight-click activates + scrolls the card into the rail's viewport,
   * card-click flashes the anchor, delete is immediate with an Undo toast
   * that restores the exact thread, and the resize grip persists its width.
   */
  await step('comments-rail-interactions', async () => {
    await openManuscriptDoc()
    const mode = await evalJs(`({
      rail: !!document.querySelector('.mstab > .cmt-rail'),
      width: document.querySelector('.mstab > .cmt-rail')?.getBoundingClientRect().width ?? 0
    })`)
    assert(mode.rail, 'no comments rail beside the manuscript document')
    assert(mode.width > 200, `the comments rail is only ${mode.width}px wide (expected ~300)`)

    // (a) clicking an in-text highlight activates its card; in the aligned
    // rail the card sits level with the (visible) highlight, so it must
    // already intersect the rail viewport — no rail scrolling exists
    const hl = await evalJs(`(async () => {
      const el = document.querySelector('.msdoc .cm-content .cmt-anchor[data-comment-id]');
      if (!el) return { clicked: false };
      const id = el.dataset.commentId;
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      await new Promise((r) => setTimeout(r, 600));
      const card = document.querySelector('.cmt-rail .cmt-card[data-comment-id="' + id + '"]');
      const vp = document.querySelector('.cmt-rail__viewport');
      const cr = card?.getBoundingClientRect();
      const vr = vp?.getBoundingClientRect();
      return {
        clicked: true,
        storeActive: window.__sunaDev.commentsStore.getState().activeId === id,
        cardActive: card?.classList.contains('cmt-card--active') ?? false,
        inView: !!(cr && vr && cr.bottom > vr.top && cr.top < vr.bottom)
      };
    })()`)
    assert(hl.clicked, 'no anchored highlight to click')
    assert(hl.storeActive, 'clicking a highlight did not activate its thread')
    assert(hl.cardActive, 'the active thread card is not visually active')
    assert(hl.inView, 'the active card is not level with its visible anchor')

    // (a2) anchor alignment: the TOPMOST anchored card (which collision
    // push-down can never move) sits level with its anchor's line, and
    // scrolling the document moves the cards with it 1:1
    const align = await evalJs(`(async () => {
      const measure = () => {
        const pairs = [];
        for (const card of document.querySelectorAll('.cmt-rail__track .cmt-card[data-comment-id]')) {
          const a = document.querySelector('.msdoc .cm-content .cmt-anchor[data-comment-id="' + card.dataset.commentId + '"]');
          if (!a) continue;
          pairs.push({ cardTop: card.getBoundingClientRect().top, anchorTop: a.getBoundingClientRect().top });
        }
        pairs.sort((p, q) => p.anchorTop - q.anchorTop);
        return pairs[0] ?? null;
      };
      const before = measure();
      const scroller = document.querySelector('.msdoc');
      scroller.scrollTop += 120;
      await new Promise((r) => setTimeout(r, 300));
      const after = measure();
      scroller.scrollTop -= 120;
      await new Promise((r) => setTimeout(r, 300));
      return { before, after };
    })()`)
    assert(align.before !== null, 'no visible card/anchor pair to measure alignment on')
    assert(
      Math.abs(align.before.cardTop - align.before.anchorTop) <= 24,
      `topmost card is ${Math.round(align.before.cardTop - align.before.anchorTop)}px off its anchor`
    )
    assert(
      align.after === null ||
        Math.abs(align.after.cardTop - align.after.anchorTop) <= 24,
      'cards did not track the document while scrolling'
    )

    // (b) clicking a DIFFERENT card flashes + scrolls to its anchor
    const flash = await evalJs(`(async () => {
      const activeId = window.__sunaDev.commentsStore.getState().activeId;
      const card = [...document.querySelectorAll('.cmt-rail .cmt-card[data-comment-id]')]
        .find((c) => c.dataset.commentId !== activeId);
      if (!card) return { clicked: false };
      card.querySelector('.cmt-card__main')?.click();
      await new Promise((r) => setTimeout(r, 900));
      const f = document.querySelector('.msdoc .cm-content .cmt-anchor--flash');
      if (!f) return { clicked: true, flashed: false };
      const r = f.getBoundingClientRect();
      return { clicked: true, flashed: true, visible: r.top > 0 && r.bottom < window.innerHeight };
    })()`)
    assert(flash.clicked, 'no second comment card to click')
    assert(flash.flashed, 'clicking a rail card did not flash its anchor')
    assert(flash.visible, 'clicking a rail card did not scroll its anchor into view')

    // (c) delete -> gone immediately + Undo toast; Undo restores the thread
    const beforeDelete = JSON.parse(readFileSync(COMMENTS_JSON, 'utf8'))
    const del = await evalJs(`(async () => {
      const s = window.__sunaDev.commentsStore.getState();
      const target = s.comments[0];
      s.setActive(target.id);
      await new Promise((r) => setTimeout(r, 300));
      const card = document.querySelector('.cmt-rail .cmt-card[data-comment-id="' + target.id + '"]');
      const btn = [...(card?.querySelectorAll('.cmt__actions .cmt__btn') ?? [])]
        .find((b) => b.textContent.trim() === 'Delete');
      if (!btn) return { ok: false };
      btn.click();
      await new Promise((r) => setTimeout(r, 900));
      return {
        ok: true,
        id: target.id,
        cardGone: !document.querySelector('.cmt-rail .cmt-card[data-comment-id="' + target.id + '"]'),
        toast: !!document.querySelector('.toast'),
        undo: !![...document.querySelectorAll('.toast .toast__action')]
          .find((b) => b.textContent.trim() === 'Undo')
      };
    })()`)
    assert(del.ok, 'no Delete button on the active card (confirm rows are gone by design)')
    assert(del.cardGone, 'the deleted comment card is still in the rail')
    assert(del.toast && del.undo, 'no Undo toast after deleting a comment')
    const afterDelete = JSON.parse(readFileSync(COMMENTS_JSON, 'utf8'))
    assert(
      afterDelete.comments.length === beforeDelete.comments.length - 1,
      `comments.json after delete: ${afterDelete.comments.length}`
    )

    await evalJs(`[...document.querySelectorAll('.toast .toast__action')]
      .find((b) => b.textContent.trim() === 'Undo').click()`)
    await sleep(900)
    const restored = JSON.parse(readFileSync(COMMENTS_JSON, 'utf8'))
    const restoredThread = restored.comments.find((c) => c.id === del.id)
    const originalThread = beforeDelete.comments.find((c) => c.id === del.id)
    assert(
      JSON.stringify(restoredThread) === JSON.stringify(originalThread),
      'Undo did not restore the exact comment thread'
    )

    // (d) the resize grip widens the rail and persists the width — from a
    // NORMALIZED starting width, or repeat runs saturate at the 520px clamp
    await evalJs(`window.__sunaDev.uiStore.getState().setCommentsRailWidth(300)`)
    await sleep(300)
    const resized = await evalJs(`(async () => {
      const grip = document.querySelector('.cmt-rail__grip');
      const rail = document.querySelector('.mstab > .cmt-rail');
      if (!grip || !rail) return { ok: false };
      const before = rail.getBoundingClientRect().width;
      const r = grip.getBoundingClientRect();
      grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left, clientY: r.top + 60 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left - 80, clientY: r.top + 60 }));
      window.dispatchEvent(new PointerEvent('pointerup', {}));
      await new Promise((res) => setTimeout(res, 300));
      const after = rail.getBoundingClientRect().width;
      const stored = Number(window.localStorage.getItem('suna.commentsRailWidth'));
      return { ok: true, before, after, stored };
    })()`)
    assert(resized.ok, 'no resize grip on the rail')
    assert(
      resized.after > resized.before + 40,
      `grip drag did not widen the rail (${resized.before} -> ${resized.after})`
    )
    assert(
      Math.abs(resized.stored - resized.after) <= 1,
      `persisted rail width ${resized.stored} != rendered ${resized.after}`
    )
    await screenshot('margin-comments.png')
  })

  /**
   * Shared doc sessions (state/docSessions): the raw editor tab and the
   * combined manuscript tab are two windows onto ONE buffer — typing in one
   * appears in the other WITHOUT saving, there is a single dirty state, and
   * one ⌘S cleans both.
   */
  await step('shared-buffer-live-sync', async () => {
    // This step's subject IS the manual-save contract — "typing appears in the
    // other view without saving", "one ⌘S cleans both". Autosave (on by
    // default) would write the edit out mid-step and clear the dirty flag the
    // assertions are reading, so it is off here and restored at the end.
    await evalJs(
      `window.__sunaDev.settingsStore.getState().update('editor.autosave', false).then(() => 'ok')`
    )
    await openManuscriptDoc()
    const marker = 'SYNCMARK-' + Date.now().toString(36)
    // type into the MANUSCRIPT tab (helpers target .msdoc__editor)
    const sel = await dragSelectInSection('regular rotation pattern')
    assert(sel === 'regular rotation pattern', `could not select in the manuscript tab: ${sel}`)
    await insertText('regular rotation pattern ' + marker)
    await sleep(600)

    // buffer truth has it; disk does NOT (no save yet)
    const buffered = await evalJs(
      `window.__sunaDev.docSessions.peek(${JSON.stringify(MANUSCRIPT_MD)})?.includes(${JSON.stringify(marker)})`
    )
    assert(buffered, 'the shared session buffer does not hold the unsaved edit')
    assert(
      !readFileSync(MANUSCRIPT_MD, 'utf8').includes(marker),
      'the unsaved edit reached the disk'
    )

    // open the SAME file as a raw editor tab: the visible text already
    // contains the unsaved edit (one buffer, two views)
    await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(MANUSCRIPT_MD)})`)
    await sleep(2000)
    const fileTab = await evalJs(`(() => {
      const tab = [...document.querySelectorAll('.editor-tab')]
        .filter((t) => !t.classList.contains('msdoc'))
        .find((t) => t.getBoundingClientRect().width > 0);
      const meta = window.__sunaDev.docSessions.meta.getState().meta.get(${JSON.stringify(MANUSCRIPT_MD)});
      return {
        found: !!tab,
        hasMarker: tab ? tab.querySelector('.cm-content')?.textContent.includes(${JSON.stringify(marker)}) ?? false : false,
        views: meta?.views ?? 0,
        dirty: meta?.dirty ?? false
      };
    })()`)
    assert(fileTab.found, 'the raw editor tab did not open')
    assert(fileTab.hasMarker, 'the raw editor tab does not show the other tab\'s unsaved edit')
    assert(fileTab.views === 2, `session views: ${fileTab.views} (expected 2)`)
    assert(fileTab.dirty, 'the shared session is not marked dirty after an edit')

    // one ⌘S (in the file tab, the active panel) cleans BOTH surfaces —
    // click into its editor first so the keystroke lands there
    const lineSpot = await evalJs(`(() => {
      const tab = [...document.querySelectorAll('.editor-tab')]
        .filter((t) => !t.classList.contains('msdoc'))
        .find((t) => t.getBoundingClientRect().width > 0);
      const l = [...tab.querySelectorAll('.cm-line')].find((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.top > 60 && r.bottom < window.innerHeight - 40;
      });
      if (!l) throw new Error('no visible line in the raw editor tab');
      const r = l.getBoundingClientRect();
      return { x: r.left + Math.min(30, r.width / 2), y: r.top + r.height / 2 };
    })()`)
    await click(lineSpot.x, lineSpot.y)
    await sleep(250)
    await key('s', 'KeyS', 4)
    await sleep(1200)
    assert(
      readFileSync(MANUSCRIPT_MD, 'utf8').includes(marker),
      'the save did not reach the disk'
    )
    const clean = await evalJs(
      `window.__sunaDev.docSessions.meta.getState().meta.get(${JSON.stringify(MANUSCRIPT_MD)})?.dirty`
    )
    assert(clean === false, 'the shared session is still dirty after the save')

    // revert OUT-OF-BAND (edit_manuscript) — robust against the marker being
    // split across highlight spans in either editor, and it doubles as an
    // external-reload exercise: the live buffers must follow the revert
    mcpCall(COPY_DIR, 'edit_manuscript', {
      find: 'regular rotation pattern ' + marker,
      replace: 'regular rotation pattern'
    })
    await sleep(1500)
    assert(
      !readFileSync(MANUSCRIPT_MD, 'utf8').includes(marker),
      'could not revert the sync marker on disk'
    )
    const bufferReverted = await evalJs(
      `!window.__sunaDev.docSessions.peek(${JSON.stringify(MANUSCRIPT_MD)})?.includes(${JSON.stringify(marker)})`
    )
    assert(bufferReverted, 'the live buffer did not follow the out-of-band revert')

    // autosave back on: it is the shipped default every later step runs under
    await evalJs(
      `window.__sunaDev.settingsStore.getState().update('editor.autosave', true).then(() => 'ok')`
    )
  })

  /**
   * External edits (an agent's edit_manuscript over MCP) reach LIVE editors:
   * the watcher-driven reload applies the disk text as a minimal mapped
   * change — the buffer updates, stays clean, and the scroll position holds.
   */
  await step('external-edit-live-reload', async () => {
    await openManuscriptDoc()
    const scrollBefore = await evalJs(`document.querySelector('.msdoc').scrollTop`)
    const out = mcpCall(COPY_DIR, 'edit_manuscript', {
      find: 'regular rotation pattern',
      replace: 'regular rotation pattern (externally edited)'
    })
    assert(/replaced \d+ chars/.test(out), `edit_manuscript said: ${out}`)
    await sleep(1500) // watcher debounce (150ms) + reload round trip

    const state = await evalJs(`(() => {
      const meta = window.__sunaDev.docSessions.meta.getState().meta.get(${JSON.stringify(MANUSCRIPT_MD)});
      return {
        buffered: window.__sunaDev.docSessions.peek(${JSON.stringify(MANUSCRIPT_MD)})?.includes('(externally edited)') ?? false,
        visible: document.querySelector('.msdoc .cm-content')?.textContent.includes('(externally edited)') ?? false,
        dirty: meta?.dirty ?? null,
        scrollTop: document.querySelector('.msdoc').scrollTop
      };
    })()`)
    assert(state.buffered, 'the external edit did not reach the shared buffer')
    assert(state.visible, 'the external edit is not visible in the live editor')
    assert(state.dirty === false, `the external reload left the session dirty: ${state.dirty}`)
    assert(
      Math.abs(state.scrollTop - scrollBefore) <= 4,
      `the external reload moved the scroll position (${scrollBefore} -> ${state.scrollTop})`
    )

    // revert out-of-band too; the live buffer must follow again
    mcpCall(COPY_DIR, 'edit_manuscript', {
      find: 'regular rotation pattern (externally edited)',
      replace: 'regular rotation pattern'
    })
    await sleep(1500)
    const back = await evalJs(
      `window.__sunaDev.docSessions.peek(${JSON.stringify(MANUSCRIPT_MD)})?.includes('(externally edited)')`
    )
    assert(back === false, 'the revert edit did not reach the live buffer')
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

    // ON the page, not merely in the document. A matplotlib axes bbox starts
    // within a point of the artboard's top edge, so an unclamped label lands
    // above it, gets clipped by the SVG viewport, and the button looks dead —
    // which is exactly how this shipped broken. Measured, not computed.
    const inked = await evalJs(canvasJs(`
      const svg = CT.querySelector('.canvas-world > svg');
      const page = svg.getBoundingClientRect();
      return {
        pageWidth: page.width,
        pageHeight: page.height,
        letters: [...svg.querySelectorAll('text[data-suna-panel-letter]')].map((t) => {
          const r = t.getBoundingClientRect();
          return {
            text: t.textContent.trim(),
            top: r.top - page.top,
            bottom: r.bottom - page.top,
            left: r.left - page.left,
            right: r.right - page.left,
            w: r.width,
            h: r.height
          };
        })
      };
    `))
    assert(inked.letters.length === 2,
      `${inked.letters.length} letters carry the panel-letter mark (want 2)`)
    for (const l of inked.letters) {
      assert(l.w > 0 && l.h > 0, `panel letter "${l.text}" renders with no ink`)
      assert(l.top >= 0 && l.bottom <= inked.pageHeight,
        `panel letter "${l.text}" is clipped off the page vertically (top=${l.top}, bottom=${l.bottom}, page=${inked.pageHeight})`)
      assert(l.left >= 0 && l.right <= inked.pageWidth,
        `panel letter "${l.text}" is clipped off the page horizontally (left=${l.left}, right=${l.right}, page=${inked.pageWidth})`)
    }

    // Running it again REPLACES its own labels instead of stacking a second
    // set on top of the first.
    await evalJs(canvasJs(`
      [...CT.querySelectorAll('.canvas-figure__action')]
        .find((b) => b.textContent.includes('Auto-letter')).click();
      return true;
    `))
    await sleep(1000)
    const twice = await boldCount()
    assert(twice === before + 2, `a second auto-letter pass left ${twice - before} labels (want 2)`)

    // ONE batch command -> ONE undo reverts the whole lettering pass (twice
    // over: the re-run is its own single batch of remove-then-insert).
    await evalJs(canvasJs(`CT.querySelector('.canvas-viewport').focus(); return true;`))
    await key('z', 'KeyZ', 4)
    await sleep(600)
    const afterFirstUndo = await boldCount()
    assert(afterFirstUndo === before + 2,
      `one undo of the re-run left ${afterFirstUndo - before} panel letters (want 2)`)
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

  /**
   * feature-plan-3 §4 acceptance, asserted on DISK plus the live canvas:
   * New Figure writes a directory, a schema-valid figure.json (validated with
   * the real @suna/core schema through the dev seam) and an SVG at the
   * profile's double-column width, registers it in manuscript.json, shows the
   * empty-canvas hint, and imports an SVG as one id-namespaced group that a
   * single undo removes.
   */
  await step('new-figure-and-svg-import', async () => {
    await showView('figures')
    await sleep(800)
    await evalJs(`document.querySelector('.figs__new').click()`)
    await sleep(300)
    await evalJs(`(() => {
      const el = [...document.querySelectorAll('input')].find((i) => i.placeholder === 'Figure name…');
      if (!el) throw new Error('the New Figure name input did not appear');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      el.focus();
      set.call(el, 'Velocity Map');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`)
    await sleep(3500)

    const figDir = join(COPY_DIR, 'figures', 'velocity-map')
    const figSvg = join(figDir, 'figure.svg')
    const figJson = join(figDir, 'figure.json')
    assert(existsSync(figDir), 'New Figure did not create figures/velocity-map/')
    assert(existsSync(figSvg), 'New Figure did not write figure.svg')
    assert(existsSync(figJson), 'New Figure did not write figure.json')

    // schema-valid, per the app's own FigureDocumentSchema
    const docJson = JSON.parse(readFileSync(figJson, 'utf8'))
    const valid = await evalJs(
      `window.__sunaDev.validateDoc('figure', ${JSON.stringify(docJson)})`
    )
    assert(valid.ok, `figure.json is not schema-valid: ${valid.issues.join('; ')}`)

    // artboard width == the active profile's double-column preset (180mm for
    // Nature Astronomy), height == 0.618 * width
    const svgText = readFileSync(figSvg, 'utf8')
    const wpt = /width="([\d.]+)pt"/.exec(svgText)
    const hpt = /height="([\d.]+)pt"/.exec(svgText)
    assert(wpt && hpt, `blank figure.svg has no pt width/height: ${svgText.slice(0, 120)}`)
    const wmm = Number(wpt[1]) * 0.3528
    const hmm = Number(hpt[1]) * 0.3528
    assert(Math.abs(wmm - 180) < 0.5, `artboard width ${wmm.toFixed(2)}mm != the 180mm double-column preset`)
    assert(Math.abs(hmm - 180 * 0.618) < 0.5, `artboard height ${hmm.toFixed(2)}mm != 0.618 * width`)

    // registered in manuscript.json, still schema-valid
    const ms = JSON.parse(readFileSync(join(COPY_DIR, 'manuscript', 'manuscript.json'), 'utf8'))
    const msValid = await evalJs(`window.__sunaDev.validateDoc('manuscript', ${JSON.stringify(ms)})`)
    assert(msValid.ok, `manuscript.json is not schema-valid after the registration: ${msValid.issues.join('; ')}`)
    const entry = ms.figures.find((f) => f.id === 'velocity-map')
    assert(entry, 'manuscript.json has no figures[] entry for the new figure')
    assert(
      entry.canvasRef === 'figures/velocity-map/figure.svg',
      `the manuscript entry points at ${entry.canvasRef}`
    )

    // the blank canvas shows the drop hint
    await sleep(1200)
    const hint = await evalJs(canvasJs(`
      const h = CT.querySelector('.canvas-viewport__hint');
      return h ? h.textContent.trim() : null;
    `))
    assert(hint && /Drop or import a plot/.test(hint), `blank canvas hint: ${hint}`)
    await screenshot('new-figure.png')

    // --- import the demo figure.svg by drag-and-drop -----------------------
    const demo = readFileSync(FIGURE, 'utf8')
    await evalJs(canvasJs(`
      const vp = CT.querySelector('.canvas-viewport');
      const dt = new DataTransfer();
      dt.items.add(new File([${JSON.stringify(demo)}], 'figure.svg', { type: 'image/svg+xml' }));
      vp.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;
    `))
    await sleep(2500)

    const imported = await evalJs(canvasJs(`
      const svg = CT.querySelector('.canvas-world svg');
      const all = [...svg.querySelectorAll('[id]')].map((e) => e.id);
      const group = svg.querySelector('#imported-1');
      return {
        ids: all.length,
        dupes: [...new Set(all.filter((id, i) => all.indexOf(id) !== i))],
        group: !!group,
        topLevelGroups: [...svg.children].filter((c) => c.tagName.toLowerCase() === 'g').length,
        childIds: [...(group?.querySelectorAll('[id]') ?? [])].map((e) => e.id).slice(0, 8),
        hint: !!CT.querySelector('.canvas-viewport__hint')
      };
    `))
    assert(imported.group, 'the dropped SVG was not inserted as <g id="imported-1">')
    assert(imported.topLevelGroups === 1, `expected one top-level group, got ${imported.topLevelGroups}`)
    assert(imported.ids > 100, `the import brought in only ${imported.ids} ids — did it inline the content?`)
    assert(
      imported.dupes.length === 0,
      `duplicate ids after the import: ${imported.dupes.slice(0, 5).join(', ')}`
    )
    assert(
      imported.childIds.every((id) => id.startsWith('imp1-')),
      `imported ids are not namespaced: ${imported.childIds.join(', ')}`
    )
    assert(!imported.hint, 'the drop hint is still showing after content was imported')

    // --- ONE undo removes the whole import --------------------------------
    await evalJs(canvasJs(`CT.querySelector('.canvas-viewport').focus(); return true;`))
    await sleep(200)
    await key('z', 'KeyZ', 4)
    await sleep(1200)
    const undone = await evalJs(canvasJs(`
      const svg = CT.querySelector('.canvas-world svg');
      return {
        group: !!svg.querySelector('#imported-1'),
        ids: [...svg.querySelectorAll('[id]')].length,
        hint: !!CT.querySelector('.canvas-viewport__hint')
      };
    `))
    assert(!undone.group, 'one undo did not remove the imported group')
    assert(undone.ids === 0, `${undone.ids} imported ids survived the undo`)
    assert(undone.hint, 'the blank-canvas hint did not come back after the undo')
  })

  /**
   * feature-plan-3 §2 plumbing, WITHOUT spending the developer's tokens: the
   * ai-cli provider is offered when a CLI is detected (OpenAlex stays the
   * selected default — ai-cli is strictly opt-in), and cancelling an
   * in-flight search actually kills the child process and releases the UI.
   * The billed "≥3 results with DOIs inside 180 s" leg is a manual
   * verification — see TESTING.md — because every run of it costs real
   * money.
   *
   * The cancel leg starts a real child and kills it after ~3 s, which is
   * cheap but not free; it is the only way to prove the kill path end to end.
   * With no CLI installed the step asserts the honest install hint instead.
   */
  await step('ai-cli-provider-and-cancel', async () => {
    await showView('references')
    await sleep(700)
    await evalJs(`[...document.querySelectorAll('.refs__tab')]
      .find((b) => b.textContent.trim() === 'Search').click()`)
    await sleep(1000)

    const picker = await evalJs(`(() => {
      const btns = [...document.querySelectorAll('.lit-search__providers .refs__style')];
      return {
        labels: btns.map((b) => b.textContent.trim()),
        selected: btns.find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent.trim() ?? null,
        note: document.querySelector('.lit-search .view__hint')?.textContent ?? null
      };
    })()`)
    assert(picker.labels.length === 5, `provider buttons: ${picker.labels.join(' | ')}`)
    assert(picker.labels[0].includes('AI search'), `AI search is not listed first: ${picker.labels[0]}`)
    // OpenAlex is the default selection — even on a machine with an agent
    // CLI installed, ai-cli is opt-in only.
    assert(
      picker.selected && picker.selected.includes('OpenAlex'),
      `OpenAlex is not the default provider: ${picker.selected}`
    )

    // opt into ai-cli explicitly for the rest of the step
    await evalJs(`[...document.querySelectorAll('.lit-search__providers .refs__style')]
      .find((b) => b.textContent.includes('AI search')).click()`)
    await sleep(400)
    const aiNote = await evalJs(
      `document.querySelector('.lit-search .view__hint')?.textContent ?? null`
    )

    const cliAvailable = await evalJs(
      `window.suna.invoke('lit:cli-status', {}).then((r) => r.available)`
    )
    if (cliAvailable.length === 0) {
      // Honest-failure path: no CLI on this machine.
      assert(
        /Install Claude Code or Codex/.test(aiNote ?? ''),
        `with no CLI installed the panel must show the install hint, got: ${aiNote}`
      )
      console.log('    (no agent CLI installed — verified the install-hint path)')
      return
    }

    assert(
      /Claude Code|Codex/.test(aiNote ?? ''),
      `the panel does not name the detected CLI: ${aiNote}`
    )

    // --- start a real search, then cancel it -------------------------------
    // Match on the adapter's own prompt text rather than on "claude"/"codex":
    // whoever runs this suite may themselves be inside an agent CLI session,
    // and killing/counting that would be both wrong and rude. Only a child
    // carrying THIS prompt is one the app spawned.
    const PROMPT_MARK = 'real, published academic papers'
    const running = () =>
      execSync('ps -eo pid,command', { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
        .split('\n')
        .filter((line) => line.includes(PROMPT_MARK) && !line.includes('ps -eo'))
        .map((line) => line.trim())
    assert(running().length === 0, `an ai-cli child was already running before the step:\n${running().join('\n')}`)

    await evalJs(setFieldJs(`document.querySelector('.lit-search__query .view__input')`, 'ram pressure stripping'))
    await sleep(200)
    await evalJs(`document.querySelector('.lit-search__go').click()`)
    await sleep(3500)

    const spawned = running()
    assert(spawned.length > 0, 'the ai-cli search did not spawn a CLI child process')
    const pids = spawned.map((l) => l.split(/\s+/)[0])
    assert(
      await evalJs(`!!document.querySelector('.lit-search__cancel')`),
      'no Cancel button while the ai-cli search runs'
    )

    await evalJs(`document.querySelector('.lit-search__cancel').click()`)
    let left = null
    for (let i = 0; i < 24; i++) {
      await sleep(500)
      left = running()
      if (left.length === 0) break
    }
    assert(left.length === 0, `cancel left a CLI child alive:\n${left.join('\n')}`)
    for (const pid of pids) {
      let alive = true
      try {
        execSync(`ps -p ${pid} > /dev/null 2>&1`, { shell: '/bin/bash' })
      } catch {
        alive = false
      }
      assert(!alive, `spawned pid ${pid} is still alive after cancel`)
    }

    // the UI must leave the loading state and say what happened
    let ui = null
    for (let i = 0; i < 20; i++) {
      ui = await evalJs(`({
        loading: !!document.querySelector('.lit-search__cancel'),
        error: document.querySelector('.view__error')?.textContent ?? null
      })`)
      if (!ui.loading) break
      await sleep(500)
    }
    assert(!ui.loading, 'the panel is still showing a Cancel button after the search was cancelled')
    assert(
      ui.error !== null && /cancel/i.test(ui.error),
      `the cancelled search was not reported honestly: ${ui.error}`
    )
    await screenshot('ai-cli-cancel.png')
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
    // feature-plan-3 §2 added 'ai-cli' as a FIFTH provider, listed first
    // (@suna/core's UI_LIT_PROVIDER_IDS); OpenAlex is the selected default.
    assert(providers.length === 5, `provider buttons: ${providers.join(' | ')}`)
    assert(providers[0].includes('AI search'), `AI search is not listed first: ${providers[0]}`)

    // Pin Crossref explicitly — this step exercises the HTTP provider path
    // (the previous step may have left ai-cli selected, and running a search
    // on it would spend the developer's tokens on every smoke run).
    await evalJs(`[...document.querySelectorAll('.lit-search__providers .refs__style')]
      .find((b) => b.textContent.includes('Crossref')).click()`)
    await sleep(300)
    assert(
      await evalJs(`[...document.querySelectorAll('.lit-search__providers .refs__style')]
        .find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent.includes('Crossref') ?? false`),
      'Crossref did not become the selected provider'
    )

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
      'search_literature', 'lookup_doi', 'add_reference',
      'edit_manuscript', 'check_manuscript'
    ]) {
      assert(probe.tools.includes(name), `bundled MCP server is missing ${name}`)
    }
    assert(probe.tools.length === 20, `MCP tool count: ${probe.tools.length}`)

    // the anchored edit primitive, round-tripped through the real bundle:
    // edit a unique phrase, verify the section report, put it back
    const phrase = 'Galaxies falling into dense cluster environments'
    const edited = mcpCall(COPY_DIR, 'edit_manuscript', {
      find: phrase, replace: `${phrase} (smoke)`
    })
    assert(/replaced \d+ chars/.test(edited), `edit_manuscript said: ${edited}`)
    mcpCall(COPY_DIR, 'edit_manuscript', { find: `${phrase} (smoke)`, replace: phrase })

    // manuscript-side compliance speaks against the demo's active profile
    const checked = mcpCall(COPY_DIR, 'check_manuscript', {})
    assert(
      /compliant with|error |warning /.test(checked),
      `check_manuscript said: ${checked}`
    )
  })

  /* ------------------------------------------------------------------
   * Steps 48-54: docs/design/feature-plan-4.md acceptance criteria
   * (split view, PDF/image viewers, reference PDFs, command palette),
   * measured the same way — real keys, real files, real page counts.
   * ------------------------------------------------------------------ */

  /** Empty the dock so a split assertion starts from one known group. */
  const resetDock = async () => {
    await evalJs(`window.__sunaDev.dock.clearDock()`)
    await sleep(500)
  }
  /** Groups, panel ids per group, and each panel's dock component. */
  const dockState = () =>
    evalJs(`(() => {
      const ids = window.__sunaDev.dock.groupPanelIds();
      const comps = window.__sunaDev.dock.panelComponents();
      return {
        groups: ids.length,
        ids,
        comps,
        pdfTabs: Object.values(comps).filter((c) => c === 'pdf').length
      };
    })()`)
  /** Only the tabs the user can actually see — dockview keeps hidden panels
   *  mounted at zero size, so an unscoped querySelector reads ghosts. */
  const visibleText = (selector) =>
    evalJs(`[...document.querySelectorAll(${JSON.stringify(selector)})]
      .filter((e) => e.getBoundingClientRect().width > 0)
      .map((e) => e.textContent)`)

  const REF_PDFS = {
    gunn1972: join(ROOT, 'references', 'nphys3816.pdf'),
    cortese2021: join(ROOT, 'references', 's41550-026-02905-7.pdf'),
    jachym2019: join(ROOT, 'references', 's41550-026-02892-9.pdf')
  }
  const INTRO_MD = join(COPY_DIR, 'manuscript', 'manuscript.md')

  await step('split-view-two-groups', async () => {
    await resetDock()
    await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(INTRO_MD)})`)
    await sleep(900)
    const before = await dockState()
    assert(before.groups === 1, `dock did not reset to one group: ${before.groups}`)

    // ⌘\ on the focused editor — the real key, matched on event.code
    await evalJs(`[...document.querySelectorAll('.cm-content')]
      .find((e) => e.getBoundingClientRect().width > 0).focus()`)
    await sleep(250)
    await key('\\', 'Backslash', 4)
    await sleep(1000)
    const after = await dockState()
    assert(after.groups === 2, `⌘\\ produced ${after.groups} groups, want exactly 2`)
    const showing = after.ids.map(
      (group) => group.filter((id) => id === INTRO_MD || id.startsWith(`${INTRO_MD}::`)).length
    )
    assert(
      showing.length === 2 && showing[0] === 1 && showing[1] === 1,
      `both groups must show the section: ${JSON.stringify(showing)}`
    )

    // "if a second group already exists, reuse it rather than endlessly
    // splitting" — two more openInSplit calls must not add a third group.
    await evalJs(`window.__sunaDev.dock.openInSplit(${JSON.stringify(INTRO_MD)}, 'right')`)
    await sleep(400)
    await evalJs(`window.__sunaDev.dock.openInSplit(${JSON.stringify(INTRO_MD)}, 'right')`)
    await sleep(700)
    const twice = await dockState()
    assert(twice.groups === 2, `openInSplit twice left ${twice.groups} groups, want 2`)
    assert(
      JSON.stringify(twice.ids) === JSON.stringify(after.ids),
      `openInSplit twice added panels: ${JSON.stringify(twice.ids)}`
    )
    await screenshot('split-view.png')
  })

  await step('pdf-viewer-page-count-and-canvas-bound', async () => {
    await resetDock()
    const src = join(ROOT, 'references', 'nphys3816.pdf')
    const dst = join(COPY_DIR, 'references', 'nphys3816.pdf')
    rmSync(dst, { force: true })
    // through the real fs:copy-file channel (creates references/, refuses to
    // overwrite, never moves the original)
    const copiedTo = await evalJs(
      `window.suna.invoke('fs:copy-file', { from: ${JSON.stringify(src)}, to: ${JSON.stringify(dst)} }).then((r) => r.path)`
    )
    assert(copiedTo === dst, `fs:copy-file landed at ${copiedTo}`)
    assert(existsSync(dst) && existsSync(src), 'copy must create the target AND leave the source')

    const wantPages = await pdfPageCountHeadless(src)
    assert(wantPages > 1, `headless pdf.js read ${wantPages} pages — fixture looks wrong`)
    assert(
      (await evalJs(`window.__sunaDev.dock.componentForFile(${JSON.stringify(dst)})`)) === 'pdf',
      '.pdf did not route to the pdf component'
    )

    await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(dst)})`)
    let info = null
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      info = await evalJs(`({
        pageinfo: document.querySelector('.pdfview__pageinfo')?.textContent ?? null,
        pages: document.querySelectorAll('.pdfview__page').length,
        error: document.querySelector('.pdfview__error')?.textContent ?? null
      })`)
      if (info.error !== null || (info.pageinfo !== null && info.pageinfo !== 'of —')) break
      await sleep(500)
    }
    assert(info.error === null, `the PDF failed to open: ${info.error}`)
    assert(
      info.pageinfo === `of ${wantPages}`,
      `the toolbar reads "${info.pageinfo}" but pdf.js reads ${wantPages} pages headlessly`
    )
    assert(info.pages === wantPages, `${info.pages} page wrappers for a ${wantPages}-page document`)

    // page 1 is really rasterized: a non-zero bitmap, not an empty <canvas>
    await sleep(2500)
    const page1 = await evalJs(`(() => {
      const c = document.querySelector('.pdfview__page[data-page="1"] canvas');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { w: c.width, h: c.height, cssW: Math.round(r.width), cssH: Math.round(r.height) };
    })()`)
    assert(page1 !== null, 'page 1 rendered no canvas')
    assert(page1.w > 0 && page1.h > 0, `page 1 canvas bitmap is ${page1.w}×${page1.h}`)
    assert(page1.cssW > 100 && page1.cssH > 100, `page 1 is laid out at ${page1.cssW}×${page1.cssH} css px`)

    // the text layer exists, so selection and ⌘F work
    const text = await evalJs(`(() => {
      const t = document.querySelector('.pdfview__page[data-page="1"] .pdfview__textlayer');
      return { spans: t ? t.querySelectorAll('span').length : 0, chars: t ? t.textContent.trim().length : 0 };
    })()`)
    assert(text.spans > 20 && text.chars > 100, `text layer looks empty: ${JSON.stringify(text)}`)
    await screenshot('pdf-viewer.png')

    // Performance guard: scrolling the whole document and back must NOT keep
    // a canvas per page alive. The lazy window is ±800 px, so the live count
    // stays a small constant however many sweeps we make.
    const liveCanvases = () => evalJs(`document.querySelectorAll('.pdfview__page canvas').length`)
    const atStart = await liveCanvases()
    const sweeps = []
    for (let i = 0; i < 3; i += 1) {
      await evalJs(`(async () => {
        const el = document.querySelector('.pdfview__scroll');
        el.scrollTop = el.scrollHeight; await new Promise((r) => setTimeout(r, 1200));
        el.scrollTop = 0; await new Promise((r) => setTimeout(r, 1200));
      })()`)
      sweeps.push(await liveCanvases())
    }
    const CANVAS_BUDGET = 6
    assert(
      sweeps.every((n) => n <= CANVAS_BUDGET),
      `live canvases grew while scrolling: start ${atStart}, after each sweep ${sweeps.join(', ')} (budget ${CANVAS_BUDGET} of ${wantPages} pages)`
    )
    assert(
      sweeps[sweeps.length - 1] <= sweeps[0] + 1,
      `live canvases climbed across sweeps: ${sweeps.join(', ')}`
    )
  })

  await step('image-viewer-dimensions-match-ihdr', async () => {
    await resetDock()
    // the PNG the canvas export step already wrote, reopened in the viewer
    const png = join(COPY_DIR, 'output', 'fig-spectrum.png')
    assert(existsSync(png), `no exported PNG at ${png} (the canvas export step should have written it)`)
    const real = pngIhdr(png)
    assert(
      (await evalJs(`window.__sunaDev.dock.componentForFile(${JSON.stringify(png)})`)) === 'image',
      '.png did not route to the image component'
    )
    await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(png)})`)
    let view = null
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      view = await evalJs(`({
        dims: document.querySelector('.imgview__dims')?.textContent ?? null,
        error: document.querySelector('.imgview__error')?.textContent ?? null
      })`)
      if (view.dims !== null || view.error !== null) break
      await sleep(400)
    }
    assert(view.error === null, `the image failed to open: ${view.error}`)
    const m = /(\d+)\s*×\s*(\d+)px/.exec(view.dims ?? '')
    assert(m, `no pixel readout in the image toolbar: ${view.dims}`)
    assert(
      Number(m[1]) === real.width && Number(m[2]) === real.height,
      `the viewer reads ${m[1]}×${m[2]} but the PNG's IHDR says ${real.width}×${real.height}`
    )
    await screenshot('image-viewer.png')
  })

  await step('reference-pdfs-resolve-and-open-in-side-group', async () => {
    mkdirSync(join(COPY_DIR, 'references'), { recursive: true })
    for (const [citekey, src] of Object.entries(REF_PDFS)) {
      copyFileSync(src, join(COPY_DIR, 'references', `${citekey}.pdf`))
    }
    await evalJs(`window.__sunaDev.referencePdfsStore.getState().scan(${JSON.stringify(COPY_DIR)})`)
    await sleep(1200)
    const map = await evalJs(`(() => {
      const out = {};
      for (const [k, v] of window.__sunaDev.referencePdfsStore.getState().map) {
        out[k] = v === null ? null : { how: v.how, path: v.path };
      }
      return out;
    })()`)
    for (const citekey of Object.keys(REF_PDFS)) {
      assert(map[citekey] !== null && map[citekey] !== undefined, `no PDF resolved for @${citekey}`)
      assert(
        map[citekey].how === 'citekey',
        `@${citekey} resolved via ${map[citekey].how}, want the references/<citekey>.pdf rule`
      )
      assert(
        map[citekey].path === join(COPY_DIR, 'references', `${citekey}.pdf`),
        `@${citekey} resolved to ${map[citekey].path}`
      )
    }
    assert(map['peng2010'] === null, 'peng2010 has no PDF and must resolve to null, not a guess')

    await resetDock()
    await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(INTRO_MD)})`)
    await sleep(900)
    await showView('references')
    await sleep(1500)
    assert(
      (await evalJs(`window.__sunaDev.settingsStore.getState().settings['references.autoOpenPdf']`)) === true,
      "'references.autoOpenPdf' should default on"
    )
    const badged = await evalJs(`[...document.querySelectorAll('.refs__row')]
      .filter((r) => r.querySelector('.refs__pdf-badge'))
      .map((r) => r.querySelector('.refs__key').textContent.trim())`)
    for (const citekey of Object.keys(REF_PDFS)) {
      assert(badged.includes(citekey), `no PDF badge on the ${citekey} row: ${badged.join(', ')}`)
    }
    assert(
      (await evalJs(`document.querySelectorAll('.refs__attach-pdf').length`)) > 0,
      'rows without a PDF must offer "Attach PDF…"'
    )

    const clickRow = (citekey) =>
      evalJs(`(() => {
        const row = [...document.querySelectorAll('.refs__row')]
          .find((r) => (r.querySelector('.refs__key')?.textContent ?? '').trim() === ${JSON.stringify(citekey)});
        if (!row) throw new Error('no references row for ' + ${JSON.stringify(citekey)});
        row.click();
      })()`)

    // Three entries in a row: exactly one PDF tab, in the SIDE group, showing
    // the last one clicked — replacing, never stacking.
    const seen = []
    for (const citekey of ['gunn1972', 'cortese2021', 'jachym2019']) {
      await clickRow(citekey)
      await sleep(2500)
      const state = await dockState()
      const shown = await visibleText('.pdfview__filename')
      seen.push({ citekey, groups: state.groups, pdfTabs: state.pdfTabs, shown })
      assert(state.groups === 2, `clicking ${citekey} left ${state.groups} groups, want 2`)
      assert(state.pdfTabs === 1, `clicking ${citekey} left ${state.pdfTabs} PDF tabs, want exactly 1`)
      assert(
        (state.ids[1] ?? []).some((id) => id.endsWith(`${citekey}.pdf`)),
        `${citekey}.pdf is not in the side group: ${JSON.stringify(state.ids)}`
      )
      assert(
        shown.length === 1 && shown[0] === `${citekey}.pdf`,
        `the visible PDF is ${JSON.stringify(shown)}, want ${citekey}.pdf`
      )
    }
    console.log(`    (side group after each click: ${seen.map((s) => `${s.citekey}→${s.pdfTabs} tab`).join(', ')})`)
    await screenshot('reference-pdf-side.png')
  })

  await step('citation-context-menu-opens-reference-pdf', async () => {
    await resetDock()
    await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(INTRO_MD)})`)
    await sleep(2000)
    // Reading mode replaces each [@key] with a .cm-lp-cite chip; scope the
    // lookup to the VISIBLE editor so a zero-size hidden panel can't supply
    // the coordinates.
    const chips = await evalJs(`(() => {
      const host = [...document.querySelectorAll('.cm-content')].find((e) => e.getBoundingClientRect().width > 0);
      if (!host) throw new Error('no visible editor');
      return [...host.querySelectorAll('.cm-lp-cite')].map((c) => {
        const r = c.getBoundingClientRect();
        return { text: c.textContent, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
    })()`)
    assert(chips.length >= 3, `expected several citation chips in the intro, got ${chips.length}`)

    const menuOn = async (chip) => {
      await rclick(chip.x, chip.y)
      await sleep(500)
      return evalJs(`[...document.querySelectorAll('.md-ctxmenu__item')].map((i) => ({
        action: i.getAttribute('data-action'), label: i.textContent.trim(), disabled: i.disabled === true
      }))`)
    }
    const dismissMenu = async () => {
      await evalJs(`document.querySelector('.md-ctxmenu-scrim')
        ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
      await key('Escape', 'Escape')
      await sleep(350)
    }

    // A citation WITHOUT a PDF: the item is present, disabled, and names the key.
    let disabled = null
    for (const chip of chips) {
      const items = await menuOn(chip)
      const item = items.find((i) => i.action === 'openReferencePdf')
      await dismissMenu()
      if (item !== undefined && item.disabled) {
        disabled = { chip: chip.text, item }
        break
      }
    }
    assert(disabled !== null, 'no citation without a PDF produced a disabled "Open reference PDF"')
    assert(
      /^No PDF found for @\w/.test(disabled.item.label),
      `the disabled item does not name the key: "${disabled.item.label}"`
    )
    assert(
      disabled.chip.includes(disabled.item.label.replace('No PDF found for @', '')),
      `the disabled item names ${disabled.item.label} but the chip is ${disabled.chip}`
    )

    // A right-click on plain prose must not offer the item at all.
    const proseAt = await evalJs(`(() => {
      const line = [...document.querySelectorAll('.cm-line')].find((e) => e.getBoundingClientRect().width > 0);
      const r = line.getBoundingClientRect();
      return { x: r.left + 25, y: r.top + r.height / 2 };
    })()`)
    await rclick(proseAt.x, proseAt.y)
    await sleep(500)
    const proseActions = await evalJs(
      `[...document.querySelectorAll('.md-ctxmenu__item')].map((i) => i.getAttribute('data-action'))`
    )
    assert(proseActions.length > 0, 'right-clicking prose opened no menu')
    assert(
      !proseActions.includes('openReferencePdf'),
      'a click off any citation must not offer "Open reference PDF"'
    )
    await dismissMenu()

    // A citation WITH a PDF: enabled, and choosing it opens the paper in the
    // side group without disturbing the manuscript group.
    const before = await dockState()
    const enabledChip = chips[0]
    const items = await menuOn(enabledChip)
    const item = items.find((i) => i.action === 'openReferencePdf')
    assert(item !== undefined, `no "Open reference PDF" on ${enabledChip.text}`)
    assert(!item.disabled, `"Open reference PDF" is disabled on ${enabledChip.text}`)
    assert(item.label === 'Open reference PDF', `unexpected label: ${item.label}`)
    await evalJs(`[...document.querySelectorAll('.md-ctxmenu__item')]
      .find((i) => i.getAttribute('data-action') === 'openReferencePdf').click()`)
    await sleep(3000)
    const after = await dockState()
    assert(after.groups === 2, `choosing the item left ${after.groups} groups, want 2`)
    assert(after.pdfTabs === 1, `choosing the item left ${after.pdfTabs} PDF tabs, want 1`)
    assert(
      JSON.stringify(after.ids[0]) === JSON.stringify(before.ids[0]),
      `the manuscript group was disturbed: ${JSON.stringify(before.ids[0])} -> ${JSON.stringify(after.ids[0])}`
    )
    const shown = await visibleText('.pdfview__filename')
    assert(
      shown.length === 1 && /\.pdf$/.test(shown[0]),
      `no single PDF visible in the side group: ${JSON.stringify(shown)}`
    )
  })

  await step('command-palette-modes', async () => {
    await resetDock()
    await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(INTRO_MD)})`)
    await sleep(1200)
    const docBefore = await evalJs(`[...document.querySelectorAll('.cm-content')]
      .find((e) => e.getBoundingClientRect().width > 0).textContent.slice(0, 60)`)

    // ⌘K opens FOCUSED, over a focused prose editor. (The editor's own ⌘K
    // still makes a link out of a SELECTION; with an empty selection it lets
    // the key through — editor/keymap.ts's insertLinkOnSelection.)
    await evalJs(`[...document.querySelectorAll('.cm-content')]
      .find((e) => e.getBoundingClientRect().width > 0).focus()`)
    await sleep(250)
    await key('k', 'KeyK', 4)
    await sleep(700)
    const opened = await evalJs(`({
      dialog: !!document.querySelector('.palette'),
      focused: document.activeElement ? document.activeElement.className : null
    })`)
    assert(opened.dialog, '⌘K did not open the palette over a focused editor')
    assert(
      opened.focused === 'palette__input',
      `the palette opened without focus on its input: ${opened.focused}`
    )

    // file mode: typing the prose file's name finds it and Enter opens it
    await insertText('manuscript.md')
    await sleep(800)
    const fileRows = await evalJs(`[...document.querySelectorAll('.palette__item')].map((i) => ({
      label: i.querySelector('.palette__item-label')?.textContent ?? '',
      sub: i.querySelector('.palette__item-sub')?.textContent ?? ''
    }))`)
    assert(fileRows.length > 0, "typing 'manuscript.md' matched nothing")
    assert(
      fileRows[0].label === 'manuscript.md',
      `'manuscript.md' ranked ${fileRows[0].label} first, want manuscript.md`
    )
    // matched on the PROJECT-RELATIVE path: every file shares the absolute
    // prefix, so scoring absolute paths returns the entire project
    assert(
      !fileRows[0].sub.startsWith('/'),
      `file rows show an absolute path: ${fileRows[0].sub}`
    )
    assert(
      fileRows.length < 6,
      `'manuscript.md' matched ${fileRows.length} files — the query is not discriminating (${fileRows.map((r) => r.label).join(', ')})`
    )
    await screenshot('command-palette.png')
    await resetDock()
    await sleep(400)
    await key('Enter', 'Enter')
    await sleep(1500)
    const openedFile = await evalJs(`({
      closed: !document.querySelector('.palette'),
      active: window.__sunaDev.dock.activePanelPath()
    })`)
    assert(openedFile.closed, 'the palette stayed open after Enter')
    assert(openedFile.active === INTRO_MD, `Enter opened ${openedFile.active}`)

    // ⌘⇧P opens straight into '>' command mode
    await key('P', 'KeyP', 12)
    await sleep(700)
    const commandMode = await evalJs(`({
      value: document.querySelector('.palette__input')?.value ?? null,
      rows: [...document.querySelectorAll('.palette__item')].map((i) => i.querySelector('.palette__item-label')?.textContent ?? '')
    })`)
    assert(commandMode.value === '>', `⌘⇧P prefilled ${JSON.stringify(commandMode.value)}, want '>'`)
    assert(commandMode.rows.includes('Split Right'), `command list: ${commandMode.rows.join(', ')}`)
    await key('Escape', 'Escape')
    await sleep(500)

    // '>' mode: '>split right' really splits
    const beforeSplit = await dockState()
    assert(beforeSplit.groups === 1, `expected one group before the split: ${beforeSplit.groups}`)
    await key('k', 'KeyK', 4)
    await sleep(600)
    await insertText('>split right')
    await sleep(700)
    const cmdRows = await evalJs(
      `[...document.querySelectorAll('.palette__item')].map((i) => i.querySelector('.palette__item-label')?.textContent ?? '')`
    )
    assert(
      cmdRows[0] === 'Split Right',
      `'>split right' ranked ${JSON.stringify(cmdRows)} — want Split Right first`
    )
    await key('Enter', 'Enter')
    await sleep(1500)
    const afterSplit = await dockState()
    assert(afterSplit.groups === 2, `'>split right' produced ${afterSplit.groups} groups, want 2`)

    // '$' mode: the line really runs in the integrated terminal
    await key('k', 'KeyK', 4)
    await sleep(600)
    await insertText('$echo SUNA_PALETTE')
    await sleep(500)
    const termHint = await evalJs(`document.querySelector('.palette__status')?.textContent ?? ''`)
    assert(/Enter to run/.test(termHint), `no terminal hint row: ${termHint}`)
    await key('Enter', 'Enter')
    let buffer = ''
    const termDeadline = Date.now() + 25_000
    while (Date.now() < termDeadline) {
      buffer = await evalJs(
        `document.querySelector('.termpanel__mount .xterm-rows')?.textContent ?? ''`
      )
      if (buffer.includes('SUNA_PALETTE')) break
      await sleep(600)
    }
    assert(
      await evalJs(`!!document.querySelector('.termpanel')`),
      'the terminal panel did not open for $ mode'
    )
    // the command echoed AND its output came back: the marker appears twice
    // (the typed line, then the shell's own output)
    const occurrences = buffer.split('SUNA_PALETTE').length - 1
    assert(
      occurrences >= 2,
      `the terminal buffer does not show '$echo SUNA_PALETTE' running: ${JSON.stringify(buffer.replace(/\s+/g, ' ').slice(-200))}`
    )

    // Escape closes with NO side effects
    const beforeEscape = {
      ...(await dockState()),
      terms: await evalJs(`document.querySelectorAll('.termpanel__tab-name').length`)
    }
    await key('k', 'KeyK', 4)
    await sleep(600)
    await insertText('methods')
    await sleep(600)
    assert(await evalJs(`!!document.querySelector('.palette')`), 'the palette did not reopen')
    await key('Escape', 'Escape')
    await sleep(800)
    const afterEscape = {
      ...(await dockState()),
      terms: await evalJs(`document.querySelectorAll('.termpanel__tab-name').length`),
      closed: await evalJs(`!document.querySelector('.palette')`)
    }
    assert(afterEscape.closed, 'Escape did not close the palette')
    assert(
      JSON.stringify(beforeEscape.ids) === JSON.stringify(afterEscape.ids),
      `Escape changed the open tabs: ${JSON.stringify(beforeEscape.ids)} -> ${JSON.stringify(afterEscape.ids)}`
    )
    assert(
      beforeEscape.terms === afterEscape.terms,
      `Escape created a terminal: ${beforeEscape.terms} -> ${afterEscape.terms}`
    )
    const docAfter = await evalJs(`[...document.querySelectorAll('.cm-content')]
      .find((e) => e.getBoundingClientRect().width > 0)?.textContent.slice(0, 60) ?? null`)
    assert(
      docAfter === docBefore,
      'the palette typed into the document instead of its own input'
    )
  })

  /**
   * The palette's '?' AI mode, unbilled half — same contract as step 47's
   * literature-search cancel: start a real agent-CLI run and kill it. The
   * child is located in `ps` by the run's own unique prompt text, never by
   * the string "claude", so running this suite from inside an agent CLI
   * session cannot match. The billed half (a full answer) is verified by hand
   * — see TESTING.md.
   */
  await step('palette-ai-ask-cancel', async () => {
    const cli = await evalJs(`window.suna.invoke('lit:cli-status', {})`)
    if (!Array.isArray(cli.available) || cli.available.length === 0) {
      console.log('    (no agent CLI installed — ? mode cannot be exercised here)')
      return
    }
    const marker = `SUNA_PALETTE_ASK_PROBE_${Date.now()}`
    await key('k', 'KeyK', 4)
    await sleep(600)
    await insertText(`?${marker} reply with the single word OK`)
    await sleep(500)
    const hint = await evalJs(`document.querySelector('.palette__status')?.textContent ?? ''`)
    assert(/ask the agent CLI/.test(hint), `no ai hint row: ${hint}`)
    await key('Enter', 'Enter')
    await sleep(4000)

    const busy = await evalJs(`({
      buttons: [...document.querySelectorAll('.palette__button')].map((b) => b.textContent.trim()),
      inputDisabled: document.querySelector('.palette__input')?.disabled ?? null,
      focused: document.activeElement ? document.activeElement.className : null
    })`)
    assert(busy.buttons.includes('Cancel'), `no Cancel button while busy: ${busy.buttons.join(', ')}`)
    // focus must stay INSIDE the dialog once the input disables, or Escape dies
    assert(busy.focused === 'palette__button', `focus escaped the dialog: ${busy.focused}`)

    const psFor = () => {
      try {
        return execSync(`ps -Ao pid=,command= | grep ${marker} | grep -v grep || true`, {
          encoding: 'utf8'
        }).trim()
      } catch {
        return ''
      }
    }
    const running = psFor()
    assert(running !== '', `no child process was spawned for the '?' prompt`)
    const pids = running
      .split('\n')
      .map((line) => Number(line.trim().split(/\s+/)[0]))
      .filter((n) => Number.isFinite(n))

    await evalJs(`[...document.querySelectorAll('.palette__button')]
      .find((b) => b.textContent.trim() === 'Cancel').click()`)
    await sleep(3500)
    assert(psFor() === '', `the agent CLI is still running after Cancel:\n${psFor()}`)
    for (const pid of pids) {
      let alive = true
      try {
        process.kill(pid, 0)
      } catch {
        alive = false
      }
      assert(!alive, `spawned pid ${pid} survived Cancel`)
    }
    // Cancel returns the palette to its idle input rather than closing it
    const idle = await evalJs(`({
      dialog: !!document.querySelector('.palette'),
      inputDisabled: document.querySelector('.palette__input')?.disabled ?? null,
      value: document.querySelector('.palette__input')?.value ?? null
    })`)
    assert(idle.dialog && idle.inputDisabled === false, `the palette did not return to idle: ${JSON.stringify(idle)}`)
    assert(idle.value === '', `the palette kept the cancelled prompt: ${JSON.stringify(idle.value)}`)
    await key('Escape', 'Escape')
    await sleep(400)
    assert(await evalJs(`!document.querySelector('.palette')`), 'Escape did not close the idle palette')
    console.log(`    (killed ${pids.length} agent CLI process(es) started by '?')`)
  })

  /* =======================================================================
     docs/design/feature-plan-5.md — recents, typography defaults, true live
     preview, onboarding, settings hierarchy.
     ======================================================================= */

  /**
   * §3 — true live preview. The old behaviour DIMMED `##` and `**`; the
   * requirement is that they are gone from the rendered text and come back
   * only under the cursor.
   *
   * Measured against a purpose-written fixture rather than a demo section,
   * because the demo manuscript has no ATX headings at all (its section
   * titles live in manuscript.json) — a "no # is visible" assertion over it
   * would pass vacuously. The fixture also carries the two cases the spec
   * says must NOT transform: `**` inside inline code, and `\*` escapes.
   */
  const LP_FIXTURE = [
    '## Results probe',
    '',
    'A **bold run** with *italic* and ~~struck~~ words.',
    '',
    'Literal `a ** b` backticks stay put.',
    '',
    'An escaped \\*star\\* stays literal.',
    '',
    '- first bullet',
    '- second bullet',
    '',
    '> a quoted line',
    '',
    'See [the link text](https://example.com/page) here.',
    ''
  ].join('\n')
  const LP_FILE = join(COPY_DIR, 'lp-probe.md')

  /** Every `.cm-line` of the one editor tab that is actually on screen. */
  const lpLines = () =>
    evalJs(`(() => {
      const hosts = [...document.querySelectorAll('.editor-tab')];
      const host = hosts.find((h) => h.getBoundingClientRect().width > 0);
      if (!host) throw new Error('no visible editor tab');
      return [...host.querySelectorAll('.cm-line')].map((l) => l.textContent);
    })()`)

  await step('live-preview-hides-markdown-syntax', async () => {
    writeFileSync(LP_FILE, LP_FIXTURE, 'utf8')
    const bytesBefore = readFileSync(LP_FILE)
    await evalJs(`window.__sunaDev.dock.clearDock()`)
    await sleep(300)
    await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(LP_FILE)})`)
    await sleep(1600)

    const mode = await evalJs(`document.querySelector('.editor-tab__mode')?.textContent`)
    assert(mode === 'Reading', `fixture did not open in Reading (got ${mode})`)

    // Park the cursor at the end of the document — far from every construct.
    const endOfDoc = await evalJs(`(() => {
      const host = [...document.querySelectorAll('.editor-tab')].find((h) => h.getBoundingClientRect().width > 0);
      const lines = [...host.querySelectorAll('.cm-line')];
      const last = lines[lines.length - 1];
      const r = last.getBoundingClientRect();
      return { x: r.right - 2, y: r.top + r.height / 2 };
    })()`)
    await click(endOfDoc.x, endOfDoc.y)
    await sleep(500)

    const rendered = await lpLines()
    const heading = rendered.find((t) => t.includes('Results probe'))
    // The whole point: the rendered text EQUALS the plain text, not a dimmed
    // copy of the markdown. `##␣` is Decoration.replace'd to zero width.
    assert(heading === 'Results probe', `heading still shows syntax: ${JSON.stringify(heading)}`)
    assert(!heading.includes('#'), `a '#' survived in the heading: ${JSON.stringify(heading)}`)

    const boldLine = rendered.find((t) => t.includes('bold run'))
    assert(
      boldLine === 'A bold run with italic and struck words.',
      `emphasis syntax survived: ${JSON.stringify(boldLine)}`
    )
    assert(!boldLine.includes('*'), `a '*' survived in the emphasis line`)
    assert(!boldLine.includes('~'), `a '~' survived in the strikethrough`)

    // Bullets render as a glyph; blockquote markers disappear behind a bar.
    assert(
      rendered.includes('•first bullet'),
      `bullet marker not replaced by a glyph: ${JSON.stringify(rendered)}`
    )
    const quoted = rendered.find((t) => t.includes('a quoted line'))
    assert(quoted === 'a quoted line', `blockquote '>' survived: ${JSON.stringify(quoted)}`)
    // Links show their text only, with the URL hidden.
    const linkLine = rendered.find((t) => t.includes('the link text'))
    assert(
      linkLine === 'See the link text here.',
      `link brackets/URL survived: ${JSON.stringify(linkLine)}`
    )

    // …but escapes and inline-code content are NOT transformed.
    const codeLine = rendered.find((t) => t.includes('backticks stay put'))
    assert(
      codeLine.includes('**'),
      `'**' inside inline code was eaten: ${JSON.stringify(codeLine)}`
    )
    const escapedLine = rendered.find((t) => t.includes('stays literal'))
    assert(
      escapedLine.includes('\\*star\\*'),
      `an escaped \\* was transformed: ${JSON.stringify(escapedLine)}`
    )

    // Styling still lands on the visible text (this is decoration, not deletion).
    const styled = await evalJs(`(() => {
      const host = [...document.querySelectorAll('.editor-tab')].find((h) => h.getBoundingClientRect().width > 0);
      return {
        strong: [...host.querySelectorAll('.cm-lp-strong')].map((e) => e.textContent),
        em: [...host.querySelectorAll('.cm-lp-em')].map((e) => e.textContent),
        strike: [...host.querySelectorAll('.cm-lp-strike')].map((e) => e.textContent),
        code: [...host.querySelectorAll('.cm-lp-code')].map((e) => e.textContent),
        link: [...host.querySelectorAll('.cm-lp-link')].map((e) => e.textContent),
        h2: host.querySelectorAll('.cm-line.cm-lp-h2').length,
        quote: host.querySelectorAll('.cm-line.cm-lp-quote').length,
        bullets: host.querySelectorAll('.cm-lp-bullet').length
      };
    })()`)
    assert(styled.strong.join('|') === 'bold run', `strong mark: ${JSON.stringify(styled.strong)}`)
    assert(styled.em.join('|') === 'italic', `em mark: ${JSON.stringify(styled.em)}`)
    assert(styled.strike.join('|') === 'struck', `strike mark: ${JSON.stringify(styled.strike)}`)
    assert(styled.code.join('|') === 'a ** b', `code mark: ${JSON.stringify(styled.code)}`)
    assert(styled.link.join('|') === 'the link text', `link mark: ${JSON.stringify(styled.link)}`)
    assert(styled.h2 === 1 && styled.quote === 1 && styled.bullets === 2,
      `line classes/widgets: ${JSON.stringify(styled)}`)
    await screenshot('live-preview-clean.png')

    // --- cursor in the heading line reveals '## ' -------------------------
    const headingPoint = await evalJs(`(() => {
      const host = [...document.querySelectorAll('.editor-tab')].find((h) => h.getBoundingClientRect().width > 0);
      const line = [...host.querySelectorAll('.cm-line')].find((l) => l.textContent.includes('Results probe'));
      const r = line.getBoundingClientRect();
      return { x: r.left + Math.min(40, r.width / 3), y: r.top + r.height / 2 };
    })()`)
    await click(headingPoint.x, headingPoint.y)
    await sleep(500)
    const revealedHeading = (await lpLines()).find((t) => t.includes('Results probe'))
    assert(
      revealedHeading === '## Results probe',
      `clicking the heading did not reveal '## ': ${JSON.stringify(revealedHeading)}`
    )

    // --- cursor inside the bold node reveals BOTH '**' runs, and only that
    //     node — the italic and strikethrough beside it stay rendered.
    const boldPoint = await evalJs(`(() => {
      const host = [...document.querySelectorAll('.editor-tab')].find((h) => h.getBoundingClientRect().width > 0);
      const el = host.querySelector('.cm-lp-strong');
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`)
    await click(boldPoint.x, boldPoint.y)
    await sleep(500)
    const revealedBold = (await lpLines()).find((t) => t.includes('bold run'))
    assert(
      revealedBold === 'A **bold run** with italic and struck words.',
      `bold reveal is not node-scoped: ${JSON.stringify(revealedBold)}`
    )

    // --- move away: everything hides again --------------------------------
    await click(endOfDoc.x, endOfDoc.y)
    await sleep(500)
    const hidden = await lpLines()
    assert(
      hidden.find((t) => t.includes('Results probe')) === 'Results probe',
      'the heading did not re-render after the cursor left'
    )
    assert(
      hidden.find((t) => t.includes('bold run')) === 'A bold run with italic and struck words.',
      'emphasis did not re-render after the cursor left'
    )

    // --- none of that touched the file ------------------------------------
    assert(
      bytesBefore.equals(readFileSync(LP_FILE)),
      'the live-preview decorations changed the file on disk'
    )

    // --- ⌘B still round-trips (through the hidden decorations) ------------
    const wordBox = await evalJs(`(() => {
      const host = [...document.querySelectorAll('.editor-tab')].find((h) => h.getBoundingClientRect().width > 0);
      const line = [...host.querySelectorAll('.cm-line')].find((l) => l.textContent.includes('a quoted line'));
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const i = node.textContent.indexOf('quoted');
        if (i < 0) continue;
        const range = document.createRange();
        range.setStart(node, i); range.setEnd(node, i + 'quoted'.length);
        const r = range.getBoundingClientRect();
        return { from: { x: r.left, y: r.top + r.height / 2 }, to: { x: r.right, y: r.top + r.height / 2 } };
      }
      return null;
    })()`)
    assert(wordBox !== null, 'could not locate the word "quoted" to select')
    // Select via the DOM rather than a drag: pressing inside the blockquote
    // reveals its '>' marker, which re-wraps the line under the pointer, so a
    // drag measured a moment earlier lands on different text. CodeMirror syncs
    // from the DOM selection, and the mouse-drag path is covered elsewhere.
    const selected = await evalJs(`(() => {
      const host = [...document.querySelectorAll('.editor-tab')].find((h) => h.getBoundingClientRect().width > 0);
      const content = host.querySelector('.cm-content');
      const line = [...host.querySelectorAll('.cm-line')].find((l) => l.textContent.includes('a quoted line'));
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const i = node.textContent.indexOf('quoted');
        if (i < 0) continue;
        content.focus();
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 'quoted'.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return sel.toString();
      }
      return null;
    })()`)
    await sleep(250)
    assert(selected === 'quoted', `selection for ⌘B was ${JSON.stringify(selected)}`)
    await key('b', 'KeyB', 4)
    await sleep(300)
    await key('s', 'KeyS', 4)
    await sleep(700)
    assert(
      readFileSync(LP_FILE, 'utf8').includes('> a **quoted** line'),
      `⌘B did not write '**quoted**':\n${readFileSync(LP_FILE, 'utf8')}`
    )
    await key('b', 'KeyB', 4)
    await sleep(300)
    await key('s', 'KeyS', 4)
    await sleep(700)
    assert(
      bytesBefore.equals(readFileSync(LP_FILE)),
      '⌘B did not round-trip the file back to byte-identical'
    )
  })

  /**
   * §2 — the shipped typography defaults. "Settings cleared" means all three
   * levels: the localStorage appearance store, the project's suna.json block,
   * and the global userData keys. Measured as COMPUTED style on `.cm-content`,
   * so it is what the surface really renders, not what a store holds.
   */
  await step('typography-defaults-14px-1_6', async () => {
    await evalJs(`(async () => {
      localStorage.removeItem('suna-editor-settings');
      window.__sunaDev.editorSettings.getState().reset();
      const store = window.__sunaDev.settingsStore.getState();
      for (const key of ['editor.fontSizePx', 'editor.lineHeight', 'editor.contentWidthCh']) {
        await store.clearProject(key);
      }
      await window.suna.invoke('settings:set', {
        patch: { 'editor.fontSizePx': null, 'editor.lineHeight': null, 'editor.contentWidthCh': null }
      });
    })()`)
    await sleep(800)
    await evalJs(`window.__sunaDev.dock.clearDock()`)
    await sleep(300)
    await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(LP_FILE)})`)
    await sleep(1500)

    const typography = await evalJs(`(() => {
      const host = [...document.querySelectorAll('.editor-tab')].find((h) => h.getBoundingClientRect().width > 0);
      const cs = getComputedStyle(host.querySelector('.cm-content'));
      const resolved = window.__sunaDev.settingsStore.getState().resolved;
      return {
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        resolvedFont: resolved.value['editor.fontSizePx'],
        resolvedLine: resolved.value['editor.lineHeight'],
        fontSource: resolved.sources['editor.fontSizePx'],
        lineSource: resolved.sources['editor.lineHeight']
      };
    })()`)
    assert(typography.fontSize === '14px', `computed font-size ${typography.fontSize} (want 14px)`)
    // line-height computes to px: 14 × 1.6 = 22.4.
    const lh = Number.parseFloat(typography.lineHeight)
    assert(
      Math.abs(lh - 22.4) < 0.5,
      `computed line-height ${typography.lineHeight} (want 22.4px = 14 × 1.6)`
    )
    assert(
      typography.resolvedFont === 14 && typography.resolvedLine === 1.6,
      `the resolver disagrees with the surface: ${JSON.stringify(typography)}`
    )
    assert(
      typography.fontSource === 'default' && typography.lineSource === 'default',
      `something is still overriding typography: ${JSON.stringify(typography)}`
    )
  })

  /**
   * §4 — two levels, one resolver. The criterion that matters is that neither
   * level ever writes the other's file, so userData/settings.json is compared
   * as BYTES across a project-level write.
   */
  await step('settings-project-vs-global-scopes', async () => {
    const SUNA_JSON = join(COPY_DIR, 'suna.json')
    const USER_SETTINGS = join(USER_DATA, 'settings.json')
    // Earlier steps drive the appearance popover, which legitimately writes a
    // GLOBAL width — so clear that key first to get back to the pristine
    // "default" baseline this step measures the precedence chain from.
    // The appearance popover's store is persisted in localStorage and mirrors
    // its values into global settings asynchronously, so a write from an
    // earlier step can land after a single reset. Reset both layers and poll
    // until the resolver actually reports the pristine baseline.
    let baseline = null
    for (let attempt = 0; attempt < 8; attempt++) {
      baseline = await evalJs(`(async () => {
        window.__sunaDev.editorSettings.getState().reset();
        await window.suna.invoke('settings:set', {
          patch: { 'editor.contentWidthCh': null, 'editor.fontSizePx': null, 'editor.lineHeight': null }
        });
        await window.__sunaDev.settingsStore.getState().load();
        return window.__sunaDev.settingsStore.getState().resolved?.sources?.['editor.contentWidthCh'] ?? null;
      })()`)
      if (baseline === 'default') break
      await sleep(400)
    }
    assert(baseline === 'default', `could not reach a pristine width baseline: ${baseline}`)
    await evalJs(`window.__sunaDev.dock.openSettingsTab()`)
    await sleep(1200)

    const scopes = await evalJs(`[...document.querySelectorAll('.settings__scope')].map((s) => s.dataset.scope)`)
    assert(
      scopes.join(',') === 'global,project',
      `the Settings page is not split into two scopes: ${JSON.stringify(scopes)}`
    )

    const before = await evalJs(`(() => {
      const input = document.querySelector('#proj-content-width');
      const row = input.closest('.settings-tab__row');
      return { value: input.value, badge: row.querySelector('.settings__source').textContent,
               resetDisabled: row.querySelector('.settings__reset').disabled };
    })()`)
    assert(before.badge === 'default', `content width starts at ${before.badge}, want "default"`)
    assert(before.resetDisabled === true, '"Reset to global" is enabled with no override set')

    const userBytes = readFileSync(USER_SETTINGS)
    await evalJs(setFieldJs(`document.querySelector('#proj-content-width')`, '97'))
    await evalJs(`document.querySelector('#proj-content-width').blur()`)
    await sleep(1000)

    const manifest = JSON.parse(readFileSync(SUNA_JSON, 'utf8'))
    assert(
      manifest.settings?.editor?.contentWidthCh === 97,
      `suna.json did not gain settings.editor.contentWidthCh: ${JSON.stringify(manifest.settings)}`
    )
    assert(
      readFileSync(USER_SETTINGS).equals(userBytes),
      'a PROJECT-level write also changed userData/settings.json'
    )
    const validManifest = await evalJs(
      `window.__sunaDev.validateFile('manuscript', ${JSON.stringify(join(COPY_DIR, 'manuscript', 'manuscript.json'))})`
    )
    assert(validManifest.ok, `manuscript.json stopped validating: ${JSON.stringify(validManifest.issues)}`)

    const after = await evalJs(`(() => {
      const input = document.querySelector('#proj-content-width');
      const row = input.closest('.settings-tab__row');
      const resolved = window.__sunaDev.settingsStore.getState().resolved;
      return { value: input.value, badge: row.querySelector('.settings__source').textContent,
               resetDisabled: row.querySelector('.settings__reset').disabled,
               source: resolved.sources['editor.contentWidthCh'],
               resolved: resolved.value['editor.contentWidthCh'] };
    })()`)
    assert(after.badge === 'from project', `badge reads ${JSON.stringify(after.badge)}`)
    assert(after.source === 'project' && after.resolved === 97, `resolver: ${JSON.stringify(after)}`)
    assert(after.resetDisabled === false, '"Reset to global" stayed disabled with an override set')

    // The override must actually reach the editor surface, or the hierarchy
    // is decorative (this is what state/editorSettingsBridge.ts exists for).
    // Bring a PROSE editor to the front and measure that: '.editor-tab' is
    // also worn by the data-grid tab (which sets no --ed-* variables), and
    // with the Settings tab focused no editor surface need be mounted at all.
    await evalJs(
      `window.__sunaDev.openFileTab(${JSON.stringify(join(COPY_DIR, 'manuscript', 'manuscript.md'))})`
    )
    await sleep(1200)
    const surface = await evalJs(`(() => {
      const host = document.querySelector('.editor-tab--prose');
      return { cssVar: host?.style.getPropertyValue('--ed-content-width') ?? null,
               store: window.__sunaDev.editorSettings.getState().contentWidthCh };
    })()`)
    // Opening that editor moved focus off the Settings tab; the assertions
    // below query its DOM again.
    await evalJs(`window.__sunaDev.dock.openSettingsTab()`)
    await sleep(900)
    assert(
      surface.cssVar === '97ch' && surface.store === 97,
      `the project override never reached the editor: ${JSON.stringify(surface)}`
    )
    await screenshot('settings-scopes.png')

    // --- Reset to global removes the key and the value falls back ---------
    await evalJs(`document.querySelector('#proj-content-width').closest('.settings-tab__row')
      .querySelector('.settings__reset').click()`)
    await sleep(1000)
    const reset = JSON.parse(readFileSync(SUNA_JSON, 'utf8'))
    assert(
      reset.settings?.editor?.contentWidthCh === undefined,
      `Reset to global left the key behind: ${JSON.stringify(reset.settings)}`
    )
    // Read the Settings row while it is focused, then bring the editor forward
    // for its own measurement: dockview unmounts hidden panels, so the two
    // surfaces are never in the DOM at the same time.
    const afterResetRow = await evalJs(`(() => {
      const input = document.querySelector('#proj-content-width');
      const row = input.closest('.settings-tab__row');
      return { value: input.value, badge: row.querySelector('.settings__source').textContent };
    })()`)
    await evalJs(
      `window.__sunaDev.openFileTab(${JSON.stringify(join(COPY_DIR, 'manuscript', 'manuscript.md'))})`
    )
    await sleep(1200)
    const afterReset = {
      ...afterResetRow,
      cssVar: await evalJs(
        `document.querySelector('.editor-tab--prose')?.style.getPropertyValue('--ed-content-width') ?? null`
      )
    }
    assert(afterReset.badge === 'default', `after reset the badge reads ${afterReset.badge}`)
    // 140 is SETTINGS_DEFAULTS['editor.contentWidthCh'] (settings-resolve.ts)
    assert(afterReset.value === '140', `after reset the value is ${afterReset.value} (want the 140 default)`)
    assert(
      afterReset.cssVar === '140ch',
      `the editor stayed on the reset override: ${afterReset.cssVar}`
    )

    // --- an OUT-OF-BAND edit re-resolves with no restart ------------------
    // Written straight from node — no IPC, no save, nothing in the app knows.
    // This is the "or an agent" half of §4's watch requirement.
    // Bring Settings back to the front: the measurement above left the editor
    // focused, and dockview unmounts the hidden panel's DOM.
    await evalJs(`window.__sunaDev.dock.openSettingsTab()`)
    await sleep(900)
    const handEdited = JSON.parse(readFileSync(SUNA_JSON, 'utf8'))
    handEdited.settings = { editor: { contentWidthCh: 123 } }
    writeFileSync(SUNA_JSON, JSON.stringify(handEdited, null, 2) + '\n', 'utf8')
    let watched = null
    for (let i = 0; i < 20 && watched?.resolved !== 123; i++) {
      await sleep(300)
      watched = await evalJs(`(() => {
        const resolved = window.__sunaDev.settingsStore.getState().resolved;
        return { resolved: resolved.value['editor.contentWidthCh'],
                 source: resolved.sources['editor.contentWidthCh'],
                 uiValue: document.querySelector('#proj-content-width')?.value ?? null };
      })()`)
    }
    assert(
      watched.resolved === 123 && watched.source === 'project',
      `an external suna.json edit never re-resolved: ${JSON.stringify(watched)}`
    )
    assert(watched.uiValue === '123', `the Settings page shows ${watched.uiValue} after the external edit`)

    // --- an out-of-range value is rejected by the writer -------------------
    const rejected = await evalJs(`(async () => {
      try {
        await window.suna.invoke('project:update-settings', {
          dir: ${JSON.stringify(COPY_DIR)}, patch: { editor: { contentWidthCh: 9999 } }
        });
        return false;
      } catch { return true; }
    })()`)
    assert(rejected, 'the writer accepted a content width of 9999')
    assert(
      JSON.parse(readFileSync(SUNA_JSON, 'utf8')).settings?.editor?.contentWidthCh === 123,
      'the rejected write still changed suna.json'
    )

    // put the project back the way the run found it
    await evalJs(`window.__sunaDev.settingsStore.getState().clearProject('editor.contentWidthCh')`)
    await sleep(800)
  })

  /**
   * §1 — recent projects. A real second project is created through
   * 'project:create' (the same handler the welcome screen's flow uses), which
   * is what puts it at the head of the list.
   */
  // realpath: on macOS os.tmpdir() is /var/... which is a symlink to
  // /private/var/..., and the app reports the resolved path — comparing the
  // unresolved one fails for a reason that has nothing to do with recents.
  const RECENTS_DIR = realpathSync(mkdtempSync(join(tmpdir(), 'suna-smoke-recent-')))
  TEMP_PROJECT_DIRS.push(RECENTS_DIR)
  await step('recent-projects-list-open-and-forget', async () => {
    const created = await evalJs(`window.suna.invoke('project:create', {
      dir: ${JSON.stringify(RECENTS_DIR)}, name: 'Recents Probe'
    })`)
    assert(created.name === 'Recents Probe', `project:create returned ${JSON.stringify(created.name)}`)

    // Persisted in userData — this is what survives an actual relaunch.
    const persisted = JSON.parse(readFileSync(join(USER_DATA, 'settings.json'), 'utf8'))
    const stored = persisted['recentProjects']
    assert(Array.isArray(stored) && stored[0]?.path === RECENTS_DIR,
      `the new project is not first in userData: ${JSON.stringify(stored?.slice(0, 2))}`)
    assert(stored[0].name === 'Recents Probe', `stored name: ${stored[0].name}`)
    assert(stored.length <= 10, `recents exceeded the documented cap of 10 (${stored.length})`)

    // Re-read over the channel the welcome screen uses, then render it.
    const { recents } = await evalJs(`window.suna.invoke('project:recents', {})`)
    assert(recents[0].path === RECENTS_DIR && recents[0].exists === true,
      `project:recents head: ${JSON.stringify(recents[0])}`)

    await evalJs(`window.__sunaDev.dock.clearDock()`)
    await sleep(300)
    await evalJs(`window.__sunaDev.dock.openWelcomeTab()`)
    await sleep(1200)
    const listed = await evalJs(`(() => {
      const nav = document.querySelector('.recents');
      if (!nav) return null;
      return [...nav.querySelectorAll('.recents__item')].map((li) => ({
        name: li.querySelector('.recents__name')?.textContent ?? null,
        parent: li.querySelector('.recents__path')?.textContent ?? null,
        time: li.querySelector('.recents__time')?.textContent ?? null,
        missing: !!li.querySelector('.recents__badge'),
        tag: li.querySelector('.recents__row')?.tagName ?? null
      }));
    })()`)
    assert(listed !== null && listed.length > 0, 'the welcome screen shows no recent projects')
    assert(listed[0].name === 'Recents Probe', `first row is ${JSON.stringify(listed[0])}`)
    // The row shows the project's PARENT directory; the project itself was
    // created at RECENTS_DIR.
    assert(
      listed[0].parent === dirname(RECENTS_DIR),
      `parent path shown: ${listed[0].parent} (want ${dirname(RECENTS_DIR)})`
    )
    assert(/ago|now/.test(listed[0].time ?? ''), `no relative time: ${listed[0].time}`)
    // Keyboard reachable: a real button, focusable, not a div with onClick.
    assert(listed[0].tag === 'BUTTON', `recent rows are <${listed[0].tag}>, not buttons`)
    const focused = await evalJs(`(() => {
      const row = document.querySelector('.recents__row');
      row.focus();
      return document.activeElement === row;
    })()`)
    assert(focused, 'a recent-project row cannot take keyboard focus')
    await screenshot('recents.png')

    // --- deleting the directory outside SUNA shows Missing + Remove -------
    rmSync(RECENTS_DIR, { recursive: true, force: true })
    await evalJs(`window.__sunaDev.dock.closePanel('welcome')`)
    await sleep(300)
    await evalJs(`window.__sunaDev.dock.openWelcomeTab()`)
    await sleep(1200)
    const missing = await evalJs(`(() => {
      const li = [...document.querySelectorAll('.recents__item')]
        .find((n) => n.querySelector('.recents__name')?.textContent === 'Recents Probe');
      if (!li) return null;
      return { missing: !!li.querySelector('.recents__badge'),
               badge: li.querySelector('.recents__badge')?.textContent ?? null,
               remove: !!li.querySelector('.recents__remove') };
    })()`)
    assert(missing !== null, 'the deleted project vanished from the list instead of showing Missing')
    assert(missing.missing && missing.badge === 'Missing', `missing state: ${JSON.stringify(missing)}`)
    assert(missing.remove, 'a missing project offers no Remove action')

    // --- Remove clears it from settings -----------------------------------
    await evalJs(`(() => {
      const li = [...document.querySelectorAll('.recents__item')]
        .find((n) => n.querySelector('.recents__name')?.textContent === 'Recents Probe');
      li.querySelector('.recents__remove').click();
    })()`)
    await sleep(1200)
    const names = await evalJs(`[...document.querySelectorAll('.recents__name')].map((n) => n.textContent)`)
    assert(!names.includes('Recents Probe'), `Remove left the row on screen: ${JSON.stringify(names)}`)
    const afterForget = JSON.parse(readFileSync(join(USER_DATA, 'settings.json'), 'utf8'))['recentProjects']
    assert(
      !afterForget.some((r) => r.path === RECENTS_DIR),
      'Remove did not clear the entry from userData/settings.json'
    )

    // --- opening a listed project restores it ------------------------------
    await evalJs(`(() => {
      const li = [...document.querySelectorAll('.recents__item')]
        .find((n) => n.querySelector('.recents__name')?.textContent.includes('Ram-pressure'));
      li.querySelector('.recents__row').click();
    })()`)
    await sleep(2500)
    const reopened = await evalJs(`(() => {
      const s = window.__sunaDev.projectStore.getState();
      return { rootDir: s.rootDir, name: s.manifest?.name ?? null, children: s.tree?.children?.length ?? 0 };
    })()`)
    assert(reopened.rootDir === COPY_DIR, `clicking a recent opened ${reopened.rootDir}`)
    assert(reopened.children > 0, 'the project tree did not reload after opening from recents')
  })

  /**
   * §5 — the onboarding wizard. Step 1's folder picker is a NATIVE dialog CDP
   * cannot drive (same wall as "Attach PDF…"), so `__sunaDev.onboarding.patch`
   * supplies the parent directory the picker would have returned and every
   * other step is driven through the wizard's real inputs and buttons — its
   * gating, its validation, its Review preview and its Create all run.
   */
  const WIZARD_PARENT = mkdtempSync(join(tmpdir(), 'suna-smoke-wizard-'))
  TEMP_PROJECT_DIRS.push(WIZARD_PARENT)
  const WIZARD_DIR = join(WIZARD_PARENT, 'wizard-paper')
  await step('onboarding-creates-exactly-what-review-showed', async () => {
    const wizardState = () => evalJs(`(() => {
      const s = window.__sunaDev.onboarding.getState();
      const next = document.querySelector('.onboard__next');
      const create = document.querySelector('.onboard__create');
      return {
        step: s?.step ?? null,
        title: document.querySelector('.onboard__step-title')?.textContent ?? null,
        nextDisabled: next ? next.disabled : null,
        createDisabled: create ? create.disabled : null,
        error: document.querySelector('.onboard__field-error')?.textContent ?? null
      };
    })()`)

    await evalJs(`window.__sunaDev.dock.clearDock()`)
    await sleep(300)
    await evalJs(`window.__sunaDev.dock.openOnboardingTab({ mode: 'create' })`)
    await sleep(1000)

    const start = await wizardState()
    assert(start.step === 1 && start.title === 'Where & what', `wizard start: ${JSON.stringify(start)}`)
    assert(start.nextDisabled === true, 'Next is enabled before a folder is chosen')

    await evalJs(`window.__sunaDev.onboarding.patch({ parentDir: ${JSON.stringify(WIZARD_PARENT)} })`)
    await sleep(300)

    // A name colliding with an existing directory is blocked, with a reason.
    mkdirSync(join(WIZARD_PARENT, 'taken'), { recursive: true })
    await evalJs(setFieldJs(`document.querySelector('#onboard-name')`, 'taken'))
    await sleep(900)
    const collision = await wizardState()
    assert(collision.nextDisabled === true, 'a colliding project name did not block Next')
    assert(
      /already exists/.test(collision.error ?? ''),
      `no visible reason for the collision: ${JSON.stringify(collision.error)}`
    )

    await evalJs(setFieldJs(`document.querySelector('#onboard-name')`, 'wizard-paper'))
    await sleep(1000)
    const named = await wizardState()
    assert(named.nextDisabled === false, `Next still blocked: ${JSON.stringify(named)}`)
    const shownPath = await evalJs(`document.querySelector('.onboard__path')?.textContent`)
    assert(shownPath === WIZARD_DIR, `step 1 shows ${shownPath}, want ${WIZARD_DIR}`)

    // Walk 1 → 7 through the real Next button.
    const titles = []
    for (let i = 0; i < 8; i++) {
      const at = await wizardState()
      titles.push(`${at.step}:${at.title}`)
      if (at.step === 7) break
      assert(at.nextDisabled === false, `Next disabled on step ${at.step} (${at.title})`)
      await evalJs(`document.querySelector('.onboard__next').click()`)
      await sleep(700)
    }
    assert(titles.length === 7, `walked ${titles.length} steps: ${titles.join(' → ')}`)
    assert(
      titles.join(' → ') ===
        '1:Where & what → 2:Target journal → 3:What to scaffold → 4:Python environment → 5:AI → 6:Defaults → 7:Review',
      `unexpected step order: ${titles.join(' → ')}`
    )

    // NOTHING may be on disk yet.
    assert(!existsSync(WIZARD_DIR), 'the wizard wrote the project before "Create project"')
    assert(
      readdirSync(WIZARD_PARENT).join(',') === 'taken',
      `the wizard wrote into the parent: ${JSON.stringify(readdirSync(WIZARD_PARENT))}`
    )

    const review = await evalJs(`(() => ({
      tree: document.querySelector('.onboard__tree')?.textContent ?? null,
      json: document.querySelector('.onboard__review-json')?.textContent ?? null
    }))()`)
    assert(review.tree && review.json, 'the Review step shows no tree/manifest preview')
    const previewManifest = JSON.parse(review.json)
    await screenshot('onboarding-review.png')

    // --- Create ------------------------------------------------------------
    await evalJs(`document.querySelector('.onboard__create').click()`)
    for (let i = 0; i < 40 && !existsSync(join(WIZARD_DIR, 'suna.json')); i++) await sleep(400)
    await sleep(1500)

    const wizardError = await evalJs(`window.__sunaDev.onboarding.getState()?.createError ?? null`)
    assert(wizardError === null, `the wizard reported an error: ${wizardError}`)

    // The tree matches what Review displayed, entry for entry. `.git` is the
    // one addition — git init is a listed create substep, not a tree row.
    const onDisk = readdirSync(WIZARD_DIR).filter((n) => n !== '.git').sort()
    const previewTop = review.tree
      .split('\n')
      .slice(1)
      .filter((line) => /^ {2}\S/.test(line))
      // strip trailing annotations like "(machine-local, not committed)"
      .map((line) => line.trim().replace(/\s*\(.*\)$/, '').replace(/\/$/, ''))
      .sort()
    assert(
      onDisk.join(',') === previewTop.join(','),
      `created tree ≠ Review tree\n  disk:    ${onDisk.join(',')}\n  preview: ${previewTop.join(',')}`
    )
    for (const relative of ['manuscript/manuscript.json', 'manuscript/references.bib',
      'manuscript/manuscript.md', 'manuscript/authors.json',
      'AGENTS.md', 'CLAUDE.md', 'context/MISSION.md', 'context/NOTEBOOK.md',
      'context/RULES.md', '.mcp.json']) {
      assert(existsSync(join(WIZARD_DIR, relative)), `missing ${relative}`)
    }

    // The suna.json written equals the one Review displayed, apart from
    // createdAt (Review necessarily previews a timestamp; the writer stamps
    // its own at create time — the wizard says so in its own comment).
    const written = JSON.parse(readFileSync(join(WIZARD_DIR, 'suna.json'), 'utf8'))
    const strip = (m) => JSON.stringify({ ...m, createdAt: null })
    assert(
      strip(written) === strip(previewManifest),
      `written suna.json ≠ Review preview\n  written: ${strip(written)}\n  preview: ${strip(previewManifest)}`
    )
    assert(!Number.isNaN(Date.parse(written.createdAt)), `createdAt is not a date: ${written.createdAt}`)

    // Every file the wizard wrote is schema-valid, through the REAL schemas.
    const validSuna = await evalJs(
      `window.__sunaDev.validateFile('manuscript', ${JSON.stringify(join(WIZARD_DIR, 'manuscript', 'manuscript.json'))})`
    )
    assert(validSuna.ok, `manuscript.json invalid: ${JSON.stringify(validSuna.issues)}`)
    const reopenedManifest = await evalJs(
      `window.suna.invoke('project:open', { dir: ${JSON.stringify(WIZARD_DIR)} })`
    )
    assert(reopenedManifest.manifest.name === 'wizard-paper',
      `suna.json does not reopen as a project: ${JSON.stringify(reopenedManifest.manifest?.name)}`)

    // git initialized with exactly one commit, and a clean tree.
    const log = execSync(`git -C ${JSON.stringify(WIZARD_DIR)} log --oneline`, { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
    assert(log.length === 1, `git history has ${log.length} commits:\n${log.join('\n')}`)
    const dirty = execSync(`git -C ${JSON.stringify(WIZARD_DIR)} status --porcelain`, { encoding: 'utf8' }).trim()
    assert(dirty === '', `the initial commit left files uncommitted:\n${dirty}`)

    // --- cancelling a fresh wizard at step 3 writes nothing ---------------
    const CANCEL_PARENT = mkdtempSync(join(tmpdir(), 'suna-smoke-cancel-'))
    await evalJs(`window.__sunaDev.dock.openOnboardingTab({ mode: 'create' })`)
    await sleep(900)
    await evalJs(`window.__sunaDev.onboarding.patch({ parentDir: ${JSON.stringify(CANCEL_PARENT)} })`)
    await evalJs(setFieldJs(`document.querySelector('#onboard-name')`, 'never-created'))
    await sleep(1000)
    await evalJs(`document.querySelector('.onboard__next').click()`)
    await sleep(600)
    await evalJs(`document.querySelector('.onboard__next').click()`)
    await sleep(600)
    const atThree = await wizardState()
    assert(atThree.step === 3, `expected to be on step 3, got ${JSON.stringify(atThree)}`)
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(900)
    assert(
      (await evalJs(`window.__sunaDev.onboarding.isOpen()`)) === false,
      'Escape did not cancel the wizard'
    )
    assert(
      readdirSync(CANCEL_PARENT).length === 0,
      `cancelling wrote files: ${JSON.stringify(readdirSync(CANCEL_PARENT))}`
    )
    rmSync(CANCEL_PARENT, { recursive: true, force: true })
  })

  /* =======================================================================
     docs/design/feature-plan-8.md §7 — the '?' help overlay and the
     directed AI actions, unbilled halves only. The billed legs (a comment
     fix landing edit + reply + resolve; a figure edit surviving
     compliance) are manual, like steps 47/54 — see TESTING.md →
     "Directed AI actions".
     ======================================================================= */

  await step('help-overlay', async () => {
    // The isTyping guard and focus restore are probed in
    // probes/help-overlay.mjs; here: '?' opens, the section tabs are real,
    // Esc closes. '?' must come from a non-typing target, so park focus
    // on nothing first — the previous step may have left it in an input.
    await evalJs(`(() => {
      const el = document.activeElement;
      if (el && el !== document.body) el.blur();
      return true;
    })()`)
    assert(
      !(await evalJs(`!!document.querySelector('.help-overlay')`)),
      'the help overlay is already open before the step'
    )
    await key('?', 'Slash', 8) // CDP modifiers: 8 = Shift — '?' is Shift-Slash
    await sleep(500)
    const opened = await evalJs(`(() => {
      const root = document.querySelector('.help-overlay');
      if (!root) return null;
      return {
        section: root.dataset.helpSection ?? null,
        tabs: [...root.querySelectorAll('.help-overlay__tab')].map((t) => t.textContent.trim()),
        kbd: root.querySelectorAll('kbd').length
      };
    })()`)
    assert(opened !== null, `'?' did not open the help overlay`)
    const sectionIds = ['global', 'editor', 'manuscript', 'canvas', 'explorer', 'viewers']
    assert(sectionIds.includes(opened.section), `data-help-section: ${opened.section}`)
    assert(
      opened.tabs.length === sectionIds.length,
      `${opened.tabs.length} section tabs: ${opened.tabs.join(' | ')}`
    )
    // Count rows on a PINNED section: the initial section follows whatever
    // panel is active (viewers has only 7 rows), so a filtered run reaching
    // this step with a PDF tab frontmost must not fail the count.
    const globalKbd = await evalJs(`(() => {
      const root = document.querySelector('.help-overlay');
      const tab = [...root.querySelectorAll('.help-overlay__tab')].find((t) => /global/i.test(t.textContent));
      tab.click();
      return root.querySelectorAll('kbd').length;
    })()`)
    assert(globalKbd > 10, `only ${globalKbd} <kbd> elements — the shortcut inventory did not render`)

    // a tab click switches the section (the §7 data-help-section contract)
    await evalJs(`(() => {
      const tab = [...document.querySelectorAll('.help-overlay__tab')].find((t) => /canvas/i.test(t.textContent));
      if (!tab) throw new Error('no Canvas tab');
      tab.click();
    })()`)
    await sleep(300)
    const canvas = await evalJs(`({
      section: document.querySelector('.help-overlay')?.dataset.helpSection ?? null,
      text: document.querySelector('.help-overlay')?.textContent ?? ''
    })`)
    assert(canvas.section === 'canvas', `clicking the Canvas tab landed on '${canvas.section}'`)
    assert(/duplicate/i.test(canvas.text), 'the canvas section is missing its ⌘D duplicate row')
    await screenshot('help-overlay.png')

    await key('Escape', 'Escape')
    await sleep(300)
    assert(!(await evalJs(`!!document.querySelector('.help-overlay')`)), 'Esc did not close the overlay')
  })

  await step('ai-capture-rect', async () => {
    // 'app:capture-rect' (§2b) is the canvas Agent section's screenshot
    // channel: a CSS-px page rect in, a PNG on disk out, the response
    // reporting the size decoded from the written bytes.
    const rect = { x: 24, y: 24, width: 400, height: 260 }
    const res = await evalJs(`window.suna.invoke('app:capture-rect', { rect: ${JSON.stringify(rect)} })`)
    assert(res && typeof res.path === 'string', `capture-rect response: ${JSON.stringify(res)}`)
    assert(
      res.path.includes('suna-captures'),
      `a capture without targetPath belongs under <temp>/suna-captures: ${res.path}`
    )
    assert(existsSync(res.path), `no PNG on disk at ${res.path}`)
    const ihdr = pngIhdr(res.path)
    assert(
      ihdr.width === res.width && ihdr.height === res.height,
      `response says ${res.width}×${res.height}, the file's IHDR says ${ihdr.width}×${ihdr.height}`
    )
    // The PNG is rect × devicePixelRatio, within ±10% + rounding: on a
    // non-integral display scale Chromium folds the remainder into a page
    // zoom (see pinViewport), so the DIP mapping is not exactly ×dpr.
    const dpr = await evalJs(`window.devicePixelRatio`)
    const near = (got, want) => Math.abs(got - want) <= Math.max(4, want * 0.1)
    assert(
      near(ihdr.width, rect.width * dpr) && near(ihdr.height, rect.height * dpr),
      `IHDR ${ihdr.width}×${ihdr.height} for a ${rect.width}×${rect.height} request @ dpr ${dpr}`
    )
    rmSync(res.path, { force: true })
  })

  await step('comment-ai-cancel', async () => {
    const cli = await evalJs(`window.suna.invoke('lit:cli-status', {})`)
    if (!Array.isArray(cli.available) || cli.available.length === 0) {
      console.log('    (no agent CLI installed — the directed comment fix cannot be exercised here)')
      return
    }
    if (!cli.available.includes('claude')) {
      console.log('    (codex only — directed AI edits are claude-only, the ✦ AI button stays disabled)')
      return
    }

    // The recents/onboarding steps may have switched projects — re-point at
    // the example copy, whose .mcp.json the spawn's --mcp-config will name.
    await evalJs(`window.__sunaDev.openProjectAt(${JSON.stringify(COPY_DIR)})`)
    await sleep(2000)
    const rootDir = await evalJs(`window.__sunaDev.projectStore.getState().rootDir`)
    assert(rootDir === COPY_DIR, `reopening the example landed on ${rootDir}`)
    assert(
      existsSync(join(COPY_DIR, '.mcp.json')),
      'the example copy has no .mcp.json — the agent-layer heal did not run'
    )

    // Locate the child by ITS OWN argv: the '--mcp-config <copy>/.mcp.json'
    // pair only a directed run against this project carries. Never by the
    // string "claude" (whoever runs this suite may be inside an agent CLI
    // session — step 47's rule) and never by prompt text: stdin delivery
    // keeps the prompt out of ps by design (feature-plan-8 §2a).
    const mcpArg = join(COPY_DIR, '.mcp.json')
    const running = () =>
      execSync('ps -eo pid,command', { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
        .split('\n')
        .filter((line) => line.includes('--mcp-config') && line.includes(mcpArg) && !line.includes('ps -eo'))
        .map((line) => line.trim())
    assert(running().length === 0, `a directed-AI child was already running:\n${running().join('\n')}`)

    await openManuscriptDoc()
    await evalJs(`window.__sunaDev.uiStore.getState().setCommentsRailVisible(true)`)
    await sleep(600)

    // A section comment to send — the earlier comment steps normally left
    // some; a filtered run creates its own from real prose so the anchor
    // resolves (the comment body IS the instruction, per §3).
    let commentId = await evalJs(`(() => {
      const c = window.__sunaDev.commentsStore.getState().comments.find((c) => c.target.kind === 'section');
      return c ? c.id : null;
    })()`)
    if (commentId === null) {
      const text = readFileSync(MANUSCRIPT_MD, 'utf8')
      const line = text.split('\n').find((l) => !l.startsWith('#') && l.trim().length >= 48)
      assert(line !== undefined, 'no prose line long enough to anchor a comment on')
      const quote = line.trim().slice(0, 32)
      const at = text.indexOf(quote)
      const target = {
        kind: 'section',
        path: 'manuscript.md',
        anchor: {
          prefix: text.slice(Math.max(0, at - 32), at),
          quote,
          suffix: text.slice(at + quote.length, at + quote.length + 32)
        }
      }
      const created = await evalJs(
        `window.__sunaDev.commentsStore.getState().add(${JSON.stringify(target)}, 'Smoke probe: tighten this sentence.')`
      )
      assert(created !== null, 'could not create a fallback comment')
      commentId = created.id
    }
    await evalJs(`window.__sunaDev.commentsStore.getState().setActive(${JSON.stringify(commentId)})`)
    const cardSel = `.cmt-rail .cmt-card[data-comment-id="${commentId}"]`

    // The button starts disabled behind the rail's one 'lit:cli-status'
    // round trip — wait for the gate to open before clicking.
    let button = null
    for (let i = 0; i < 20; i++) {
      button = await evalJs(`(() => {
        const btn = document.querySelector(${JSON.stringify(`${cardSel} .cmt__btn--ai`)});
        return btn ? { disabled: btn.disabled, title: btn.title } : null;
      })()`)
      if (button !== null && !button.disabled) break
      await sleep(300)
    }
    assert(button !== null, 'the active comment card renders no ✦ AI button')
    assert(!button.disabled, `the ✦ AI button never enabled: '${button.title}'`)

    // --- start the fix, then cancel ~3 s in (unbilled) ---------------------
    await evalJs(`document.querySelector(${JSON.stringify(`${cardSel} .cmt__btn--ai`)}).click()`)
    let spawned = []
    for (let i = 0; i < 16 && spawned.length === 0; i++) {
      await sleep(500)
      spawned = running()
    }
    assert(spawned.length > 0, 'the ✦ AI click spawned no CLI child carrying the project --mcp-config')
    const pids = spawned.map((line) => line.split(/\s+/)[0])
    const busy = await evalJs(`(() => {
      const card = document.querySelector(${JSON.stringify(cardSel)});
      return {
        busyClass: card?.classList.contains('cmt-card--ai-busy') ?? false,
        cancel: !![...(card?.querySelectorAll('.cmt__actions .cmt__btn') ?? [])]
          .find((b) => b.textContent.trim() === 'Cancel')
      };
    })()`)
    assert(busy.busyClass, 'the card did not enter its ai-busy state')
    assert(busy.cancel, 'no Cancel button on the card while the fix runs')
    await screenshot('comment-ai-busy.png')
    await sleep(1000)

    await evalJs(`[...document.querySelector(${JSON.stringify(cardSel)}).querySelectorAll('.cmt__actions .cmt__btn')]
      .find((b) => b.textContent.trim() === 'Cancel').click()`)
    let left = null
    for (let i = 0; i < 24; i++) {
      await sleep(500)
      left = running()
      if (left.length === 0) break
    }
    assert(left.length === 0, `Cancel left a CLI child alive:\n${left.join('\n')}`)
    for (const pid of pids) {
      let alive = true
      try {
        execSync(`ps -p ${pid} > /dev/null 2>&1`, { shell: '/bin/bash' })
      } catch {
        alive = false
      }
      assert(!alive, `spawned pid ${pid} is still alive after Cancel`)
    }

    // the card must leave its busy state and offer the button again
    let after = null
    for (let i = 0; i < 20; i++) {
      after = await evalJs(`(() => {
        const card = document.querySelector(${JSON.stringify(cardSel)});
        return {
          busyClass: card?.classList.contains('cmt-card--ai-busy') ?? false,
          aiButton: !!card?.querySelector('.cmt__btn--ai')
        };
      })()`)
      if (!after.busyClass) break
      await sleep(500)
    }
    assert(!after.busyClass, 'the card is still in its ai-busy state after Cancel')
    assert(after.aiButton, 'the ✦ AI button did not come back after Cancel')
    const note = await evalJs(`window.__sunaDev.uiStore.getState().statusNote`)
    assert(note !== null && /cancel/i.test(note), `the cancelled run was not reported honestly: ${note}`)
  })

  await step('explorer-drag-move', async () => {
    // feature-plan-9 §2 in the running app: a real synthetic drag moves a file
    // on disk, the open tab follows it, and a folder dropped into its own
    // child is refused. The Finder/OS actions at the end stop at the IPC
    // boundary on purpose (§5): a real `shell:reveal` would pop a Finder
    // window onto the screen the hidden-driver work exists to keep clear, so
    // what is asserted here is the wiring — labels, enablement, and the
    // executable refusal.
    //
    // The recents/onboarding steps switch projects, so re-point at the copy
    // first (comment-ai-cancel does the same, but returns early with no CLI).
    await evalJs(`window.__sunaDev.openProjectAt(${JSON.stringify(COPY_DIR)})`)
    await sleep(2000)
    const rootDir = await evalJs(`window.__sunaDev.projectStore.getState().rootDir`)
    assert(rootDir === COPY_DIR, `reopening the example landed on ${rootDir}`)
    await showView('explorer')
    await sleep(400)

    const dataDir = join(COPY_DIR, 'data')
    const figuresDir = join(COPY_DIR, 'figures')
    const spectrumDir = join(figuresDir, 'fig-spectrum')
    const atRoot = join(COPY_DIR, 'drag-probe.md')
    const inData = join(dataDir, 'drag-probe.md')

    /**
     * One synthetic drag up to the hover: dragstart on the source row, then
     * dragenter/dragover on the target. The DataTransfer is a REAL one — the
     * same technique the SVG-import step above uses — so the handlers'
     * setData/getData go through the platform object and the payload read
     * back here is the payload a real drag would carry. It is stashed on
     * `window` because each evaluate has its own scope and the drop must
     * carry the SAME transfer the dragstart filled. `overPath: null` targets
     * the tree container below the last row: the project-root drop.
     */
    const hover = (fromPath, overPath) =>
      evalJs(`(() => {
        const rows = [...document.querySelectorAll('.tree__row')];
        const row = (p) => rows.find((r) => r.dataset.path === p) ?? null;
        const src = row(${JSON.stringify(fromPath)});
        if (src === null) throw new Error('no tree row for ' + ${JSON.stringify(fromPath)});
        const target = ${overPath === null ? `document.querySelector('.tree')` : `row(${JSON.stringify(overPath)})`};
        if (target === null) throw new Error('no drop target for ' + ${JSON.stringify(overPath ?? '(tree empty area)')});
        if (!src.draggable) throw new Error('.tree__row is not draggable');
        const box = target.getBoundingClientRect();
        const at = {
          clientX: box.left + 24,
          clientY: ${overPath === null ? 'box.bottom - 4' : 'box.top + box.height / 2'}
        };
        const dt = new DataTransfer();
        const fire = (el, type) =>
          el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
        fire(src, 'dragstart');
        fire(target, 'dragenter');
        fire(target, 'dragover');
        window.__sunaDragProbe = { src, target, dt, at };
        return {
          paths: dt.getData('application/x-suna-paths'),
          text: dt.getData('text/plain'),
          effectAllowed: dt.effectAllowed,
          rowHighlights: [...document.querySelectorAll('.tree__row--droptarget')].map((r) => r.dataset.path),
          rootHighlighted: !!document.querySelector('.tree--droptarget')
        };
      })()`)

    const drop = () =>
      evalJs(`(() => {
        const probe = window.__sunaDragProbe;
        if (!probe) throw new Error('drop without a drag in flight');
        const opts = { bubbles: true, cancelable: true, dataTransfer: probe.dt, ...probe.at };
        probe.target.dispatchEvent(new DragEvent('drop', opts));
        probe.src.dispatchEvent(new DragEvent('dragend', opts));
        delete window.__sunaDragProbe;
        return true;
      })()`)

    const rowExists = (path) =>
      evalJs(
        `[...document.querySelectorAll('.tree__row')].some((r) => r.dataset.path === ${JSON.stringify(path)})`
      )
    const panelIds = () => evalJs(`Object.keys(window.__sunaDev.dock.panelComponents())`)
    /** Poll a node-side or page-side predicate; the drop is one IPC round trip
     *  plus a tree refresh away from being visible. */
    const until = async (predicate, what, tries = 24) => {
      for (let i = 0; i < tries; i++) {
        if (await predicate()) return
        await sleep(250)
      }
      throw new Error(`timed out waiting for ${what}`)
    }

    try {
      // a leftover from an aborted run would make "the file moved" pass vacuously
      rmSync(atRoot, { force: true })
      rmSync(inData, { force: true })
      await evalJs(
        `window.suna.invoke('fs:create-file', { path: ${JSON.stringify(atRoot)}, content: '# drag probe\\n' })`
      )
      await evalJs(
        `window.__sunaDev.explorerStore.getState().toggleExpanded(${JSON.stringify(dataDir)}, true)`
      )
      await evalJs(
        `window.__sunaDev.explorerStore.getState().toggleExpanded(${JSON.stringify(figuresDir)}, true)`
      )
      await evalJs(`window.__sunaDev.projectStore.getState().refreshTree()`)
      await until(() => rowExists(atRoot), 'the probe file appearing in the tree')
      await evalJs(`window.__sunaDev.dock.openFileTab(${JSON.stringify(atRoot)})`)
      await until(async () => (await panelIds()).includes(atRoot), 'a tab open on the probe file')

      // --- a file row onto a folder row -----------------------------------
      const ontoFolder = await hover(atRoot, dataDir)
      assert(
        ontoFolder.paths === JSON.stringify([atRoot]),
        `application/x-suna-paths carried ${ontoFolder.paths || '(nothing)'}`
      )
      assert(ontoFolder.text === atRoot, `the text/plain fallback carried '${ontoFolder.text}'`)
      // NOT asserted: Chromium ignores effectAllowed/dropEffect assignment on a
      // synthetic `new DataTransfer()` (measured — both read back 'none'),
      // though setData works. The payload and the highlight below are what a
      // synthetic drag can actually observe.
      assert(
        ontoFolder.rowHighlights.length === 1 && ontoFolder.rowHighlights[0] === dataDir,
        `hovering data/ highlighted ${JSON.stringify(ontoFolder.rowHighlights)}`
      )
      await screenshot('explorer-drag-move.png') // the droptarget highlight, mid-drag
      await drop()
      await until(() => existsSync(inData) && !existsSync(atRoot), 'the file moving into data/ on disk')
      await until(() => rowExists(inData), 'the row rendering under data/')
      assert(!(await rowExists(atRoot)), 'the row is still listed at the project root after the move')
      // measurement 5's dead-tab bug: the open tab must follow the file
      await until(async () => (await panelIds()).includes(inData), 'the open tab retargeting to data/')
      assert(!(await panelIds()).includes(atRoot), 'a panel is still open on the pre-move path')

      // --- and back out to the project root --------------------------------
      const ontoRoot = await hover(inData, null)
      assert(ontoRoot.rootHighlighted, '.tree--droptarget missing on a hover over the tree empty area')
      assert(
        ontoRoot.rowHighlights.length === 0,
        `a root drop also highlighted rows: ${JSON.stringify(ontoRoot.rowHighlights)}`
      )
      await drop()
      await until(() => existsSync(atRoot) && !existsSync(inData), 'the file moving back to the root')
      await until(async () => (await panelIds()).includes(atRoot), 'the tab retargeting back to the root path')

      // --- refused: a folder onto its own child ----------------------------
      const refused = await hover(figuresDir, spectrumDir)
      assert(
        refused.rowHighlights.length === 0 && !refused.rootHighlighted,
        `figures/ onto its own child painted a target: ${JSON.stringify(refused.rowHighlights)}`
      )
      await drop()
      await sleep(800)
      assert(existsSync(spectrumDir), `${spectrumDir} disappeared — the refused drop moved something`)
      assert(
        !existsSync(join(spectrumDir, 'figures')),
        'figures/ moved into its own child — the descendant guard did not hold'
      )
      assert(readdirSync(COPY_DIR).includes('figures'), 'figures/ is no longer at the project root')
    } finally {
      await evalJs(`delete window.__sunaDragProbe`)
      for (const path of [atRoot, inData]) {
        await evalJs(`window.__sunaDev.dock.closePanel(${JSON.stringify(path)})`)
        rmSync(path, { force: true })
      }
      await evalJs(`window.__sunaDev.projectStore.getState().refreshTree()`)
    }

    // --- §3: the OS actions, asserted at the IPC boundary only -------------
    const revealLabel =
      process.platform === 'darwin'
        ? 'Reveal in Finder'
        : process.platform === 'win32'
          ? 'Show in Explorer'
          : 'Show in File Manager'
    const osItems = () =>
      evalJs(`(() => {
        const read = (action) => {
          const item = document.querySelector('.ctxmenu__item[data-action="' + action + '"]');
          return item ? { text: item.textContent.trim(), disabled: item.disabled } : null;
        };
        const rename = [...document.querySelectorAll('.ctxmenu__item')]
          .find((b) => b.textContent.startsWith('Rename'));
        return {
          reveal: read('reveal-in-os'),
          open: read('open-with-os'),
          renameDisabled: rename ? rename.disabled : null
        };
      })()`)

    await evalJs(`window.__sunaDev.explorerStore.getState().selectRow(${JSON.stringify(join(COPY_DIR, 'suna.json'))}, [], {})`)
    await openTreeMenu('suna.json')
    await sleep(200)
    const single = await osItems()
    assert(single.reveal !== null, `no .ctxmenu__item[data-action="reveal-in-os"] in the explorer menu`)
    assert(single.open !== null, `no .ctxmenu__item[data-action="open-with-os"] in the explorer menu`)
    assert(
      single.reveal.text.includes(revealLabel),
      `the reveal item reads '${single.reveal.text}', expected '${revealLabel}' on ${process.platform}`
    )
    assert(
      single.open.text.includes('Open with Default App'),
      `the open-with item reads '${single.open.text}'`
    )
    assert(!single.reveal.disabled && !single.open.disabled, 'both OS actions are disabled on a single row')
    await evalJs(`window.__sunaDev.explorerStore.getState().closeMenu()`)

    // >1 selected: both disable, exactly as Rename… does (§3's precedent)
    await evalJs(`(() => {
      const store = window.__sunaDev.explorerStore.getState();
      store.selectRow(${JSON.stringify(join(COPY_DIR, 'suna.json'))}, [], {});
      store.selectRow(${JSON.stringify(join(COPY_DIR, 'README.md'))}, [], { additive: true });
      return true;
    })()`)
    await openTreeMenu('suna.json')
    await sleep(200)
    const multi = await osItems()
    assert(multi.renameDisabled === true, 'Rename… is not disabled at 2 selected — the precedent moved')
    assert(
      multi.reveal.disabled === true && multi.open.disabled === true,
      `with 2 rows selected the OS actions must disable: ${JSON.stringify(multi)}`
    )
    await evalJs(`window.__sunaDev.explorerStore.getState().closeMenu()`)

    // The one channel this suite may call: it must REFUSE. The fixture keeps
    // a .txt extension on purpose — the guard under test is the user-execute
    // MODE bit, and if it ever regresses, a .txt is the least harmful thing
    // LaunchServices could be handed.
    const execProbe = join(COPY_DIR, 'exec-probe.txt')
    writeFileSync(execProbe, 'not a program\n')
    chmodSync(execProbe, 0o755)
    assert((statSync(execProbe).mode & 0o100) !== 0, 'the fixture is not user-executable — nothing was tested')
    const refusal = await evalJs(
      `window.suna.invoke('shell:open-path', { path: ${JSON.stringify(execProbe)} })`
    )
    rmSync(execProbe, { force: true })
    assert(
      refusal && typeof refusal.error === 'string' && refusal.error.length > 0,
      `shell:open-path did not refuse an executable file: ${JSON.stringify(refusal)}`
    )
    assert(
      /refus/i.test(refusal.error) && refusal.error.includes('exec-probe.txt'),
      `the refusal is not an honest, file-naming one: ${refusal.error}`
    )
  })

  await step('help-in-vim-mode', async () => {
    // feature-plan-9 §1. Measured, not assumed: in NORMAL mode a bare '?' is
    // vim's search-backward and never reaches the window listener, so the
    // overlay is reachable only through vim's own :help.
    //
    // The dock is emptied first (step 48's move): by now the split-view steps
    // have left editors in two groups, and "the visible editor" below must be
    // the manuscript buffer this step then compares before and after. Safe
    // because this is the last step — nothing after it needs a tab.
    await evalJs(`window.__sunaDev.dock.clearDock()`)
    await sleep(400)
    await evalJs(`window.__sunaDev.dock.openFileTab(${JSON.stringify(MANUSCRIPT_MD)})`)
    await sleep(1500)
    const visibleContent = `(() => {
      const host = [...document.querySelectorAll('.editor-tab')].find((h) => h.getBoundingClientRect().width > 0);
      return host ? host.querySelector('.cm-content') : null;
    })()`
    const focusBuffer = () =>
      evalJs(`(() => {
        const content = ${visibleContent};
        if (!content) throw new Error('no visible editor tab to focus');
        content.focus();
        return true;
      })()`)
    const overlayOpen = () => evalJs(`!!document.querySelector('.help-overlay')`)
    const vimPanel = () =>
      evalJs(`(() => {
        const panel = document.querySelector('.cm-vim-panel');
        return panel ? panel.textContent : null;
      })()`)

    await evalJs(`window.__sunaDev.settingsStore.getState().setGlobal('editor.vimMotions', true)`)
    try {
      await focusBuffer()
      // The status-bar chip is the only signal that the keymap is installed on
      // THIS editor; the setting alone says nothing about which view took it.
      let mode = null
      for (let i = 0; i < 20 && mode !== 'normal'; i++) {
        mode = await evalJs(
          `(() => { const chip = document.querySelector('.statusbar__vim'); return chip ? chip.textContent.trim() : null; })()`
        )
        if (mode !== 'normal') await sleep(250)
      }
      assert(mode === 'normal', `the buffer is in '${mode}' mode, not normal`)
      // Polled: the shared session reads the file asynchronously, and `peek`
      // answers null until it has.
      let bufferBefore = null
      for (let i = 0; i < 20 && typeof bufferBefore !== 'string'; i++) {
        bufferBefore = await evalJs(
          `window.__sunaDev.docSessions.peek(${JSON.stringify(MANUSCRIPT_MD)})`
        )
        if (typeof bufferBefore !== 'string') await sleep(250)
      }
      assert(typeof bufferBefore === 'string', 'no shared doc session for the manuscript buffer')
      assert(!(await overlayOpen()), 'the help overlay is already open before the vim pass')

      // ⌘⇧/ is not a binding: the two doors are '?' outside a buffer and
      // ':help' inside one, so the chord must do nothing here.
      await key('?', 'Slash', 12) // CDP modifiers: 4 = Meta, 8 = Shift
      await sleep(500)
      assert(!(await overlayOpen()), '⌘⇧/ opened the overlay — that chord was removed')

      // :help — the vim-native path through the ex registry
      await focusBuffer()
      await key(':', 'Semicolon', 8)
      await sleep(400)
      assert(
        await evalJs(`!!document.querySelector('.cm-vim-panel input')`),
        `':' did not open vim's command line`
      )
      await insertText('help')
      const typed = await evalJs(`document.querySelector('.cm-vim-panel input').value`)
      assert(typed === 'help', `the ':' command line reads '${typed}' after typing help`)
      // windowsVirtualKeyCode is NOT optional: vim's command line tests
      // `e.keyCode == 13`, and CDP leaves keyCode 0 without it, so a plain
      // Enter would be swallowed and :help would never run.
      for (const type of ['keyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', {
          type,
          key: 'Enter',
          code: 'Enter',
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13
        })
      }
      await sleep(600)
      assert(await overlayOpen(), `':help' did not open the overlay`)
      await screenshot('help-in-vim-mode.png')
      await key('Escape', 'Escape')
      await sleep(300)
      assert(!(await overlayOpen()), `Esc did not close the overlay opened by ':help'`)

      // a bare '?' — vim's search-backward panel, never the overlay. Sent
      // without text: in normal mode the keymap consumes the keydown, so a
      // text-carrying event would only matter if the keymap broke — and then
      // it would write into manuscript.md instead of failing an assertion.
      await focusBuffer()
      await key('?', 'Slash', 8)
      await sleep(500)
      assert(!(await overlayOpen()), `a bare '?' in a vim buffer opened the overlay`)
      const panel = await vimPanel()
      assert(
        panel !== null && panel.includes('?'),
        `'?' did not open vim's search panel: ${JSON.stringify(panel)}`
      )
      await key('Escape', 'Escape')
      await sleep(300)
      assert((await vimPanel()) === null, `Esc did not close vim's search panel`)

      const bufferAfter = await evalJs(
        `window.__sunaDev.docSessions.peek(${JSON.stringify(MANUSCRIPT_MD)})`
      )
      assert(bufferAfter === bufferBefore, 'the vim pass changed the manuscript buffer')
    } finally {
      // Vim off however this ended: every later step's keyboard depends on it.
      await evalJs(`window.__sunaDev.settingsStore.getState().setGlobal('editor.vimMotions', false)`)
    }
  })

  /**
   * Saving a figure on the canvas updates that figure WHERE IT APPEARS in the
   * manuscript, with no reopen and no retyping. The two surfaces are opened
   * side by side on purpose: switching tabs would unmount the editor and
   * rebuild its widgets from the (now cold) asset cache anyway, so the split
   * is the case that actually exercises the repaint.
   */
  await step('figure-save-shows-in-manuscript', async () => {
    await resetDock()
    await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(MANUSCRIPT_MD)})`)
    await sleep(1500)

    /** The inlined figure in the prose: its <text> count and its panel letters. */
    const embedded = () =>
      evalJs(`(() => {
        const host = document.querySelector('[data-suna-asset-path$="fig-spectrum/figure.svg"]');
        if (!host) return null;
        return {
          texts: host.querySelectorAll('text').length,
          letters: [...host.querySelectorAll('[data-suna-panel-letter]')].map((t) => t.textContent.trim())
        };
      })()`)

    // CodeMirror only builds widgets for the rendered viewport, so scroll
    // until the embed exists rather than assuming it starts on screen.
    let before = await embedded()
    for (let i = 0; before === null && i < 12; i++) {
      await evalJs(`(() => {
        const sc = [...document.querySelectorAll('.cm-scroller')].find((e) => e.getBoundingClientRect().width > 0);
        sc.scrollTop += 600;
        return sc.scrollTop;
      })()`)
      await sleep(400)
      before = await embedded()
    }
    assert(before !== null, 'the manuscript never painted the fig-spectrum embed')
    assert(before.texts > 0, 'the embedded figure inlined no text at all')
    assert(before.letters.length === 0,
      `the embed already carries panel letters: ${before.letters.join(',')}`)

    // The same figure on the canvas, beside the prose.
    await evalJs(`window.__sunaDev.dock.openInSplit(${JSON.stringify(FIGURE)}, 'right')`)
    await sleep(2000)
    await evalJs(canvasJs(`
      [...CT.querySelectorAll('.canvas-figure__action')]
        .find((b) => b.textContent.includes('Auto-letter')).click();
      return true;
    `))
    await sleep(900)
    const onCanvas = await evalJs(canvasJs(`
      return CT.querySelectorAll('.canvas-world > svg text[data-suna-panel-letter]').length;
    `))
    assert(onCanvas === 2, `auto-letter put ${onCanvas} labels on the canvas, want 2`)

    // Unsaved edits must NOT leak into the manuscript: the file on disk is
    // still what the prose shows.
    const unsaved = await embedded()
    assert(unsaved.letters.length === 0,
      `the manuscript picked up UNSAVED canvas edits: ${unsaved.letters.join(',')}`)

    await evalJs(canvasJs(`CT.querySelector('.canvas-viewport').focus(); return true;`))
    await key('s', 'KeyS', 4)
    await sleep(1800)

    const onDisk = await evalJs(
      `window.suna.invoke('fs:read-text', { path: ${JSON.stringify(FIGURE)} })
        .then((r) => (r.content.match(/data-suna-panel-letter/g) || []).length)`
    )
    assert(onDisk === 2, `figure.svg on disk carries ${onDisk} panel letters, want 2`)

    const after = await embedded()
    assert(after !== null, 'the embed disappeared from the manuscript after the save')
    assert(
      after.letters.join(',') === 'a,b',
      `the manuscript did not pick up the saved figure: letters=[${after.letters.join(',')}], ` +
        `texts ${before.texts} -> ${after.texts}`
    )
  })

  /**
   * Insert-figure picker (⌘⇧F / right-click "Insert figure…"), the figure
   * counterpart of the citation picker: pick from the project's figures,
   * ↵ places `![[fig:id]]`, ⇧↵ writes the in-prose `@fig:id`.
   */
  await step('insert-figure-picker', async () => {
    const scratch = join(COPY_DIR, 'manuscript', 'figpicker.md')
    writeFileSync(scratch, 'Intro line.\n')
    TEMP_FILES.push(scratch)
    await resetDock()
    await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(scratch)}); 'ok'`)
    await sleep(1200)

    const focusEditor = () =>
      evalJs(`(() => {
        const cm = [...document.querySelectorAll('.cm-content')].find((e) => e.getBoundingClientRect().width > 0);
        cm.focus();
        return 'ok';
      })()`)

    /**
     * ⌘⇧F. windowsVirtualKeyCode is NOT optional for a shifted letter:
     * CodeMirror recovers the unshifted binding name ('f') through
     * `base[event.keyCode]`, and CDP leaves keyCode 0 without it — so the
     * chord would arrive and match nothing. Modifiers: 4 meta | 8 shift.
     */
    const insertFigureChord = async () => {
      for (const type of ['keyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', {
          type,
          key: 'F',
          code: 'KeyF',
          modifiers: 12,
          windowsVirtualKeyCode: 70,
          nativeVirtualKeyCode: 70
        })
      }
    }
    const enter = async (shift) => {
      for (const type of ['keyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', {
          type,
          key: 'Enter',
          code: 'Enter',
          modifiers: shift ? 8 : 0,
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13
        })
      }
    }

    await focusEditor()
    await sleep(250)
    await insertFigureChord()
    await sleep(800)

    const picker = await evalJs(`(() => {
      const p = document.querySelector('.md-figpicker');
      if (!p) return null;
      return {
        ids: [...p.querySelectorAll('.md-figpicker__item')].map((b) => b.dataset.figureId),
        thumbs: p.querySelectorAll('img.md-figpicker__thumb').length,
        inputFocused: document.activeElement === p.querySelector('.md-figpicker__input')
      };
    })()`)
    assert(picker, '⌘⇧F did not open the figure picker')
    assert(picker.inputFocused, 'the picker opened without focusing its filter field')
    // The demo's two figures, in manuscript order (which is figure-numbering
    // order). Earlier steps legitimately add more — new-figure-and-svg-import
    // creates one — so this pins the known two rather than the whole list.
    const spectrumAt = picker.ids.indexOf('fig-spectrum')
    const velocityAt = picker.ids.indexOf('fig-velocity-map')
    assert(
      spectrumAt !== -1 && velocityAt !== -1,
      `picker lists ${JSON.stringify(picker.ids)} — missing one of the demo figures`
    )
    assert(
      spectrumAt < velocityAt,
      `picker is not in manuscript order: ${JSON.stringify(picker.ids)}`
    )
    assert(
      picker.thumbs === picker.ids.length,
      `${picker.thumbs} thumbnails for ${picker.ids.length} figures`
    )

    // typing narrows the list. Filtered on 'fig-velocity', not 'velocity':
    // new-figure-and-svg-import may have left a 'velocity-map' figure in the
    // project, and only the demo's carries the 'fig-' prefix.
    await evalJs(`(() => {
      const input = document.querySelector('.md-figpicker__input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'fig-velocity');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`)
    await sleep(400)
    const filtered = await evalJs(
      `[...document.querySelectorAll('.md-figpicker__item')].map((b) => b.dataset.figureId)`
    )
    assert(
      filtered.length === 1 && filtered[0] === 'fig-velocity-map',
      `filtering by "fig-velocity" left ${JSON.stringify(filtered)}`
    )

    // ↵ places the embed as its own paragraph and closes the picker
    await enter(false)
    await sleep(600)
    const placed = await evalJs(`window.__sunaDev.docSessions.peek(${JSON.stringify(scratch)})`)
    assert(
      placed.startsWith('![[fig:fig-velocity-map]]\n\n'),
      `↵ did not place the embed as its own paragraph: ${JSON.stringify(placed)}`
    )
    assert(
      (await evalJs(`!!document.querySelector('.md-figpicker')`)) === false,
      'the picker stayed open after inserting'
    )

    // ⇧↵ writes the in-prose reference instead
    await focusEditor()
    await sleep(250)
    await insertFigureChord()
    await sleep(800)
    await enter(true)
    await sleep(600)
    const referenced = await evalJs(`window.__sunaDev.docSessions.peek(${JSON.stringify(scratch)})`)
    assert(
      /@fig:fig-spectrum/.test(referenced),
      `⇧↵ did not insert a cross-reference: ${JSON.stringify(referenced)}`
    )

    // and the same action is one right-click away
    await evalJs(`(() => {
      const cm = [...document.querySelectorAll('.cm-content')].find((e) => e.getBoundingClientRect().width > 0);
      const r = cm.getBoundingClientRect();
      cm.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 10 }));
      return 'ok';
    })()`)
    await sleep(500)
    const menuItem = await evalJs(
      `(() => {
        const el = document.querySelector('.md-ctxmenu__item[data-action="insertFigure"]');
        return el ? el.textContent.trim() : null;
      })()`
    )
    assert(menuItem !== null, 'no "Insert figure…" item in the right-click menu')
    assert(/⌘⇧F/.test(menuItem), `the menu item does not name its shortcut: ${menuItem}`)
    await evalJs(`(() => {
      const scrim = document.querySelector('.md-ctxmenu-scrim');
      if (scrim) scrim.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      return 'ok';
    })()`)
  })

  /**
   * Autosave (global 'editor.autosave', ON by default): a dirty buffer writes
   * itself out after a pause, quietly, and stops doing so the moment the
   * setting is turned off — with ⌘S still working either way.
   */
  await step('autosave-on-by-default', async () => {
    const scratch = join(COPY_DIR, 'manuscript', 'autosave.md')
    writeFileSync(scratch, 'start\n')
    TEMP_FILES.push(scratch)
    await resetDock()
    await evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(scratch)}); 'ok'`)
    await sleep(1200)

    const setting = () =>
      evalJs(`window.__sunaDev.settingsStore.getState().settings['editor.autosave']`)
    const dirty = () =>
      evalJs(
        `window.__sunaDev.docSessions.meta.getState().meta.get(${JSON.stringify(scratch)})?.dirty`
      )
    const type = async (text) => {
      await evalJs(`(() => {
        const cm = [...document.querySelectorAll('.cm-content')].find((e) => e.getBoundingClientRect().width > 0);
        cm.focus();
        return 'ok';
      })()`)
      await sleep(200)
      await insertText(text)
    }

    assert((await setting()) === true, 'editor.autosave is not on by default')

    // The note an earlier step left behind: an autosave must not replace it.
    const noteBefore = await evalJs(`window.__sunaDev.uiStore.getState().statusNote`)

    await type('AUTO ')
    await sleep(250)
    assert((await dirty()) === true, 'typing did not mark the buffer dirty')
    assert(
      !readFileSync(scratch, 'utf8').includes('AUTO '),
      'the edit reached disk before the autosave idle elapsed'
    )

    await sleep(1600)
    assert(readFileSync(scratch, 'utf8').includes('AUTO '), 'autosave never wrote the file')
    assert((await dirty()) === false, 'the session stayed dirty after autosaving')
    // quiet: a note per typing pause would turn the status bar into a ticker
    const note = await evalJs(`window.__sunaDev.uiStore.getState().statusNote`)
    assert(note === noteBefore, `autosave announced itself: ${JSON.stringify(note)}`)

    // off in global settings -> nothing writes itself, but ⌘S still does
    await evalJs(
      `window.__sunaDev.settingsStore.getState().update('editor.autosave', false).then(() => 'ok')`
    )
    await sleep(300)
    try {
      await type('MANUAL ')
      await sleep(2200)
      assert(
        !readFileSync(scratch, 'utf8').includes('MANUAL '),
        'autosave still wrote with the setting off'
      )
      await key('s', 'KeyS', 4)
      await sleep(900)
      assert(
        readFileSync(scratch, 'utf8').includes('MANUAL '),
        '⌘S did not save while autosave was off'
      )
    } finally {
      // Back on however this ended: it is the shipped default.
      await evalJs(
        `window.__sunaDev.settingsStore.getState().update('editor.autosave', true).then(() => 'ok')`
      )
    }
  })

  // Under KEEP_GOING a failed step did not throw, so the summary is decided
  // here rather than by having reached this line. Skipped steps (--only/
  // --from/--until) count as passed and can never turn a run red.
  if (results.some((r) => !r.ok)) throw new Error('one or more steps failed')
  const skipped = results.filter((r) => r.skipped).length
  console.log(
    `\nALL ${results.length - skipped} STEPS PASSED${skipped > 0 ? ` (${skipped} skipped)` : ''}`
  )
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
  // Scratch projects the feature-plan-5 steps created outside the example
  // copy. The app is stopped FIRST (unless --keep) so nothing rewrites files
  // while they are removed; stale recents rows need no scrubbing — they live
  // in the scratch userData, which the next run wipes.
  cleanup()
  for (const file of TEMP_FILES) {
    rmSync(file, { force: true })
  }
  for (const dir of TEMP_PROJECT_DIRS) {
    rmSync(dir, { recursive: true, force: true })
  }
}
process.exit(exitCode)
