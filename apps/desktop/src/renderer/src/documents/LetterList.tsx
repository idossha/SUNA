import type { JSX } from 'react'
import type { DocumentEntry } from '@suna/core'
import { useDocumentsStore } from '../state/documents'
import { useProjectStore } from '../state/project'
import { isBundledProfileId, profileLabel } from '../state/renderProfile'
import { openDocumentTab } from '../state/dock'
import './documents.css'

/**
 * The lower panel while Letters is selected (document-kinds-ux.md §A.1).
 *
 * A letter has no section structure worth an outline — the manuscript's
 * extended outline under a one-page cover letter was describing a document
 * that isn't there. So the panel that carries the manuscript's outline
 * carries, for letters, the list of letters instead.
 */
export function LetterList({
  letters,
  rootDir,
  activeDocumentId
}: {
  letters: readonly DocumentEntry[]
  rootDir: string | null
  activeDocumentId: string | null
}): JSX.Element {
  const missing = useDocumentsStore((s) => s.missing)
  const activeProfileId = useProjectStore((s) => s.manifest?.activeProfileId ?? null)

  if (letters.length === 0) {
    return (
      <div className="docout">
        <p className="docout__empty">No letters in this project.</p>
      </div>
    )
  }

  return (
    <div className="docout">
      <ul className="docout__list">
        {letters.map((doc) => {
          const gone = missing.includes(doc.id)
          return (
            <li key={doc.id}>
              <button
                className={`letters__row${activeDocumentId === doc.id ? ' is-active' : ''}`}
                disabled={gone || rootDir === null}
                title={doc.file ?? doc.title}
                onClick={() => {
                  if (rootDir !== null) openDocumentTab(rootDir, doc.id, doc.kind, doc.file)
                }}
              >
                <span className="letters__row-title">{doc.title}</span>
                <span className="letters__row-sub">
                  {gone ? 'file is gone' : journalLabel(doc, activeProfileId)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * The letter's target journal. A letter with no profile of its own inherits
 * the project's active one — the same rule the formatter applies — so the row
 * shows what the letter would actually be checked against, not a blank.
 */
function journalLabel(doc: DocumentEntry, activeProfileId: string | null): string {
  const id = doc.profile?.registry === 'journal' ? doc.profile.id : activeProfileId
  if (id === null || id === undefined) return 'no journal set'
  return isBundledProfileId(id) ? profileLabel(id) : id
}
