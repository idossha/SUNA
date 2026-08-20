/**
 * Drive probe — the AI assistant beside a reviewer reply box (§C).
 *
 * The four claims worth checking in the real app, none of which a unit test
 * can make:
 *
 *   1. every point card in a round renders the assistant, in BOTH modes;
 *   2. the primary action reads the box — Draft on an empty reply, Polish on
 *      one that already has text — which is the whole point of one button;
 *   3. the options menu opens with a per-run model and effort control and a
 *      way to reach the non-primary action;
 *   4. the approval gate: with no approval recorded in suna.json the card
 *      offers ONLY "Enable AI replies…" and no Draft/Polish anywhere;
 *   5. an arriving proposal is a PROPOSAL: it renders beside the author's
 *      reply with accept/discard, and does NOT touch the textarea until the
 *      author accepts. This is asserted by pushing a proposal through the
 *      real store rather than spawning a CLI, so the probe stays offline.
 *
 * Run:  node scripts/e2e/drive.mjs --boot --example
 *       node scripts/e2e/drive.mjs scripts/e2e/probes/reply-assistant.mjs
 */
import { readFileSync } from 'node:fs'

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
  assert(rounds.length > 0, 'the example project has no rounds to open')

  // The FIRST round is routinely an internal circulation with no reviewer
  // reports — there is nothing to answer there and no assistant to check.
  // Take the first round that actually has points.
  let roundId = null
  let round = null
  let reports = []
  for (const candidate of rounds) {
    const read = await ctx.evalJs(
      `window.suna.invoke('round:read', { dir: ${JSON.stringify(rootDir)}, roundId: ${JSON.stringify('__ID__')} })`.replace(
        '__ID__',
        candidate.id
      )
    )
    if (read.reports.some((r) => r.points.length > 0)) {
      roundId = candidate.id
      round = read.round
      reports = read.reports
      break
    }
  }
  assert(roundId !== null, `no round in this project has imported reviewer points`)
  const points = reports.flatMap((r) => r.points)

  const answered = round.pointStates.find((s) => s.reply.trim() !== '') ?? null
  const empty = points.find((p) => !round.pointStates.some((s) => s.pointId === p.id && s.reply.trim() !== ''))
  assert(empty !== undefined, 'every point in this round already has a reply — no Draft case to check')

  await ctx.evalJs(
    `window.__sunaDev.dock.openRoundTab(${JSON.stringify(rootDir)}, ${JSON.stringify(roundId)})`
  )

  // ---- 1/2. continuous mode: one assistant per card, primary reads the box -
  await ctx.evalJs(`window.__sunaDev.roundFocusStore.getState().setMode('scroll')`)
  await ctx.waitFor(`document.querySelectorAll('.round__card .reply-ai').length > 0`, {
    timeoutMs: 20000,
    desc: 'reply assistants in continuous mode'
  })

  const cards = await ctx.evalJs(`document.querySelectorAll('.round__card').length`)
  const assistants = await ctx.evalJs(`document.querySelectorAll('.round__card .reply-ai').length`)
  assert(cards === assistants, `${cards} point cards but ${assistants} assistants — every box needs one`)

  const sel = (id) => `.round__card[data-point="${id}"]`
  const primaryOf = (id) =>
    ctx.evalJs(`(() => {
      const b = document.querySelector(${JSON.stringify(`${sel(id)} .reply-ai__go`)});
      return b ? { text: b.textContent.trim(), disabled: b.disabled } : null;
    })()`)

  // The gate first: everything below only makes sense once AI is permitted.
  const manifest = JSON.parse(readFileSync(`${rootDir}/suna.json`, 'utf8'))
  const approved = manifest.approvals?.peerReviewAi != null
  const gateButtons = await ctx.evalJs(
    `[...document.querySelectorAll('.round__card .reply-ai__go')].map((b) => b.textContent.trim())`
  )
  if (!approved) {
    assert(
      gateButtons.every((t) => /Enable AI replies/.test(t)),
      `no approval is recorded but the cards offer: ${JSON.stringify(gateButtons)}`
    )
    assert(
      (await ctx.evalJs(`document.querySelectorAll('.reply-ai__more').length`)) === 0,
      'the model/effort menu is reachable before AI has been approved'
    )
    console.log(
      `reply-assistant OK — ${cards} cards, all gated on approval (no approval in suna.json)`
    )
    return
  }

  const draftBtn = await primaryOf(empty.id)
  assert(draftBtn !== null, `no assistant on the empty point ${empty.id}`)
  assert(/Draft/.test(draftBtn.text), `empty reply offers '${draftBtn.text}', expected Draft`)

  if (answered !== null) {
    const polishBtn = await primaryOf(answered.pointId)
    assert(
      polishBtn !== null && /Polish/.test(polishBtn.text),
      `a written reply offers '${polishBtn && polishBtn.text}', expected Polish`
    )
  }

  // ---- 3. the options menu ------------------------------------------------
  await ctx.evalJs(`document.querySelector(${JSON.stringify(`${sel(empty.id)} .reply-ai__more`)}).click()`)
  await ctx.waitFor(`!!document.querySelector('.reply-ai__menu')`, {
    timeoutMs: 5000,
    desc: 'the AI options menu'
  })
  const menu = await ctx.evalJs(`(() => {
    const m = document.querySelector('.reply-ai__menu');
    return {
      selects: m.querySelectorAll('select').length,
      alt: m.querySelector('button') ? m.querySelector('button').textContent.trim() : null,
      models: [...m.querySelectorAll('select')[0].options].map((o) => o.value),
      efforts: [...m.querySelectorAll('select')[1].options].map((o) => o.value)
    };
  })()`)
  assert(menu.selects === 2, `menu has ${menu.selects} selects, expected model + effort`)
  assert(menu.models.includes('opus') && menu.models.includes('haiku'), `models: ${menu.models}`)
  assert(menu.efforts.includes('max') && menu.efforts.includes('low'), `efforts: ${menu.efforts}`)
  assert(/Polish/.test(menu.alt), `menu's alternate action is '${menu.alt}', expected Polish`)
  await ctx.evalJs(`document.querySelector(${JSON.stringify(`${sel(empty.id)} .reply-ai__more`)}).click()`)

  // ---- 4. a proposal is a proposal ---------------------------------------
  const PROPOSAL = 'Probe proposal — this text must not reach the box unaccepted.'
  const before = await ctx.evalJs(
    `document.querySelector(${JSON.stringify(`${sel(empty.id)} .round__reply-box`)}).value`
  )
  await ctx.evalJs(
    `window.__sunaDev.aiActionsStore.getState().propose('point:' + ${JSON.stringify(empty.id)}, ${JSON.stringify(PROPOSAL)})`
  )
  await ctx.waitFor(`!!document.querySelector(${JSON.stringify(`${sel(empty.id)} .reply-ai__proposal`)})`, {
    timeoutMs: 5000,
    desc: 'the proposal panel'
  })
  const after = await ctx.evalJs(
    `document.querySelector(${JSON.stringify(`${sel(empty.id)} .round__reply-box`)}).value`
  )
  assert(after === before, 'the proposal wrote itself into the author’s box — it must not')
  const shown = await ctx.evalJs(
    `document.querySelector(${JSON.stringify(`${sel(empty.id)} .reply-ai__proposal-text`)}).textContent`
  )
  assert(shown.includes('must not reach the box'), 'the proposal panel does not show the draft')
  const acts = await ctx.evalJs(
    `[...document.querySelectorAll(${JSON.stringify(`${sel(empty.id)} .reply-ai__proposal-acts button`)})].map((b) => b.textContent.trim())`
  )
  assert(acts.includes('Discard'), `proposal actions: ${acts}`)
  assert(acts.some((a) => /Use this|Replace/.test(a)), `proposal actions: ${acts}`)

  // Leave nothing behind: discard, and confirm the panel goes with it.
  await ctx.evalJs(
    `[...document.querySelectorAll(${JSON.stringify(`${sel(empty.id)} .reply-ai__proposal-acts button`)})].find((b) => b.textContent.trim() === 'Discard').click()`
  )
  await ctx.waitFor(`!document.querySelector(${JSON.stringify(`${sel(empty.id)} .reply-ai__proposal`)})`, {
    timeoutMs: 5000,
    desc: 'the proposal cleared on Discard'
  })

  // ---- focus mode carries the same assistant ------------------------------
  await ctx.evalJs(
    `window.__sunaDev.roundFocusStore.getState().focus(${JSON.stringify(roundId)}, ${JSON.stringify(empty.id)})`
  )
  await ctx.evalJs(`window.__sunaDev.roundFocusStore.getState().setMode('focus')`)
  await ctx.waitFor(`document.querySelectorAll('.round__card .reply-ai__go').length === 1`, {
    timeoutMs: 10000,
    desc: 'exactly one assistant in focus mode'
  })

  console.log(
    `reply-assistant OK — ${cards} cards, model/effort menu, proposal stayed out of the box`
  )
}
