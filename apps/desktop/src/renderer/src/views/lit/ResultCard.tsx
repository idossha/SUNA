import type { JSX } from 'react'
import type { LitResult } from '@suna/core'
import type { PdfResolution } from '@suna/bib'
import {
  FIND_PDF_BUSY_LABEL,
  FIND_PDF_HINT,
  FIND_PDF_LABEL,
  PDF_BADGE_LABEL,
  pdfBadgeTitle
} from '../refs'
import { formatAuthors, formatCitedBy, formatYearVenue } from './result-format'

interface ResultCardProps {
  result: LitResult
  /** true once "Add to references.bib" has succeeded for this exact result in this session. */
  added: boolean
  /** true while the add is in flight. */
  adding: boolean
  onAdd: () => void
  /** true while the acquisition ladder is running for this result. */
  finding: boolean
  /** The PDF this project already has filed for this work, or null when it
   *  has none — the same resolution the Library tab badges from. */
  pdf: PdfResolution | null
  onFindPdf: () => void
  onCopyDoi: () => void
}

function doiUrl(doi: string): string {
  return `https://doi.org/${doi}`
}

export function ResultCard({
  result,
  added,
  adding,
  onAdd,
  finding,
  pdf,
  onFindPdf,
  onCopyDoi
}: ResultCardProps): JSX.Element {
  const openUrl = result.doi !== null ? doiUrl(result.doi) : result.openAccessUrl
  const citedBy = formatCitedBy(result.citedByCount)

  return (
    <li className="lit-card">
      <div className="lit-card__title-row">
        <span className="lit-card__title">{result.title}</span>
        {pdf !== null && (
          <span className="refs__pdf-badge" title={pdfBadgeTitle(pdf.how)}>
            {PDF_BADGE_LABEL}
          </span>
        )}
        {result.openAccessUrl !== null && (
          <span className="chip chip--accent" title={`Open access: ${result.openAccessUrl}`}>
            OA
          </span>
        )}
      </div>
      <div className="lit-card__meta">{formatAuthors(result.authors)}</div>
      <div className="lit-card__meta lit-card__meta--faint">
        {[formatYearVenue(result.year, result.venue), citedBy].filter((p) => p !== '').join(' · ')}
      </div>
      <div className="lit-card__actions">
        <button className="lit-card__action" onClick={onAdd} disabled={adding || added}>
          {added ? 'Added' : adding ? 'Adding…' : 'Add to references.bib'}
        </button>
        {pdf === null && (
          <button
            className="lit-card__action"
            onClick={onFindPdf}
            disabled={finding || adding}
            title={FIND_PDF_HINT}
          >
            {finding ? FIND_PDF_BUSY_LABEL : FIND_PDF_LABEL}
          </button>
        )}
        <button className="lit-card__action" onClick={onCopyDoi} disabled={result.doi === null}>
          Copy DOI
        </button>
        {openUrl !== null ? (
          <a className="lit-card__action lit-card__action--link" href={openUrl} target="_blank" rel="noreferrer">
            Open
          </a>
        ) : (
          <span className="lit-card__action lit-card__action--disabled">Open</span>
        )}
      </div>
    </li>
  )
}
