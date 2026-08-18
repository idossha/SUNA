import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import {
  DEFAULT_LIBRARY_CONFIG,
  type LibraryConfig,
  type LitResult
} from '@suna/core'
import {
  describePdfFailure,
  downloadPdf,
  lookupByDoi,
  pdfUrlPlan,
  searchLiterature
} from '@suna/bib'
import { findLocalPdf } from './library/scan'

/**
 * LIVE access probe — the reachability matrix, not a unit test.
 *
 * `pnpm test` must stay hermetic and offline, so this whole file is skipped
 * unless SUNA_PROBE=1. It touches the real network on purpose:
 *
 *   SUNA_PROBE=1 pnpm --filter @suna/agent test lit-access
 *
 * It ASSERTS ALMOST NOTHING and exits green even when every publisher blocks
 * us. That is deliberate. Whether nph.onlinelibrary.wiley.com serves a PDF to
 * a script today is a fact about Wiley's bot policy, not about SUNA's
 * correctness, and a red CI run is the wrong way to learn it. The output is a
 * matrix a human reads.
 *
 * Ground truth probed 2026-08-18, which is why the corpus is shaped this way:
 *   - Wiley (the DOI that prompted this file) answers HTTP 403 with a
 *     Cloudflare "Just a moment…" interstitial — to SUNA's User-Agent AND to
 *     a current Chrome one, at the landing page AND at the `/doi/pdfdirect/`
 *     URL that BOTH OpenAlex and Unpaywall name as the OA location. The
 *     challenge is JavaScript; no header spelling defeats it from `fetch`.
 *     So "the free PDF is right there in the URL" and "a script can retrieve
 *     it" are different claims, and this file exists to keep them apart.
 *   - Unpaywall reports that DOI `is_oa: true`, `oa_status: bronze`, with the
 *     publisher as the ONLY location and no repository copy
 *     (`any_repository_has_fulltext: false`). Bronze OA is exactly the class
 *     that looks free and downloads worst: free to read on a page we cannot
 *     reach, with no green copy to fall back to.
 *
 * The lesson the corpus encodes: the aggregators are reliable about WHERE a
 * PDF is and unreliable about whether WE can GET it. Treating an OA URL as a
 * promise of bytes is the bug; classifying the failure honestly is the fix.
 */

const LIVE = process.env['SUNA_PROBE'] === '1'
const MAILTO = process.env['SUNA_PROBE_MAILTO'] ?? 'author@example.edu'

/* ------------------------------------------------------------- corpus -- */

interface Specimen {
  label: string
  doi: string | null
  /** arXiv id, when the work is a preprint we can address directly. */
  arxivId?: string
  /** What we expect, so a CHANGE is visible rather than just a status. */
  expect: 'downloads' | 'blocked' | 'unknown'
  why: string
}

const CORPUS: Specimen[] = [
  {
    label: 'arXiv (preprint server)',
    doi: null,
    arxivId: '2303.08774',
    expect: 'downloads',
    why: 'arxiv.org/pdf serves bytes to anyone'
  },
  {
    label: 'bioRxiv (preprint)',
    doi: '10.1101/2020.03.09.983247',
    expect: 'downloads',
    why: 'openRxiv serves .full.pdf directly'
  },
  {
    label: 'medRxiv (preprint)',
    doi: '10.1101/2020.03.24.20043018',
    expect: 'downloads',
    why: 'same host family as bioRxiv'
  },
  {
    label: 'PLOS (full OA publisher)',
    doi: '10.1371/journal.pone.0000217',
    expect: 'downloads',
    why: 'gold OA, no interstitial'
  },
  {
    label: 'eLife (full OA publisher)',
    doi: '10.7554/eLife.00013',
    expect: 'downloads',
    why: 'gold OA; reached via its Europe PMC copy, not eLife itself'
  },
  {
    label: 'Wiley / New Phytologist (bronze OA)',
    doi: '10.1111/j.1469-8137.2009.03069.x',
    expect: 'blocked',
    why: 'THE case that prompted this file: Cloudflare 403, no repository copy'
  },
  {
    label: 'Elsevier / ScienceDirect',
    doi: '10.1016/j.cell.2020.02.052',
    expect: 'downloads',
    why: 'ScienceDirect blocks scripts, but a PubMed Central copy exists'
  },
  {
    label: 'Springer Nature',
    doi: '10.1038/s41586-020-2649-2',
    expect: 'downloads',
    why: 'nature.com bounces through an IdP; the arXiv mirror serves it'
  },
  {
    label: 'MDPI (full OA publisher)',
    doi: '10.3390/e23010081',
    expect: 'downloads',
    why: 'mdpi.com answers 403; the arXiv mirror serves it'
  },
  {
    label: 'ApJ / AAS (older astro paper)',
    doi: '10.1086/151605',
    expect: 'unknown',
    why: "Gunn & Gott 1972 — the repo's own example citation"
  }
]

