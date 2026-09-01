/**
 * Drive probe — the '?' keyboard-shortcut overlay (DECISIONS 2026-08-17, the
 * §7 assertions the smoke step does not carry):
 *
 *   1. '?' from a non-typing target opens the overlay, focus moves into the
 *      dialog, Esc closes it and restores focus to the opener;
 *   2. '?' typed into a CodeMirror editor (contenteditable — the isTyping
 *      guard's case) does NOT open it, and the character really inserts;
 *   3. with a canvas tab active the overlay opens on the canvas section,
 *      and the section tabs switch it;
 *   4. with vim motions ON and the buffer in NORMAL mode (DECISIONS 2026-08-17):
 *      `:help` is the ONLY door — a bare '?' drives vim's own
 *      search-backward panel instead (measurement 1), and ⌘⇧/ does nothing
 *      at all, since that chord was removed in favour of exactly two ways
 *      in. Vim is always turned back off, failure or not.
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
  // Re-confirm AFTER the blur, not before: blurring an element inside the
  // previously focused tab can hand activation back to that tab, and the
  // overlay reads the active panel at the instant the key lands.
  // Wait on exactly what the overlay reads — the active panel's COMPONENT.
  // activePanelPath answers null for every panel without a file path, so a
  // path check cannot distinguish "canvas is active" from "some other
  // non-file tab took activation back" (the combined manuscript tab, which
  // opening the example leaves open, is the one that does).
  await ctx.waitFor(`window.__sunaDev.dock.activePanelComponent() === 'canvas'`, {
    timeoutMs: 5000,
    desc: 'the canvas tab being the active surface at keypress time'
  })
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

  // ---- 4. vim NORMAL mode: :help is the only door in --------------------
  const manuscriptMd = `${rootDir}/manuscript/manuscript.md`
  const vimPanel = () =>
    ctx.evalJs(`(() => {
      const panel = document.querySelector('.cm-vim-panel');
      return panel ? panel.textContent : null;
    })()`)
  const focusBuffer = () =>
    ctx.evalJs(`(() => {
      const content = ${visibleContent};
      if (!content) throw new Error('no visible editor to focus');
      content.focus();
      return true;
    })()`)

  let vimMode = null
  let byChord = null
  let byExCommand = null
  let byQuestionMark = null
  await ctx.evalJs(`window.__sunaDev.settingsStore.getState().setGlobal('editor.vimMotions', true)`)
  try {
    await ctx.evalJs(`window.__sunaDev.dock.openFileTab(${JSON.stringify(manuscriptMd)})`)
    await ctx.waitFor(`!!${visibleContent}`, { timeoutMs: 15000, desc: 'the manuscript editor tab' })
    // Frontmost, not merely mounted: `visibleContent` takes the first editor
    // with a non-zero box, and section 3 left a canvas tab in the dock.
    await ctx.waitFor(
      `window.__sunaDev.dock.activePanelPath() === ${JSON.stringify(manuscriptMd)}`,
      { timeoutMs: 5000, desc: 'the manuscript tab becoming the active panel' }
    )
    await focusBuffer()
    // The status bar's mode chip is the only signal that the keymap is really
    // installed on THIS editor — the setting alone says nothing about which
    // view adopted it.
    vimMode = await ctx.waitFor(
      `(() => { const chip = document.querySelector('.statusbar__vim'); return chip ? chip.textContent.trim() : null; })()`,
      { timeoutMs: 8000, desc: 'the status bar vim mode chip' }
    )
    assert(vimMode === 'normal', `the buffer is in '${vimMode}' mode, not normal`)
    // Nothing below may reach the document: a leaked keystroke in normal mode
    // is a silent edit to the drive copy's manuscript. `peek` answers null
    // until the shared session has finished reading the file.
    const bufferBefore = await ctx.waitFor(
      `window.__sunaDev.docSessions.peek(${JSON.stringify(manuscriptMd)})`,
      { timeoutMs: 8000, desc: 'the shared session for the manuscript buffer' }
    )

    // (a) ⌘⇧/ is NOT a binding: help has exactly two doors, '?' outside a
    // buffer and ':help' inside one. The chord must therefore do nothing at
    // all here — no overlay, and nothing typed into the document.
    await ctx.key('?', 'Slash', 12) // CDP modifiers: 4 = Meta, 8 = Shift
    await ctx.sleep(500)
    byChord = await overlay()
    assert(byChord === null, '⌘⇧/ opened the overlay — that chord was removed')

    // (b) `:help` — the vim-native path through the ex registry.
    await focusBuffer()
    await ctx.key(':', 'Semicolon', 8)
    await ctx.waitFor(`!!document.querySelector('.cm-vim-panel input')`, {
      timeoutMs: 4000,
      desc: `vim's ':' command line`
    })
    await ctx.insertText('help')
    const typed = await ctx.evalJs(`document.querySelector('.cm-vim-panel input').value`)
    assert(typed === 'help', `the ':' command line reads '${typed}' after typing help`)
    // windowsVirtualKeyCode is NOT optional here: the vim command line's own
    // keydown listener tests `e.keyCode == 13`, and CDP leaves keyCode at 0
    // unless the virtual key code is passed, so a plain Enter would be
    // swallowed and `:help` would never run.
    for (const type of ['keyDown', 'keyUp']) {
      await ctx.send('Input.dispatchKeyEvent', {
        type,
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13
      })
    }
    await ctx.waitFor(`!!document.querySelector('.help-overlay')`, {
      timeoutMs: 4000,
      desc: `':help' opening the overlay`
    })
    byExCommand = await overlay()
    await ctx.key('Escape', 'Escape')
    await ctx.sleep(300)
    assert((await overlay()) === null, `Esc did not close the overlay opened by ':help'`)
    assert((await vimPanel()) === null, `the ':' command line is still open after :help ran`)

    // (c) a bare '?' — vim's search-backward, never the overlay. Sent WITHOUT
    // text: in normal mode the keymap consumes the keydown, so a text-carrying
    // event only matters if the keymap breaks, and then it would write into
    // the manuscript rather than fail an assertion.
    await focusBuffer()
    await ctx.key('?', 'Slash', 8)
    await ctx.sleep(400)
    assert((await overlay()) === null, `a bare '?' in a vim buffer opened the overlay`)
    byQuestionMark = await vimPanel()
    assert(
      byQuestionMark !== null && byQuestionMark.includes('?'),
      `'?' did not open vim's search panel: ${JSON.stringify(byQuestionMark)}`
    )
    await ctx.key('Escape', 'Escape')
    await ctx.sleep(300)
    assert((await vimPanel()) === null, `Esc did not close vim's search panel`)

    const bufferAfter = await ctx.evalJs(
      `window.__sunaDev.docSessions.peek(${JSON.stringify(manuscriptMd)})`
    )
    assert(bufferAfter === bufferBefore, 'the vim pass changed the manuscript buffer')
  } finally {
    // Vim off whatever happened above: the drive app stays booted between
    // probe runs, and leaving it on would change every later probe's keyboard.
    await ctx.evalJs(`window.__sunaDev.settingsStore.getState().setGlobal('editor.vimMotions', false)`)
  }

  return {
    initialSection: opened.section,
    tabs: opened.tabs,
    canvasSection: onCanvas.section,
    vim: {
      mode: vimMode,
      chordOpensNothing: byChord === null,
      exSection: byExCommand?.section ?? null,
      searchPanel: byQuestionMark
    }
  }
}
