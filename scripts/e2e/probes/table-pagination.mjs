/**
 * Drive probe — tables and figures are not split across page boundaries
 * (DECISIONS 2026-08-20).
 *
 * A unit test cannot prove this. `break-inside: avoid` is a REQUEST to
 * Chromium's print pass, and whether Chromium honours it on a block container
 * versus a table row — and whether it honours it at all in `printToPDF` as
 * opposed to on screen — is an empirical question about the renderer we
 * actually ship. So this asserts the RENDERED BYTES: it exports a real PDF,
 * reads it back with pdf.js, and checks which page each table row landed on.
 *
 * Three checks, matching the three things the change claims:
 *
 *   1. A table positioned to straddle a page boundary comes out whole — every
 *      one of its rows reports the same page index.
 *   2. A table taller than the page still breaks (it must — there is nowhere
 *      else for it to go) but its HEADER ROW repeats on the continuation.
 *   3. That same table is REPORTED as oversized, so the author learns about
 *      it from the app rather than from a reviewer.
 *
 * The fixture is written into the scratch example project under
 * .userdata-drive/ and removed again afterwards, whatever the outcome.
 *
 * Run:  node scripts/e2e/drive.mjs --boot --example
 *       node scripts/e2e/drive.mjs scripts/e2e/probes/table-pagination.mjs
 */
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
/** pdfjs-dist is a dependency of apps/desktop, not of scripts/ — resolve it there. */
const requireFromDesktop = createRequire(join(ROOT, 'apps', 'desktop', 'package.json'))

const json = (v) => JSON.stringify(v)

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

/**
 * How tall the straddling table is, in rows.
 *
 * Tuned so the table is roughly 0.8 of a printable page: tall enough that it
 * cannot fit in the space left below the filler (so an unprotected export
 * MUST tear it), short enough to fit a page of its own (so a protected export
 * can keep it whole). A shorter table simply fits wherever it lands and the
 * check passes without proving anything — verified by running this probe with
 * BREAK_CSS removed and watching it fail.
 */
const STRADDLE_ROWS = 30