/* --------------------------------------------------------- classifying -- */

type Verdict = 'ok' | 'blocked' | 'no-oa' | 'not-found' | 'network'

/**
 * Turn `downloadPdf`'s error prose into one of five verdicts. The distinction
 * that matters to a user is BLOCKED ("the PDF exists and is free, but this
 * host refuses scripts — open it yourself") versus NO-OA ("there is no free
 * copy to get"). Reporting both as "download failed" is what makes the
 * feature feel broken when it is actually being honest.
 */
function classify(error: string | null, hadCandidates: boolean): Verdict {
  if (error === null) return 'ok'
  const e = error.toLowerCase()
  if (e.includes('403') || e.includes('forbidden') || e.includes('captcha')) return 'blocked'
  if (e.includes('cloudflare') || e.includes('just a moment')) return 'blocked'
  if (e.includes('not html') === false && e.includes('html') && hadCandidates) return 'blocked'
  if (e.includes('401') || e.includes('paywall')) return 'blocked'
  if (!hadCandidates) return 'no-oa'
  if (e.includes('unreachable') || e.includes('no response') || e.includes('timed out')) return 'network'
  return 'network'
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length)
}

function kb(bytes: Uint8Array | null): string {
  return bytes === null ? '—' : `${Math.round(bytes.length / 1024)} KB`
}

/** A LitResult good enough to drive the ladder, from whatever the providers gave us. */
function stub(spec: Specimen, found: LitResult | null): LitResult {
  if (found !== null) return found
  return {
    source: spec.arxivId !== undefined ? 'arxiv' : 'crossref',
    id: spec.arxivId ?? spec.doi ?? spec.label,
    doi: spec.doi,
    title: spec.label,
    authors: [],
    year: null,
    venue: null,
    citedByCount: null,
    openAccessUrl: null,
    abstract: null
  }
}

/* --------------------------------------------------------------- probes -- */

