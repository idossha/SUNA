/**
 * Drive probe — the directed-AI surfaces (DECISIONS 2026-08-17, the §7
 * contract):
 *
 *   1. a section comment's card carries the ✦ AI button (.cmt__btn--ai) —
 *      enabled when the resolved CLI is Claude Code, otherwise disabled
 *      with an honest title (codex runs read-only here);
 *   2. the canvas properties rail renders the Agent section (.canvas-agent)
 *      with the selection readout and a Send that stays disabled while the
 *      prompt is empty;
 *   3. 'app:capture-rect' writes a real PNG whose IHDR size matches the
 *      requested rect within the device-pixel-ratio factor.
 *
 * The probe adds its own comment through the real store and removes it
 * again, so it neither depends on nor pollutes the copy's comment history.
 *
 * Run:  node scripts/e2e/drive.mjs --boot --example
 *       node scripts/e2e/drive.mjs scripts/e2e/probes/ai-surfaces.mjs
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

export default async (ctx) => {
  await ctx.waitFor(`!!window.__sunaDev`, { timeoutMs: 20000, desc: 'window.__sunaDev (dev build)' })
  const rootDir = await ctx.evalJs(`window.__sunaDev.projectStore.getState().rootDir`)
  assert(rootDir, 'no project open — boot with: node scripts/e2e/drive.mjs --boot --example')

  // ---- 1. comment card: the ✦ AI button ----------------------------------
  const manuscriptPath = `${rootDir}/manuscript/manuscript.md`
  assert(existsSync(manuscriptPath), `no manuscript at ${manuscriptPath}`)
  const text = readFileSync(manuscriptPath, 'utf8')
  // Anchor on real prose so the highlight resolves: first long non-heading line.
  const line = text.split('\n').find((l) => !l.startsWith('#') && l.trim().length >= 48)
  assert(line !== undefined, 'no prose line long enough to anchor the probe comment')
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

  // Open-or-focus the combined tab through the dock seam — the activity-bar
  // click TOGGLES when the manuscript view is already active, and a hidden
  // manuscript panel renders no body, so the click route is not idempotent
  // for a driver.
  await ctx.evalJs(`window.__sunaDev.dock.openManuscriptTab(${JSON.stringify(rootDir)})`)
  await ctx.waitFor(`!!document.querySelector('.msdoc__titlepage')`, {
    timeoutMs: 20000,
    desc: 'combined manuscript tab'
  })
  await ctx.evalJs(`window.__sunaDev.uiStore.getState().setCommentsRailVisible(true)`)

  const created = await ctx.evalJs(
    `window.__sunaDev.commentsStore.getState().add(${JSON.stringify(target)}, ` +
      `'Drive probe — checking the AI button (the probe removes this comment).')`
  )
  assert(
    created !== null && typeof created.id === 'string',
    `commentsStore.add refused the probe comment: ${JSON.stringify(created)}`
  )
  let button = null
  let cli = null
  try {
    await ctx.evalJs(`window.__sunaDev.commentsStore.getState().setActive(${JSON.stringify(created.id)})`)
    const buttonSel = `.cmt-rail .cmt-card[data-comment-id="${created.id}"] .cmt__btn--ai`
    // The button starts disabled behind the rail's one 'lit:cli-status'
    // round trip ("Checking for an AI CLI…") — poll past that pending state.
    for (let i = 0; i < 20; i++) {
      button = await ctx.evalJs(`(() => {
        const btn = document.querySelector(${JSON.stringify(buttonSel)});
        return btn ? { disabled: btn.disabled, title: btn.title, text: btn.textContent.trim() } : null;
      })()`)
      if (button !== null && !/checking/i.test(button.title)) break
      await ctx.sleep(300)
    }
    assert(button !== null, 'the probe comment card renders no ✦ AI button')
    assert(button.text === '✦ AI', `AI button text: '${button.text}'`)

    // Expected enabled/disabled mirrors gateFromStatus: 'auto' tries claude
    // then codex; an explicit preference never falls back; claude-only edits.
    cli = await ctx.evalJs(`window.suna.invoke('lit:cli-status', {})`)
    const pref = await ctx.evalJs(`window.__sunaDev.settingsStore.getState().settings['lit.cli']`)
    const order = pref === 'auto' ? ['claude', 'codex'] : [pref]
    const resolved = order.find((id) => (cli.available ?? []).includes(id)) ?? null
    if (resolved === 'claude') {
      assert(!button.disabled, `Claude Code resolves but the AI button is disabled: '${button.title}'`)
    } else {
      assert(
        button.disabled && button.title.length > 0,
        `without Claude Code the button must disable with an honest title, got ${JSON.stringify(button)}`
      )
    }
  } finally {
    await ctx.evalJs(`window.__sunaDev.commentsStore.getState().remove(${JSON.stringify(created.id)})`)
  }

  // ---- 2. canvas Agent section --------------------------------------------
  const figure = `${rootDir}/figures/fig-spectrum/figure.svg`
  assert(existsSync(figure), `no ${figure} — this probe expects the example project`)
  await ctx.evalJs(`window.__sunaDev.dock.openFileTab(${JSON.stringify(figure)})`)
  await ctx.waitFor(`!!document.querySelector('.canvas-world svg')`, {
    timeoutMs: 15000,
    desc: 'figure mounted on canvas'
  })
  await ctx.waitFor(`!!document.querySelector('.canvas-agent')`, {
    timeoutMs: 8000,
    desc: 'the Agent section in the properties rail'
  })
  const agent = await ctx.evalJs(`(() => {
    const root = document.querySelector('.canvas-agent');
    const send = root.querySelector('.canvas-agent__send');
    const prompt = root.querySelector('.canvas-agent__prompt');
    return {
      readout: root.textContent,
      hasSend: !!send,
      sendDisabled: send ? send.disabled : null,
      hasPrompt: !!prompt,
      promptEmpty: prompt ? prompt.value === '' : null
    };
  })()`)
  assert(agent.hasPrompt, 'the Agent section has no prompt textarea (.canvas-agent__prompt)')
  assert(agent.hasSend, 'the Agent section has no Send button (.canvas-agent__send)')
  assert(
    /Whole figure|Selection:/.test(agent.readout),
    `no selection readout in the Agent section: ${agent.readout.slice(0, 120)}`
  )
  if (agent.promptEmpty) {
    assert(agent.sendDisabled === true, 'Send must stay disabled while the prompt is empty')
  }

  // ---- 3. capture-rect round trip ------------------------------------------
  const rect = { x: 40, y: 40, width: 320, height: 200 }
  const res = await ctx.evalJs(`window.suna.invoke('app:capture-rect', { rect: ${JSON.stringify(rect)} })`)
  assert(res && typeof res.path === 'string', `capture-rect response: ${JSON.stringify(res)}`)
  assert(existsSync(res.path), `no PNG on disk at ${res.path}`)
  const png = readFileSync(res.path)
  // Standalone IHDR decode — probes import nothing from the smoke suite.
  assert(png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', `${res.path} is not a PNG`)
  assert(png.subarray(12, 16).toString('ascii') === 'IHDR', `${res.path} has no IHDR chunk`)
  const ihdr = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
  assert(
    ihdr.width === res.width && ihdr.height === res.height,
    `response says ${res.width}×${res.height}, the file's IHDR says ${ihdr.width}×${ihdr.height}`
  )
  // The PNG is rect × devicePixelRatio. ±10% + rounding: on a non-integral
  // display scale Chromium folds the remainder into a page zoom (see
  // cdp.mjs's pinViewport), so the DIP mapping is not exactly ×dpr.
  const dpr = await ctx.evalJs(`window.devicePixelRatio`)
  const near = (got, want) => Math.abs(got - want) <= Math.max(4, want * 0.1)
  assert(
    near(ihdr.width, rect.width * dpr) && near(ihdr.height, rect.height * dpr),
    `IHDR ${ihdr.width}×${ihdr.height} vs ${rect.width}×${rect.height} requested @ dpr ${dpr}`
  )
  rmSync(res.path, { force: true })

  return {
    aiButton: button,
    cliAvailable: cli?.available ?? [],
    agentReadout: agent.readout.slice(0, 80),
    capture: { requested: rect, ihdr, dpr }
  }
}
