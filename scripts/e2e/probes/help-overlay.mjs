/**
 * Drive probe — the '?' keyboard-shortcut overlay (feature-plan-8 §1, the
 * §7 assertions the smoke step does not carry):
 *
 *   1. '?' from a non-typing target opens the overlay, focus moves into the
 *      dialog, Esc closes it and restores focus to the opener;
 *   2. '?' typed into a CodeMirror editor (contenteditable — the isTyping
 *      guard's case) does NOT open it, and the character really inserts;
 *   3. with a canvas tab active the overlay opens on the canvas section,
 *      and the section tabs switch it.
 *
 * Run:  node scripts/e2e/drive.mjs --boot --example
 *       node scripts/e2e/drive.mjs scripts/e2e/probes/help-overlay.mjs
 */
import { existsSync } from 'node:fs'

const SECTION_IDS = ['global', 'editor', 'manuscript', 'canvas', 'explorer', 'viewers']

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

export default async (ctx) => {
  await ctx.waitFor(`!!window.__sunaDev`, { timeoutMs: 20000, desc: 'window.__sunaDev (dev build)' })
  const rootDir = await ctx.evalJs(`window.__sunaDev.projectStore.getState().rootDir`)
  assert(rootDir, 'no project open — boot with: node scripts/e2e/drive.mjs --boot --example')

  /** The overlay's observable state, or null when closed (§7 selectors). */
  const overlay = () =>
    ctx.evalJs(`(() => {
      const root = document.querySelector('.help-overlay');
      if (!root) return null;
      return {
        section: root.dataset.helpSection ?? null,
        tabs: [...root.querySelectorAll('.help-overlay__tab')].map((t) => t.textContent.trim()),
        focusInside: root.contains(document.activeElement)
      };
    })()`)

  // ---- 1. open from a non-typing target; Esc closes and restores focus ----
  assert((await overlay()) === null, 'the overlay is already open — close it and re-run')
  await ctx.evalJs(`(() => {
    const btn = document.querySelector('.activitybar__item');
    if (!btn) throw new Error('no activity-bar button to park focus on');
    btn.focus();
    return true;
  })()`)
  await ctx.key('?', 'Slash', 8) // CDP modifiers: 1=Alt 2=Ctrl 4=Meta 8=Shift
  await ctx.waitFor(`!!document.querySelector('.help-overlay')`, {
    timeoutMs: 4000,
    desc: `'?' opening the overlay`
  })
  const opened = await overlay()
  assert(SECTION_IDS.includes(opened.section), `data-help-section '${opened.section}' is not a section id`)
  assert(
    opened.tabs.length === SECTION_IDS.length,
    `${opened.tabs.length} tabs for ${SECTION_IDS.length} sections: ${opened.tabs.join(' | ')}`
  )
  assert(opened.focusInside, 'focus did not move into the dialog on open')
  await ctx.key('Escape', 'Escape')
  await ctx.sleep(300)
  assert((await overlay()) === null, 'Esc did not close the overlay')
  assert(
    await ctx.evalJs(`document.activeElement === document.querySelector('.activitybar__item')`),
    'closing did not restore focus to the element that had it before open'
  )

  // ---- 2. '?' while typing in an editor: guard holds, character inserts ---
  await ctx.evalJs(
    `window.__sunaDev.dock.openFileTab(${JSON.stringify(`${rootDir}/manuscript/manuscript.md`)})`
  )
  const visibleContent = `(() => {
    const host = [...document.querySelectorAll('.editor-tab')].find((h) => h.getBoundingClientRect().width > 0);
    return host ? host.querySelector('.cm-content') : null;
  })()`
  await ctx.waitFor(`!!${visibleContent}`, { timeoutMs: 15000, desc: 'a visible editor tab' })
  // Count '?' occurrences rather than diff the full text: focusing reveals
  // the cursor line's markdown syntax, which legitimately changes
  // textContent — but never by adding a '?'.
  const marksBefore = await ctx.evalJs(`(() => {
    const content = ${visibleContent};
    content.focus();
    return content.textContent.split('?').length - 1;
  })()`)
  // keyDown WITH text: Chromium routes the char into the focused editor
  // while the same keydown reaches the overlay's window listener — exactly
  // the event the isTyping guard must swallow. ctx.key sends no text.
  await ctx.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '?', code: 'Slash', modifiers: 8, text: '?' })
  await ctx.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '?', code: 'Slash', modifiers: 8 })
  await ctx.sleep(400)
  assert((await overlay()) === null, `typing '?' into the editor opened the overlay — the isTyping guard is broken`)
  const marksAfter = await ctx.evalJs(`(${visibleContent}).textContent.split('?').length - 1`)
  assert(marksAfter === marksBefore + 1, `the '?' did not insert (before ${marksBefore}, after ${marksAfter})`)
  await ctx.key('z', 'KeyZ', 4) // ⌘Z — leave the drive copy's buffer as found
  await ctx.sleep(300)
  assert(
    (await ctx.evalJs(`(${visibleContent}).textContent.split('?').length - 1`)) === marksBefore,
    'undo did not remove the probe character'
  )

  // ---- 3. canvas tab active → opens on the canvas section -----------------
  const figure = `${rootDir}/figures/fig-spectrum/figure.svg`
  assert(existsSync(figure), `no ${figure} — this probe expects the example project`)
  await ctx.evalJs(`window.__sunaDev.dock.openFileTab(${JSON.stringify(figure)})`)
  await ctx.waitFor(`!!document.querySelector('.canvas-world svg')`, {
    timeoutMs: 15000,
    desc: 'figure mounted on canvas'
  })
  // The overlay reads dockApi.activePanel, which activates a beat AFTER the
  // canvas mounts — wait for the signal the overlay actually consumes.
  await ctx.waitFor(
    `window.__sunaDev.dock.activePanelPath() === ${JSON.stringify(figure)}`,
    { timeoutMs: 5000, desc: 'figure panel becoming the active panel' }
  )
  await ctx.evalJs(`(() => {
    const el = document.activeElement;
    if (el && el !== document.body) el.blur();
    return true;
  })()`)
  await ctx.key('?', 'Slash', 8)
  await ctx.waitFor(`!!document.querySelector('.help-overlay')`, {
    timeoutMs: 4000,
    desc: `'?' opening over the canvas`
  })
  const onCanvas = await overlay()
  assert(onCanvas.section === 'canvas', `an active canvas tab must open the canvas section, got '${onCanvas.section}'`)
  await ctx.evalJs(`(() => {
    const tab = [...document.querySelectorAll('.help-overlay__tab')].find((t) => /global/i.test(t.textContent));
    if (!tab) throw new Error('no Global tab');
    tab.click();
  })()`)
  await ctx.sleep(200)
  assert((await overlay()).section === 'global', 'clicking the Global tab did not switch the section')
  await ctx.key('Escape', 'Escape')
  await ctx.sleep(300)
  assert((await overlay()) === null, 'Esc did not close the overlay (canvas pass)')

  return { initialSection: opened.section, tabs: opened.tabs, canvasSection: onCanvas.section }
}