describe.skipIf(!LIVE)('LIVE access probe (SUNA_PROBE=1)', () => {
  it('metadata: which providers answer for each specimen', { timeout: 300_000 }, async () => {
    const lines: string[] = []
    lines.push('')
    lines.push('METADATA RESOLUTION — can we identify the work at all?')
    lines.push(
      `  ${pad('specimen', 38)}${pad('crossref', 10)}${pad('openalex', 10)}${pad('oa url?', 9)}title`
    )

    for (const spec of CORPUS) {
      if (spec.doi === null) {
        const s = await searchLiterature('arxiv', spec.arxivId ?? '', { limit: 1 })
        const hit = s.results[0]
        lines.push(
          `  ${pad(spec.label, 38)}${pad('—', 10)}${pad('—', 10)}${pad(hit?.openAccessUrl !== undefined && hit.openAccessUrl !== null ? 'yes' : 'no', 9)}${(hit?.title ?? s.error ?? 'no hit').slice(0, 60)}`
        )
        continue
      }
      const [cr, oa] = await Promise.all([
        lookupByDoi('crossref', spec.doi, { mailto: MAILTO }),
        lookupByDoi('openalex', spec.doi, { mailto: MAILTO })
      ])
      const best = oa.result ?? cr.result
      const crState = cr.error !== null ? 'ERR' : cr.result !== null ? 'ok' : 'none'
      const oaState = oa.error !== null ? 'ERR' : oa.result !== null ? 'ok' : 'none'
      lines.push(
        `  ${pad(spec.label, 38)}${pad(crState, 10)}${pad(oaState, 10)}${pad(best?.openAccessUrl != null ? 'yes' : 'no', 9)}${(best?.title ?? '—').slice(0, 60)}`
      )
    }
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))
  })

  it('pdf: which specimens actually yield bytes', { timeout: 600_000 }, async () => {
    const lines: string[] = []
    lines.push('')
    lines.push('PDF ACQUISITION — an OA url is not a promise of bytes')
    lines.push(
      `  ${pad('specimen', 38)}${pad('expect', 11)}${pad('verdict', 10)}${pad('size', 9)}${pad('via', 20)}detail`
    )

    const surprises: string[] = []
    for (const spec of CORPUS) {
      const found =
        spec.doi === null
          ? ((await searchLiterature('arxiv', spec.arxivId ?? '', { limit: 1 })).results[0] ?? null)
          : ((await lookupByDoi('openalex', spec.doi, { mailto: MAILTO })).result ??
            (await lookupByDoi('crossref', spec.doi, { mailto: MAILTO })).result)

      const result = stub(spec, found)
      const plan = pdfUrlPlan(result, { policy: 'publisher', mailto: MAILTO })
      const outcome = await downloadPdf(result, { policy: 'publisher', mailto: MAILTO })
      const verdict = classify(outcome.error, plan.candidates.length > 0)

      // The classified reason is what a user actually reads, so show it here
      // rather than only the raw ladder report behind it.
      const detail =
        outcome.error === null
          ? (outcome.sourceUrl ?? '').slice(0, 70)
          : `[${outcome.failure ?? '?'}] ${describePdfFailure(outcome)}`.slice(0, 96)

      lines.push(
        `  ${pad(spec.label, 38)}${pad(spec.expect, 11)}${pad(verdict, 10)}${pad(kb(outcome.bytes), 9)}${pad(outcome.via ?? '—', 20)}${detail}`
      )

      const matched =
        (spec.expect === 'downloads' && verdict === 'ok') ||
        (spec.expect === 'blocked' && verdict === 'blocked') ||
        spec.expect === 'unknown'
      if (!matched) surprises.push(`${spec.label}: expected ${spec.expect}, got ${verdict}`)
    }

    lines.push('')
    lines.push(
      surprises.length === 0
        ? '  no surprises — every specimen behaved as recorded'
        : `  CHANGED SINCE LAST PROBE (worth a look, not necessarily a bug):\n    ${surprises.join('\n    ')}`
    )
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))
  })

  it('local: the scanner finds each filename convention in a fixture tree', async () => {
    const base = await mkdtemp(join(tmpdir(), 'suna-probe-'))
    const zot = join(base, 'Zotero', 'storage', 'A1B2C3D4')
    const dl = join(base, 'Downloads')
    const papers = join(base, 'Papers')
    await mkdir(zot, { recursive: true })
    await mkdir(dl, { recursive: true })
    await mkdir(papers, { recursive: true })

    // A real publisher PDF carries its DOI in UNCOMPRESSED XMP, which is why a
    // raw byte search works with no PDF parser. This fixture mimics that.
    const doi = '10.1086/151605'
    const withDoi = `%PDF-1.4\n<?xpacket?><rdf:RDF><dc:identifier>doi:${doi}</dc:identifier></rdf:RDF>\n`
    await writeFile(join(zot, 'Full Text PDF.pdf'), withDoi)
    await writeFile(join(dl, 'Gunn_1972_Infall.pdf'), '%PDF-1.4\nno metadata here\n')
    await writeFile(join(papers, 'Gunn - 1972 - On the Infall of Matter.pdf'), '%PDF-1.4\n')

    const config: LibraryConfig = {
      ...DEFAULT_LIBRARY_CONFIG,
      roots: [zot, dl, papers],
      useSpotlight: false
    }
    const result: LitResult = {
      source: 'crossref',
      id: doi,
      doi,
      title: 'On the Infall of Matter into Clusters of Galaxies and Some Effects on Their Evolution',
      authors: ['James E. Gunn', 'J. Richard Gott'],
      year: 1972,
      venue: 'The Astrophysical Journal',
      citedByCount: null,
      openAccessUrl: null,
      abstract: null
    }

    const found = await findLocalPdf(result, config, { platform: 'linux' })
    const lines: string[] = ['', 'LOCAL SCAN — fixture tree, Spotlight off (deterministic)']
    lines.push(`  roots searched: ${found.rootsSearched.length}  scanned: ${found.scanned}`)
    for (const m of found.matches) {
      lines.push(
        `  ${pad(m.confidence, 8)}${pad(m.evidence.join(','), 40)}${m.path.slice(base.length + 1)}`
      )
    }
    if (found.matches.length === 0) lines.push('  NO MATCHES — the three conventions below all missed')
    for (const note of found.notes) lines.push(`  note: ${note}`)
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))
  })
})

describe.skipIf(LIVE)('access probe (skipped)', () => {
  it('runs only with SUNA_PROBE=1', () => {
    // Placeholder so `pnpm test` reports the file rather than silently omitting it.
  })
})
