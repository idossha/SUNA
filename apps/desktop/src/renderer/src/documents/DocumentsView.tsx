import { useEffect, useState, type JSX } from 'react'
import type { DocumentEntry } from '@suna/core'
import { useProjectStore } from '../state/project'
import { useDocumentsStore, refreshDocuments, secondaryDocuments } from '../state/documents'
import { useManuscriptDocStore } from '../state/manuscriptDoc'
import { openDocumentTab, openReviewImportTab, openRoundTab } from '../state/dock'
import { ManuscriptView } from '../views/ManuscriptView'
import { DocumentOutline } from './DocumentOutline'
import { NewLetterSheet } from './NewLetterSheet'
import { NewRoundSheet } from './NewRoundSheet'
import './documents.css'

/**
 * The Documents sidebar view (document-kinds-ux.md §A.1).
 *
 * Replaces the Manuscript view in the activity bar without replacing what it
 * did: the manuscript's outline is still the body of this panel, because that
 * is what a user is looking at 95% of the time. What changes is that the
 * manuscript is no longer the ONLY thing listed, and there is now one visible
 * button that adds a document.
 */

const KIND_LABEL: Record<string, string> = {
  'cover-letter': 'Letter',
  response: 'Response',
  report: 'Report',
  supplement: 'Supplement',
  package: 'Package',
  component: 'Component'
}

export function DocumentsView(): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const saveBump = useProjectStore((s) => s.saveBump)
  const documents = useDocumentsStore((s) => s.documents)
  const rounds = useDocumentsStore((s) => s.rounds)
  const activeDocumentId = useManuscriptDocStore((s) => s.activeDocumentId)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sheet, setSheet] = useState<'letter' | 'round' | null>(null)

  useEffect(() => {
    refreshDocuments()
  }, [rootDir, saveBump])

  const others = secondaryDocuments(documents)

  return (
    <div className="docs">
      <div className="docs__header">
        {/* The shell renders the panel's own title; a second one is noise. */}
        <div className="docs__new-wrap">
          <button
            className="docs__new"
            title="New document"
            aria-label="New document"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            disabled={rootDir === null}
          >
            +
          </button>
          {menuOpen && (
            <>
              <div className="docs__menu-scrim" onClick={() => setMenuOpen(false)} role="presentation" />
              <ul className="docs__menu" role="menu">
                <li>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      setSheet('letter')
                    }}
                  >
                    Cover letter…
                  </button>
                </li>
                <li>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      setSheet('round')
                    }}
                  >
                    Development round…
                  </button>
                </li>
                <li>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      if (rootDir !== null) openReviewImportTab(rootDir)
                    }}
                  >
                    Import reviewer comments…
                  </button>
                </li>
              </ul>
            </>
          )}
        </div>
      </div>

      {others.length > 0 && (
        <ul className="docs__list">
          {others.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} rootDir={rootDir} />
          ))}
        </ul>
      )}

      {rounds.length > 0 && (
        <>
          <div className="docs__section">Rounds</div>
          <ul className="docs__list">
            {rounds.map((round) => (
              <li key={round.id}>
                <button
                  className="docs__row"
                  onClick={() => rootDir !== null && openRoundTab(rootDir, round.id)}
                  title={round.label}
                >
                  <span className={`docs__badge docs__badge--${round.kind}`}>
                    {round.kind === 'internal' ? 'int' : 'ext'}
                  </span>
                  <span className="docs__row-title">{round.label}</span>
                  <span className="docs__row-meta">{round.decision ?? round.state}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/*
        The outline follows whichever document tab is frontmost. The manuscript
        keeps its full view — title-page metadata, figure and table counts —
        because that is what people are looking at most of the time; another
        kind gets a plain outline, since "2 figures, 1 table" under a cover
        letter would be describing a different document.
      */}
      <div className="docs__outline">
        {activeDocumentId === null || activeDocumentId === 'manuscript' ? (
          <ManuscriptView />
        ) : (
          <DocumentOutline
            documentId={activeDocumentId}
            title={
              documents.find((d) => d.id === activeDocumentId)?.title ?? activeDocumentId
            }
          />
        )}
      </div>

      {sheet === 'letter' && <NewLetterSheet onClose={() => setSheet(null)} />}
      {sheet === 'round' && <NewRoundSheet onClose={() => setSheet(null)} />}
    </div>
  )
}

function DocumentRow({
  doc,
  rootDir
}: {
  doc: DocumentEntry
  rootDir: string | null
}): JSX.Element {
  return (
    <li>
      <button
        className="docs__row"
        onClick={() => rootDir !== null && openDocumentTab(rootDir, doc.id, doc.kind, doc.file)}
        title={doc.file ?? doc.title}
      >
        <span className="docs__badge">{KIND_LABEL[doc.kind] ?? doc.kind}</span>
        <span className="docs__row-title">{doc.title}</span>
      </button>
    </li>
  )
}
