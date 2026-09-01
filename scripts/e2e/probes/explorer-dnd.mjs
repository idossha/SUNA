/**
 * Drive probe — explorer drag-and-drop (DECISIONS 2026-08-17, the §6 selector
 * contract):
 *
 *   1. a file row dragged onto a folder row moves the file ON DISK, retargets
 *      its open tab, and re-renders the row under the folder;
 *   2. the same row dragged back onto the tree's empty area below the rows
 *      returns it to the project root;
 *   3. a folder dropped onto its own child is refused — nothing highlights
 *      and nothing on disk moves.
 *
 * The probe creates its own `dnd-probe.md` at the project root and removes it
 * again (with its tab), so it neither depends on nor pollutes the drive copy.
 * The refused case is measured against the example's own `figures/` tree,
 * which a refusal by definition leaves untouched.
 *
 * Run:  node scripts/e2e/drive.mjs --boot --example
 *       node scripts/e2e/drive.mjs scripts/e2e/probes/explorer-dnd.mjs
 */
import { existsSync, readdirSync, rmSync } from 'node:fs'

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

export default async (ctx) => {
  await ctx.waitFor(`!!window.__sunaDev`, { timeoutMs: 20000, desc: 'window.__sunaDev (dev build)' })
  const rootDir = await ctx.evalJs(`window.__sunaDev.projectStore.getState().rootDir`)
  assert(rootDir, 'no project open — boot with: node scripts/e2e/drive.mjs --boot --example')

  const dataDir = `${rootDir}/data`
  const figuresDir = `${rootDir}/figures`
  const spectrumDir = `${figuresDir}/fig-spectrum`
  const atRoot = `${rootDir}/dnd-probe.md`
  const inData = `${dataDir}/dnd-probe.md`
  assert(existsSync(dataDir), `no ${dataDir} — this probe expects the example project`)
  assert(existsSync(spectrumDir), `no ${spectrumDir} — this probe expects the example project`)
  // A leftover from an aborted run would make "the file moved" pass vacuously.
  assert(!existsSync(atRoot) && !existsSync(inData), 'dnd-probe.md is left over — remove it and re-run')

  const json = (value) => JSON.stringify(value)

  /**
   * One synthetic drag, up to and including the hover: dragstart on the source
   * row, then dragenter/dragover on the target. The DataTransfer is a REAL one
   * (the technique the canvas SVG-import smoke step uses), so the handlers'
   * setData/getData go through the platform object and the payload read back
   * here is the payload a real drag would carry.
   *
   * The transfer is stashed on `window` rather than returned: every
   * Runtime.evaluate has its own scope, and the drop must carry the SAME
   * DataTransfer the dragstart filled. `finishDrag` removes the stash.
   *
   * `overPath === null` targets the tree container itself, below the last row
   * — the plan's project-root drop.
   */
  const hover = (fromPath, overPath) =>
    ctx.evalJs(`(() => {
      const rows = [...document.querySelectorAll('.tree__row')];
      const row = (p) => rows.find((r) => r.dataset.path === p) ?? null;
      const src = row(${json(fromPath)});
      if (src === null) throw new Error('no tree row for ' + ${json(fromPath)});
      const target = ${overPath === null ? `document.querySelector('.tree')` : `row(${json(overPath)})`};
      if (target === null) throw new Error('no drop target for ' + ${json(overPath ?? '(tree empty area)')});
      if (!src.draggable) throw new Error('.tree__row is not draggable — the §6 selector contract');
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
      window.__sunaDndProbe = { src, target, dt, at };
      return {
        paths: dt.getData('application/x-suna-paths'),
        text: dt.getData('text/plain'),
        effectAllowed: dt.effectAllowed,
        dropEffect: dt.dropEffect,
        rowHighlights: [...document.querySelectorAll('.tree__row--droptarget')].map((r) => r.dataset.path),
        rootHighlighted: !!document.querySelector('.tree--droptarget')
      };
    })()`)

  /** Drop on whatever `hover` last targeted, then end the drag. */
  const finishDrag = () =>
    ctx.evalJs(`(() => {
      const probe = window.__sunaDndProbe;
      if (!probe) throw new Error('drop without a drag in flight');
      const opts = { bubbles: true, cancelable: true, dataTransfer: probe.dt, ...probe.at };
      probe.target.dispatchEvent(new DragEvent('drop', opts));
      probe.src.dispatchEvent(new DragEvent('dragend', opts));
      delete window.__sunaDndProbe;
      return true;
    })()`)

  const rowExists = (path) =>
    ctx.evalJs(
      `[...document.querySelectorAll('.tree__row')].some((r) => r.dataset.path === ${json(path)})`
    )
  const panelIds = () => ctx.evalJs(`Object.keys(window.__sunaDev.dock.panelComponents())`)
  const noHighlights = () =>
    ctx.evalJs(
      `document.querySelectorAll('.tree__row--droptarget').length === 0 && !document.querySelector('.tree--droptarget')`
    )

  let hoverOnFolder = null
  let hoverOnRoot = null
  let hoverRefused = null
  try {
    // ---- setup: a real file, a real tab, the folders open -----------------
    await ctx.evalJs(
      `window.suna.invoke('fs:create-file', { path: ${json(atRoot)}, content: '# drag-and-drop probe\\n' })`
    )
    // Fire the refresh, do NOT await its promise: the store drops the
    // reference, V8 collects it, and CDP's awaitPromise then fails with
    // "Promise was collected" (measured). Poll the DOM for the result instead.
    await ctx.evalJs(`(() => { window.__sunaDev.projectStore.getState().refreshTree(); return true })()`)
    await ctx.evalJs(`window.__sunaDev.uiStore.setState({ activeView: 'explorer', sidebarVisible: true })`)
    for (const dir of [dataDir, figuresDir]) {
      await ctx.evalJs(`window.__sunaDev.explorerStore.getState().toggleExpanded(${json(dir)}, true)`)
    }
    await ctx.waitFor(() => rowExists(atRoot), { timeoutMs: 8000, desc: 'the probe file appearing in the tree' })
    await ctx.evalJs(`window.__sunaDev.dock.openFileTab(${json(atRoot)})`)
    await ctx.waitFor(async () => (await panelIds()).includes(atRoot), {
      timeoutMs: 8000,
      desc: 'a tab open on the probe file'
    })

    // ---- 1. file row → folder row ----------------------------------------
    hoverOnFolder = await hover(atRoot, dataDir)
    assert(
      hoverOnFolder.paths === JSON.stringify([atRoot]),
      `application/x-suna-paths carried ${hoverOnFolder.paths || '(nothing)'}`
    )
    assert(hoverOnFolder.text === atRoot, `the text/plain fallback carried '${hoverOnFolder.text}'`)
    // effectAllowed/dropEffect are deliberately NOT asserted: Chromium ignores
    // both setters on a synthetic `new DataTransfer()` (measured — they read
    // back 'none' even after assignment), while setData works. The app does set
    // effectAllowed = 'move' for real drags; what a synthetic drag CAN observe
    // is the payload and the highlight, which is what this probe measures.
    assert(
      hoverOnFolder.rowHighlights.length === 1 && hoverOnFolder.rowHighlights[0] === dataDir,
      `hovering data/ highlighted ${json(hoverOnFolder.rowHighlights)}`
    )
    await finishDrag()
    await ctx.waitFor(() => existsSync(inData) && !existsSync(atRoot), {
      timeoutMs: 8000,
      desc: 'the file moving to data/ on disk'
    })
    await ctx.waitFor(() => rowExists(inData), { timeoutMs: 8000, desc: 'the row rendering under data/' })
    assert(!(await rowExists(atRoot)), 'the row is still listed at the project root after the move')
    // Measurement 5's bug: a moved file must not leave its tab on a dead path.
    await ctx.waitFor(async () => (await panelIds()).includes(inData), {
      timeoutMs: 8000,
      desc: 'the open tab retargeting to data/dnd-probe.md'
    })
    assert(!(await panelIds()).includes(atRoot), 'a panel is still open on the pre-move path')
    assert(await noHighlights(), 'a drop target is still highlighted after the drop')

    // ---- 2. back out to the project root ----------------------------------
    hoverOnRoot = await hover(inData, null)
    assert(hoverOnRoot.rootHighlighted, '.tree--droptarget is missing on a hover over the empty area')
    assert(
      hoverOnRoot.rowHighlights.length === 0,
      `a root drop also highlighted rows: ${json(hoverOnRoot.rowHighlights)}`
    )
    await finishDrag()
    await ctx.waitFor(() => existsSync(atRoot) && !existsSync(inData), {
      timeoutMs: 8000,
      desc: 'the file moving back to the project root'
    })
    await ctx.waitFor(() => rowExists(atRoot), { timeoutMs: 8000, desc: 'the row rendering at the root again' })
    await ctx.waitFor(async () => (await panelIds()).includes(atRoot), {
      timeoutMs: 8000,
      desc: 'the tab retargeting back to the root path'
    })

    // ---- 3. refused: a folder onto its own child ---------------------------
    hoverRefused = await hover(figuresDir, spectrumDir)
    assert(
      hoverRefused.rowHighlights.length === 0 && !hoverRefused.rootHighlighted,
      `figures/ onto its own child painted a target: ${json(hoverRefused.rowHighlights)}`
    )
    await finishDrag()
    await ctx.sleep(800)
    assert(existsSync(spectrumDir), `${spectrumDir} disappeared — the refused drop moved something`)
    assert(
      !existsSync(`${spectrumDir}/figures`),
      'figures/ was moved into its own child — the descendant guard did not hold'
    )
    assert(
      readdirSync(rootDir).includes('figures'),
      'figures/ is no longer at the project root after the refused drop'
    )
  } finally {
    // Leave the drive copy exactly as found: no probe file, no probe tab, no
    // stash on window (a failed assertion can leave a drag "in flight").
    for (const path of [atRoot, inData]) {
      await ctx.evalJs(`window.__sunaDev.dock.closePanel(${json(path)})`).catch(() => undefined)
      rmSync(path, { force: true })
    }
    await ctx.evalJs(`(() => { delete window.__sunaDndProbe; window.__sunaDev.projectStore.getState().refreshTree(); return true })()`)
  }

  return { hoverOnFolder, hoverOnRoot, hoverRefused }
}
