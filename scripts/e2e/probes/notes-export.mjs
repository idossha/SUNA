/**
 * Drive probe — the two research-phase affordances added on this branch, in
 * the running app:
 *
 *   1. A Library row that HAS a PDF can open it. The badge used to be a
 *      label, and selecting the row only opened the paper when the
 *      references.autoOpenPdf preference happened to be on.
 *   2. The reading notes leave as a document — PDF, Word or web page —
 *      from the button next to "Copy as Markdown".
 *
 * Every assertion about the export checks the FILE on disk, not the UI's
 * report of it: the panel says "Wrote reading-notes.pdf" the moment the IPC
 * resolves, which is exactly what a write that produced an empty or absent
 * file would also look like.
 *
 * Needs a project with at least one reference PDF and some reading notes; it
 * says so and stops if that is missing rather than passing vacuously.
 *
 * Run:  node scripts/e2e/drive.mjs --boot --example
 *       node scripts/e2e/drive.mjs scripts/e2e/probes/notes-export.mjs
 */
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const json = (v) => JSON.stringify(v)

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

export default async (ctx) => {
  await ctx.waitFor(`!!window.__sunaDev`, { timeoutMs: 20000, desc: 'window.__sunaDev (dev build)' })
  const rootDir = await ctx.evalJs(`window.__sunaDev.projectStore.getState().rootDir`)
  assert(rootDir, 'no project open — boot with: node scripts/e2e/drive.mjs --boot --example')

  const failures = []
  const check = (name, cond, detail) => {
    if (cond) console.log(`  ✓ ${name}`)
    else {
      console.log(`  ✗ ${name}${detail === undefined ? '' : ` — ${detail}`}`)
      failures.push(name)
    }
  }

  // ------------------------------------------------ 1. open a PDF from Library
  await ctx.evalJs(`(() => {
    const ui = window.__sunaDev.uiStore.getState()
    // setActiveView TOGGLES when the view is already active, so the panel is
    // forced open afterwards rather than assumed.
    ui.setActiveView('references')
    window.__sunaDev.uiStore.getState().setSidebarVisible(true)
  })()`)
  await ctx.sleep(900)
  // A PDF put in references/ while the app was already running is only
  // picked up on the next saveBump, so the scan is forced rather than waited
  // for — this probe is about the badge, not about the watcher.
  await ctx.evalJs(`window.__sunaDev.referencePdfsStore.getState().scan(${json(rootDir)})`)
  await ctx.waitFor(`window.__sunaDev.referencePdfsStore.getState().loaded === true`, {
    timeoutMs: 15000,
    desc: 'the citekey -> PDF scan'
  })
  await ctx.sleep(600)

  const badge = await ctx.evalJs(`(() => {
    const el = document.querySelector('.refs__pdf-badge')
    return el === null ? null : { text: el.textContent, title: el.getAttribute('title'), role: el.getAttribute('role') }
  })()`)
  assert(
    badge !== null,
    'no reference in this project resolves a PDF — put one at references/<citekey>.pdf first'
  )
  check('the PDF badge is a button', badge.role === 'button', `role=${badge.role}`)
  check(
    'its tooltip says what clicking does, and still names how the PDF was found',
    /open/i.test(badge.title) && badge.title.length > 'Open this PDF'.length,
    badge.title
  )

  // The autoOpenPdf preference is deliberately left wherever the project has
  // it: the whole point is that the badge opens the paper regardless.
  const pdfTabsBefore = await ctx.evalJs(
    `Object.values(window.__sunaDev.dock.panelComponents()).filter((c) => c === 'pdf').length`
  )
  await ctx.evalJs(`document.querySelector('.refs__pdf-badge').click()`)
  await ctx.sleep(1800)
  const viewer = await ctx.evalJs(`(() => ({
    count: Object.values(window.__sunaDev.dock.panelComponents()).filter((c) => c === 'pdf').length,
    active: window.__sunaDev.dock.activePanelPath(),
    component: window.__sunaDev.dock.activePanelComponent()
  }))()`)
  // Not "one more tab": openViewerInSide REPLACES the side viewer, so a run
  // against an app that already had a paper open would otherwise fail on a
  // count that is correct.
  check(
    'clicking it opens the paper beside the list',
    viewer.count >= 1 && viewer.count <= Math.max(1, pdfTabsBefore),
    `pdf panels: ${pdfTabsBefore} -> ${viewer.count}`
  )
  check(
    'the tab that opened is a reference PDF',
    viewer.component === 'pdf' && /references[/\\].*\.pdf$/.test(String(viewer.active)),
    `${viewer.component} ${json(viewer.active)}`
  )

  // ------------------------------------------------------ 2. export the notes
  await ctx.evalJs(`window.__sunaDev.dock.openReadingNotesTab(${json(rootDir)})`)
  // Notes files put in place while the app was running are only re-read on a
  // saveBump; the tab may already be mounted from an earlier run.
  await ctx.evalJs(`window.__sunaDev.projectStore.getState().noteFileSaved('')`)
  await ctx.waitFor(`document.querySelector('.rnotes__bar') !== null`, {
    timeoutMs: 15000,
    desc: 'the reading notes tab'
  })
  await ctx.sleep(1200)

  const noteCount = await ctx.evalJs(`document.querySelectorAll('.rnotes__card').length`)
  assert(
    noteCount > 0,
    'this project has no reading notes — highlight a passage in a reference PDF first'
  )

  const exportBtn = await ctx.evalJs(`(() => {
    const el = document.querySelector('.rnotes__exportbtn')
    return el === null
      ? null
      : { disabled: el.disabled, label: el.getAttribute('aria-label'), hasIcon: el.querySelector('svg') !== null }
  })()`)
  assert(exportBtn !== null, 'no export button beside "Copy as Markdown"')
  check('the export button is an icon, enabled next to the copy button', !exportBtn.disabled && exportBtn.hasIcon)

  const outputDir = join(rootDir, 'output', 'notes')
  const formats = ['pdf', 'docx', 'html']
  for (const format of formats) rmSync(join(outputDir, `reading-notes.${format}`), { force: true })

  for (const format of formats) {
    await ctx.evalJs(`document.querySelector('.rnotes__exportbtn').click()`)
    await ctx.sleep(400)
    const opened = await ctx.evalJs(`(() => {
      const items = [...document.querySelectorAll('.rnotes__menuitem')].map((b) => b.textContent)
      return items
    })()`)
    check(`the menu offers all three documents (before ${format})`, opened.length === 3, json(opened))
    const label = { pdf: 'PDF', docx: 'Word', html: 'Web page' }[format]
    await ctx.evalJs(`(() => {
      const item = [...document.querySelectorAll('.rnotes__menuitem')].find((b) => b.textContent.includes(${json(label)}))
      item.click()
    })()`)
    await ctx.sleep(format === 'pdf' ? 4000 : 2500)

    const target = join(outputDir, `reading-notes.${format}`)
    const exists = existsSync(target)
    check(`${format}: a file lands in output/`, exists, target)
    if (!exists) continue
    const bytes = statSync(target).size
    check(`${format}: it is not an empty file`, bytes > 500, `${bytes} bytes`)

    // The magic number, because a .docx that is really HTML would still be a
    // file of a plausible size.
    const head = readFileSync(target).subarray(0, 5)
    if (format === 'pdf') check('pdf: it is really a PDF', head.toString('latin1').startsWith('%PDF'))
    if (format === 'docx') check('docx: it is really a zip container', head[0] === 0x50 && head[1] === 0x4b)
    if (format === 'html') {
      const text = readFileSync(target, 'utf8')
      check('html: it is one self-contained page', /^<!doctype html>/i.test(text) && !/<link\b|<script\b/i.test(text))
      check('html: it carries a quote and its page', /p\. \d/.test(text) && /nx-quote/.test(text))
      check('html: it says how much of the reading it is', /note/.test(text) && /exported \d{4}-\d{2}-\d{2}/.test(text))
    }
  }

  // The status line names the file, and offers the two things anyone does
  // with one: read it, or go to where it is.
  const toast = await ctx.evalJs(`(() => {
    const el = document.querySelector('.pdfview__note')
    return el === null
      ? null
      : { text: el.textContent, buttons: [...el.querySelectorAll('.rnotes__notebtn')].map((b) => b.textContent) }
  })()`)
  check('the panel says where the file went', toast !== null && /output\/notes\//.test(toast.text), json(toast))
  check(
    'it offers both Open and Show in folder',
    toast !== null && toast.buttons.some((b) => b === 'Open') && toast.buttons.some((b) => /folder/i.test(b)),
    json(toast && toast.buttons)
  )

  if (failures.length > 0) throw new Error(`${failures.length} check(s) failed: ${failures.join(', ')}`)
  console.log('\nnotes-export: all checks passed')
}
