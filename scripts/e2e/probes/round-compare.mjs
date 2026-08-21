/**
 * Drive probe — the round workspace's two-pane compare view (§C).
 *
 * The claims a unit test cannot make, because they are about the DOM the two
 * panes render:
 *
 *   1. one pane by default, two after the Compare toggle, and never three —
 *      pressing the toggle again returns to one;
 *   2. each pane holds its own selection: focusing a point in pane B leaves
 *      pane A on the point it was already showing;
 *   3. the pane headers appear only while split, and mark exactly one pane
 *      active — the one an outline click would land in;
 *   4. pane B's × closes the split from inside the pane;
 *   5. the palette command toggles the same thing the button does.
 *
 * Run:  node scripts/e2e/drive.mjs --boot --example
 *       node scripts/e2e/drive.mjs run scripts/e2e/probes/round-compare.mjs
 */
function assert(cond, message) {
  if (!cond) throw new Error(message)
}

export default async (ctx) => {
  await ctx.waitFor(`!!window.__sunaDev`, { timeoutMs: 20000, desc: 'window.__sunaDev (dev build)' })
  const rootDir = await ctx.evalJs(`window.__sunaDev.projectStore.getState().rootDir`)
  assert(rootDir, 'no project open — boot with: node scripts/e2e/drive.mjs --boot --example')

  const { rounds } = await ctx.evalJs(
    `window.suna.invoke('round:list', { dir: ${JSON.stringify(rootDir)} })`
  )
  let roundId = null
  let reports = []
  for (const candidate of rounds) {
    const read = await ctx.evalJs(
      `window.suna.invoke('round:read', { dir: ${JSON.stringify(rootDir)}, roundId: ${JSON.stringify(candidate.id)} })`
    )
    if (read.reports.some((r) => r.points.length > 0)) {
      roundId = candidate.id
      reports = read.reports
      break
    }
  }
  assert(roundId !== null, 'no round in this project has imported reviewer points')
  const points = reports.flatMap((r) => r.points)
  assert(points.length >= 2, 'need at least two points to compare')

  const R = JSON.stringify(roundId)
  await ctx.evalJs(
    `window.__sunaDev.dock.openRoundTab(${JSON.stringify(rootDir)}, ${R})`
  )
  await ctx.evalJs(`window.__sunaDev.roundFocusStore.getState().setSplit(false)`)
  await ctx.waitFor(`document.querySelectorAll('.round__pane').length === 1`, {
    timeoutMs: 20000,
    desc: 'the round workspace, one pane'
  })

  // ---- 1. the toggle ------------------------------------------------------
  assert(
    (await ctx.evalJs(`document.querySelectorAll('.round__pane-head').length`)) === 0,
    'a pane header showed with only one pane on screen'
  )

  const toggle = `[...document.querySelectorAll('.round__mode')].find((b) => b.textContent.includes('Compare'))`
  assert(await ctx.evalJs(`!!${toggle}`), 'no Compare toggle in the round header')
  await ctx.evalJs(`${toggle}.click()`)
  await ctx.waitFor(`document.querySelectorAll('.round__pane').length === 2`, {
    timeoutMs: 10000,
    desc: 'two panes after Compare'
  })
  assert(
    (await ctx.evalJs(`${toggle}.getAttribute('aria-pressed')`)) === 'true',
    'the Compare toggle does not report itself pressed'
  )

  await ctx.evalJs(`${toggle}.click()`)
  await ctx.waitFor(`document.querySelectorAll('.round__pane').length === 1`, {
    timeoutMs: 10000,
    desc: 'back to one pane'
  })

  // ---- 2. independent selections -----------------------------------------
  const [p1, p2] = points
  await ctx.evalJs(
    `window.__sunaDev.roundFocusStore.getState().focus(${R}, ${JSON.stringify(p1.id)}, 'a')`
  )
  await ctx.evalJs(`window.__sunaDev.roundFocusStore.getState().setSplit(true)`)
  await ctx.evalJs(`window.__sunaDev.roundFocusStore.getState().setMode('focus')`)
  await ctx.evalJs(
    `window.__sunaDev.roundFocusStore.getState().focus(${R}, ${JSON.stringify(p2.id)}, 'b')`
  )
  await ctx.waitFor(`document.querySelectorAll('.round__pane').length === 2`, {
    timeoutMs: 10000,
    desc: 'two panes in focus mode'
  })

  const paneCards = await ctx.evalJs(
    `[...document.querySelectorAll('.round__pane')].map((p) => [...p.querySelectorAll('[data-point]')].map((c) => c.dataset.point))`
  )
  assert(
    paneCards.length === 2 && paneCards[0].length === 1 && paneCards[1].length === 1,
    `focus mode should show one card per pane, got ${JSON.stringify(paneCards)}`
  )
  assert(
    paneCards[0][0] === p1.id && paneCards[1][0] === p2.id,
    `panes did not hold their own points: ${JSON.stringify(paneCards)}`
  )

  // ---- 3. exactly one active pane ----------------------------------------
  const heads = await ctx.evalJs(
    `[...document.querySelectorAll('.round__pane-head .round__pane-tag')].map((t) => t.textContent)`
  )
  assert(
    JSON.stringify(heads) === JSON.stringify(['A', 'B']),
    `pane headers should read A then B, got ${JSON.stringify(heads)}`
  )
  const active = await ctx.evalJs(`document.querySelectorAll('.round__pane.is-active').length`)
  assert(active === 1, `exactly one pane should be active while split, got ${active}`)

  // The outline marks both, and tells them apart.
  const outlinePanes = await ctx.evalJs(
    `[...document.querySelectorAll('.rvout__pt-pane')].map((s) => s.textContent).sort().join('')`
  )
  assert(
    outlinePanes === '' || outlinePanes === 'AB',
    `outline pane badges should be A and B (or absent if the outline is not mounted), got ${JSON.stringify(outlinePanes)}`
  )

  // ---- 4. pane B closes itself -------------------------------------------
  await ctx.evalJs(`document.querySelector('.round__pane-close').click()`)
  await ctx.waitFor(`document.querySelectorAll('.round__pane').length === 1`, {
    timeoutMs: 10000,
    desc: "one pane after pane B's ×"
  })

  // ---- 5. the palette command --------------------------------------------
  const ran = await ctx.evalJs(`window.__sunaDev.commands.runCommand('review.compare.toggle')`)
  assert(ran !== false, 'review.compare.toggle refused to run on a round tab')
  await ctx.waitFor(`document.querySelectorAll('.round__pane').length === 2`, {
    timeoutMs: 10000,
    desc: 'two panes after the command'
  })
  await ctx.evalJs(`window.__sunaDev.commands.runCommand('review.compare.toggle')`)
  await ctx.waitFor(`document.querySelectorAll('.round__pane').length === 1`, {
    timeoutMs: 10000,
    desc: 'one pane after the command again'
  })

  console.log('round-compare: all claims hold')
}
