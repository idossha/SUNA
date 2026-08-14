import type { JSX } from 'react'
import type { LitResult } from '@suna/core'
import { formatAuthors, formatCitedBy, formatYearVenue } from './result-format'

interface ResultCardProps {
  result: LitResult
  /** true once "Add to references.bib" has succeeded for this exact result in this session. */
  added: boolean
  /** true while the add is in flight. */
  adding: boolean
  onAdd: () => void
  onCopyDoi: () => void
}

function doiUrl(doi: string): string {
  return `https://doi.org/${doi}`
}

export function ResultCard({ result, added, adding, onAdd, onCopyDoi }: ResultCardProps): JSX.Element {
  const openUrl = result.doi !== null ? doiUrl(result.doi) : result.openAccessUrl
  const citedBy = formatCitedBy(result.citedByCount)

  return (
    <li className="lit-card">
      <div className="lit-card__title-row">
        <span className="lit-card__title">{result.title}</span>
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