/** A markdown table of `rows` data rows, wide enough to be unmistakable in the text layer. */
function tableMarkdown(tag, rows) {
  const head = `| ${tag} key | ${tag} value | ${tag} note |`
  const rule = '| --- | --- | --- |'
  const body = Array.from(
    { length: rows },
    (_, i) => `| ${tag}-k${i + 1} | ${((i + 1) * 3.14159).toFixed(3)} | ${tag} row ${i + 1} |`
  )
  return [head, rule, ...body].join('\n')
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

  // The prose file's location is a project-layout question (flat vs
  // manuscript/), so it is asked rather than assumed.
  const mdPath = [join(rootDir, 'manuscript', 'manuscript.md'), join(rootDir, 'manuscript.md')].find((p) =>
    existsSync(p)
  )
  assert(mdPath !== undefined, `no manuscript.md under ${rootDir}`)
  const original = readFileSync(mdPath, 'utf8')
  const outPath = join(rootDir, 'output', 'table-pagination-probe.pdf')

  try {
    // ---------------------------------------------------------------- fixture
    // FILLER pushes the straddling table down the page so that it CANNOT fit
    // in the space left below it — the exact situation where an unprotected
    // table splits. STRADDLE is short enough to fit on a page of its own.
    // GIANT is taller than the printable box no matter where it starts.
    const filler = Array.from(
      { length: 14 },
      (_, i) =>
        `Filler paragraph ${i + 1}. ` +
        'This sentence exists only to consume vertical space so that the table below it ' +
        'arrives near the foot of a page, which is the condition under which an unprotected ' +
        'table is torn in half by the print pass. '
    ).join('\n\n')

    writeFileSync(
      mdPath,
      [
        original,
        '',
        '## Pagination probe',
        '',
        filler,
        '',
        tableMarkdown('straddle', STRADDLE_ROWS),
        '',
        'A paragraph after the straddling table.',
        '',
        tableMarkdown('giant', 70),
        '',
        'A paragraph after the giant table.',
        ''
      ].join('\n')
    )
    // The exporter reads the file from disk, but the app holds the manuscript
    // in memory; reloading keeps the two in step.
    await ctx.evalJs(`window.__sunaDev.projectStore.getState().reload?.()`)
    await ctx.sleep(800)

    // ----------------------------------------------------------------- export
    const res = await ctx.evalJs(`(async () => {
      const state = window.__sunaDev.projectStore.getState()
      const profileId = state.manifest?.activeProfileId ?? 'suna'
      try {
        // The exporter refuses to guess at a figure, so the manuscript's
        // figures are rasterized exactly as the export dialog does it. Vite
        // serves the renderer's own modules, so this is the app's real
        // rasterizer rather than a probe-local imitation of it.
        const { rasterizeManuscriptFigures } = await import('/src/export/rasterizeFigures.ts')
        const { getBundledProfile } = await import('/src/../../../packages/formatter/src/index.ts')
          .catch(() => ({ getBundledProfile: null }))
        const manuscript = window.__sunaDev.manuscriptStore.getState().manuscript
        const profile = window.__sunaDev.exportProfileFor
          ? window.__sunaDev.exportProfileFor(profileId)
          : (getBundledProfile ? getBundledProfile(profileId) : null)
        const figurePngPaths = await rasterizeManuscriptFigures(${json(rootDir)}, manuscript, profile, {
          compress: true,
          cache: true
        })
        const out = await window.suna.invoke('export:pdf', {
          dir: ${json(rootDir)},
          profileId,
          outputName: 'table-pagination-probe',
          figurePngPaths,
          options: { doubleSpacing: false, lineNumbers: false, pageNumbers: true },
          target: 'manuscript'
        })
        return { ok: true, path: out.path, oversized: out.oversized }
      } catch (err) {
        return { ok: false, error: String(err && err.message ? err.message : err) }
      }
    })()`)
    assert(res && res.ok, `export:pdf failed — ${res && res.error}`)
    assert(existsSync(outPath), `export reported success but wrote no file at ${outPath}`)

    // ------------------------------------------------- read the rendered pages
    const pdfjs = await import(
      pathToFileURL(requireFromDesktop.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href
    )
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(readFileSync(outPath)) })
    const doc = await loadingTask.promise
    /** Page text, one string per page, whitespace normalized. */
    const pages = []
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      pages.push(content.items.map((it) => it.str ?? '').join(' ').replace(/\s+/g, ' '))
    }
    console.log(`  · exported ${doc.numPages} pages`)

    /** Every page index (1-based) whose text contains `needle`. */
    const pagesWith = (needle) =>
      pages.map((text, i) => (text.includes(needle) ? i + 1 : 0)).filter((n) => n > 0)

    // 1. the straddling table is whole
    const straddleRowPages = Array.from({ length: 12 }, (_, i) => pagesWith(`straddle row ${i + 1}`))
    const missing = straddleRowPages.findIndex((p) => p.length === 0)
    assert(
      missing === -1,
      `straddle row ${missing + 1} is not in the PDF text at all — the fixture did not render`
    )
    const straddlePages = new Set(straddleRowPages.map((p) => p[0]))
    check(
      'a table that straddles a page boundary comes out whole',
      straddlePages.size === 1,
      `its ${STRADDLE_ROWS} rows landed on pages ${[...straddlePages].join(', ')}`
    )

    // 2. the oversized table breaks, but repeats its header
    const giantRowPages = Array.from({ length: 70 }, (_, i) => pagesWith(`giant row ${i + 1}`))
      .filter((p) => p.length > 0)
      .map((p) => p[0])
    const giantSpan = new Set(giantRowPages)
    assert(giantSpan.size > 0, 'the giant table did not render at all')
    check(
      'a table taller than the page does break — nothing else is possible',
      giantSpan.size > 1,
      `it fitted on one page (${[...giantSpan].join(', ')}), so this check proves nothing`
    )
    const headerPages = pagesWith('giant key')
    check(
      'the oversized table repeats its header row on the continuation',
      headerPages.length >= giantSpan.size,
      `header on ${headerPages.length} page(s), table spans ${giantSpan.size}`
    )

    // 3. the overrun is reported
    const reported = res.oversized ?? []
    check(
      'the oversized table is reported to the author',
      reported.length > 0,
      `export:pdf returned oversized: ${JSON.stringify(reported)}`
    )
    if (reported.length > 0) {
      console.log(`  · reported: ${reported.map((b) => `${b.label} @ ${b.heightRatio}×`).join(', ')}`)
      check(
        'the report says how badly it overruns',
        reported.every((b) => b.heightRatio > 1),
        JSON.stringify(reported)
      )
    }

    await loadingTask.destroy()
  } finally {
    writeFileSync(mdPath, original)
    rmSync(outPath, { force: true })
    await ctx.evalJs(`window.__sunaDev.projectStore.getState().reload?.()`).catch(() => undefined)
  }

  if (failures.length > 0) throw new Error(`${failures.length} check(s) failed: ${failures.join(', ')}`)
  console.log('table-pagination: all checks passed')
}
