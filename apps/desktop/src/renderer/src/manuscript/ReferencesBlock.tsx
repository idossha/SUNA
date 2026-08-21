import { useEffect, useState, type JSX } from 'react'
import {
  assignNumbers,
  formatReference,
  parseBibtex,
  type Run
} from '@suna/bib'
import { getBundledProfile } from '@suna/formatter'
import { outlineFromMarkdown } from '@suna/markdown'
import type { Manuscript } from '@suna/core'
import { useProjectStore } from '../state/project'
import { peekDocSessionText } from '../state/docSessions'
import { useManuscriptDocStore } from '../state/manuscriptDoc'
import { usePreviewProfileId } from '../state/renderProfile'
import { citeStyleOf, maxAuthorsFor } from '../views/refs'
import {
  buildLabelMap,
  collectClusters,
  orderByEmbedAppearance,
  orderedReferences,
  type ReferenceRow
} from './citations'

function RunSpans({ runs }: { runs: readonly Run[] }): JSX.Element {
  return (
    <>
      {runs.map((run, i) => {
        const inner =
          run.link !== undefined && 'url' in run.link ? (
            <a href={run.link.url} onClick={(e) => e.preventDefault()} title={run.link.url}>
              {run.text}
            </a>
          ) : (
            run.text
          )
        if (run.style === 'italic') return <em key={i}>{inner}</em>
        if (run.style === 'bold') return <strong key={i}>{inner}</strong>
        return <span key={i}>{inner}</span>
      })}
    </>
  )
}

interface ReferencesBlockProps {
  rootDir: string
  /** Registry id of the document this reference list belongs to (ADR-009). */
  documentId: string
  /** The manuscript's prose file, relative to manuscript/ (manuscript.json's `manuscriptFile`). */
  manuscriptFile: string
  /** Figures/tables from manuscript.json, for @fig:/@tbl: label numbering. */
  figures: Manuscript['figures']
  tables: Manuscript['tables']
  /** Bibliography file name from manuscript.json (e.g. "references.bib"). */
  bibliography: string
  /**
   * Heading over the list. The supplement numbers its citations independently
   * of the main text (export-content.ts), so its list is "Supplementary
   * References" and calling it "References" there would read as the paper's.
   */
  label?: string
}

/**
 * The reference list of the combined document: the whole prose file is
 * parsed with parseSciMark section by section (outlineFromMarkdown slices
 * it — same tiling the sidebar outline uses), citation clusters are
 * collected in first-appearance order, and the *preview* profile
 * (state/renderProfile — the References view's 'Rendered as' selection,
 * defaulting to the project's activeProfileId) decides in-text mode and
 * list ordering. Recomputed on saveBump (i.e. after a save, not on every
 * keystroke — matches citations/cross-refs only updating once the prose
 * they cite is saved). Each recompute also publishes the numbers/entries/
 * style to state/manuscriptDoc so the editor resolves its citation chips
 * the same way.
 */
export function ReferencesBlock({
  rootDir,
  documentId,
  manuscriptFile,
  figures,
  tables,
  bibliography,
  label = 'References'
}: ReferencesBlockProps): JSX.Element {
  const saveBump = useProjectStore((s) => s.saveBump)
  const previewProfileId = usePreviewProfileId()

  const [rows, setRows] = useState<ReferenceRow[] | null>(null)
  const [bibError, setBibError] = useState<string | null>(null)

  const profile = getBundledProfile(previewProfileId)

  // clear the shared citation render data when the combined tab closes
  useEffect(
    () => () => useManuscriptDocStore.getState().publishCitationRender(documentId, null),
    [documentId]
  )

  useEffect(() => {
    if (profile === null) return
    let cancelled = false
    void (async () => {
      // Buffer truth first (state/docSessions): while the manuscript is open
      // in ANY editor, its live buffer — not the possibly-stale disk copy —
      // is what the reference numbering should reflect.
      let proseText = peekDocSessionText(`${rootDir}/manuscript/${manuscriptFile}`) ?? ''
      if (proseText === '') {
        try {
          const { content } = await window.suna.invoke('fs:read-text', {
            path: `${rootDir}/manuscript/${manuscriptFile}`
          })
          proseText = content
        } catch {
          // no prose file yet — an empty document has no citations
        }
      }
      const outline = outlineFromMarkdown(proseText)
      const sections = outline.map((section) => ({
        heading: section.level === 0 ? null : section.title,
        source: proseText.slice(section.from, section.to)
      }))

      let bibText = ''
      let bibProblem: string | null = null
      try {
        const { content } = await window.suna.invoke('fs:read-text', {
          path: `${rootDir}/manuscript/${bibliography}`
        })
        bibText = content
      } catch {
        bibProblem = `No manuscript/${bibliography} in this project.`
      }
      if (cancelled) return

      const clusters = sections.flatMap((section) => collectClusters(section.source))
      const numbers = assignNumbers(clusters.map((c) => [...c.keys]))
      const parsed = parseBibtex(bibText)
      const entryMap = new Map(parsed.entries.map((e) => [e.key, e]))
      setRows(
        orderedReferences(numbers, entryMap, profile.citations.referenceList.sortOrder)
      )
      setBibError(bibProblem)
      // Numbering follows the prose: first-embed order wins, manifest order
      // only for anything never embedded — same rule as the exporters.
      const labels = buildLabelMap(
        orderByEmbedAppearance(figures, proseText, 'fig'),
        orderByEmbedAppearance(tables, proseText, 'tbl'),
        sections
      )
      // share numbering + style + labels so the editor resolves its
      // citation and cross-reference chips the same way
      useManuscriptDocStore.getState().publishCitationRender(documentId, {
        numbers,
        entries: entryMap,
        style: citeStyleOf(profile.citations),
        labels
      })
    })()
    return () => {
      cancelled = true
    }
  }, [rootDir, manuscriptFile, bibliography, saveBump, profile, figures, tables])

  if (profile === null) {
    return (
      <section className="msdoc__references msdoc__block">
        <div className="msdoc__label">{label}</div>
        <p className="msdoc__hint">No publisher profile available.</p>
      </section>
    )
  }

  const numeric = profile.citations.mode !== 'author-year'

  return (
    <section className="msdoc__references msdoc__block">
      <div className="msdoc__label">{label}</div>
      <p className="msdoc__rendered-as">Rendered as: {profile.journalName}</p>
      {bibError !== null && <p className="msdoc__hint">{bibError}</p>}
      {rows !== null && rows.length === 0 && (
        <p className="msdoc__hint">No citations in the manuscript yet.</p>
      )}
      {rows !== null &&
        rows.map((row) =>
          row.entry !== undefined ? (
            <div className="msdoc__ref" key={row.key}>
              {numeric && <span className="msdoc__ref-num">{row.number}.</span>}
              <span>
                <RunSpans
                  runs={formatReference(row.entry, {
                    maxAuthors: maxAuthorsFor(
                      profile.citations.referenceList.authorTruncation,
                      row.entry.authors.length
                    )
                  })}
                />
              </span>
            </div>
          ) : (
            <div className="msdoc__ref msdoc__ref--unknown" key={row.key}>
              {numeric && <span className="msdoc__ref-num">{row.number}.</span>}
              <span>
                <span className="msdoc__ref-flag">@{row.key}</span> — cited but not found in{' '}
                {bibliography}
              </span>
            </div>
          )
        )}
    </section>
  )
}
