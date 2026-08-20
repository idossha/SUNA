import type { JSX } from 'react'
import { countWords, docSlice, useManuscriptDocStore } from '../state/manuscriptDoc'
import './documents.css'

/**
 * The outline of a non-manuscript document (document-kinds-ux.md §A.1).
 *
 * Deliberately plainer than `ManuscriptView`. That view carries title-page
 * metadata, figure and table counts and a reference list — all of which
 * describe the manuscript. Rendering it under a cover letter would put
 * "2 figures, 1 table" beside a document that has neither.
 */
export function DocumentOutline({
  documentId,
  title
}: {
  documentId: string
  title: string
}): JSX.Element {
  const slice = useManuscriptDocStore((s) => docSlice(s, documentId))
  const total = slice.outline.reduce((n, s) => n + countWords(s.title), 0)

  return (
    <div className="docout">
      <div className="docout__title">{title}</div>
      {slice.outline.length === 0 ? (
        <p className="docout__empty">
          {slice.tabMounted ? 'No headings in this document.' : 'Open the document to see its outline.'}
        </p>
      ) : (
        <ul className="docout__list">
          {slice.outline.map((section, i) => (
            <li key={i}>
              <button
                className={`docout__row${slice.activeSectionIndex === i ? ' is-active' : ''}`}
                style={{ paddingLeft: `${8 + Math.max(0, section.level - 1) * 12}px` }}
                onClick={() => useManuscriptDocStore.getState().requestScroll(documentId, i)}
              >
                <span className="docout__row-title">
                  {section.title === '' ? 'untitled' : section.title}
                </span>
                <span className="docout__row-words">{section.words}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {total > 0 && <div className="docout__total">{slice.outline.length} sections</div>}
    </div>
  )
}
