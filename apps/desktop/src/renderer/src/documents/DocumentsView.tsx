import { useEffect, useState, type JSX } from 'react'
import type { DocumentEntry } from '@suna/core'
import { stageLabel, versionsNewestFirst } from '@suna/core'
import { useProjectStore } from '../state/project'
import { useDocumentsStore, refreshDocuments, secondaryDocuments } from '../state/documents'
import { useManuscriptDocStore } from '../state/manuscriptDoc'
import { openDocumentTab, openManuscriptTab, openRoundTab, openVersionTab } from '../state/dock'
import { ManuscriptView } from '../views/ManuscriptView'
import { DocumentOutline } from './DocumentOutline'
import { LetterList } from './LetterList'
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
  const versions = useDocumentsStore((s) => s.versions)
  const missing = useDocumentsStore((s) => s.missing)
  const activeDocumentId = useManuscriptDocStore((s) => s.activeDocumentId)

  useEffect(() => {
    refreshDocuments()
  }, [rootDir, saveBump])

  const secondary = secondaryDocuments(documents)
  const letters = secondary.filter((d) => d.kind === 'cover-letter')
  const others = secondary.filter((d) => d.kind !== 'cover-letter')
  const isManuscript = activeDocumentId === null || activeDocumentId === 'manuscript'
  const activeIsLetter = letters.some((d) => d.id === activeDocumentId)

  // Letters are reachable from the panel even before one is open: clicking the
  // group row shows the list without changing which tab is frontmost. Opening
  // any document hands the lower panel back to whatever that document is.
  const [lettersPicked, setLettersPicked] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  useEffect(() => {
    setLettersPicked(false)
  }, [activeDocumentId])
  const showLetters = activeIsLetter || lettersPicked

  return (
    <div className="docs">
      {/*
        The manuscript is always the first row, even while a letter is
        frontmost. Without it, opening a letter left the panel showing only
        that letter — the way back to the manuscript (or to any other
        document) had disappeared from the view whose whole job is listing
        them.
      */}
      <ul className="docs__list">
        <li>
          <button
            className={`docs__row${isManuscript && !showLetters ? ' docs__row--current' : ''}`}
            onClick={() => {
              // Clearing the pick explicitly: picking Letters does not change
              // which tab is frontmost, so when the manuscript was already the
              // active document the effect below never fires and the panel
              // would have stayed on the letters list with no way back.
              setLettersPicked(false)
              if (rootDir !== null) openManuscriptTab(rootDir)
            }}
            disabled={rootDir === null}
            title="Manuscript"
          >
            <span className="docs__row-title">Manuscript</span>
          </button>
        </li>
      </ul>

      {letters.length > 0 && (
        <ul className="docs__list">
          <li>
            <button
              className={`docs__row${showLetters ? ' docs__row--current' : ''}`}
              onClick={() => setLettersPicked(true)}
              title="Letters"
            >
              <span className="docs__row-title">Letters</span>
            </button>
          </li>
        </ul>
      )}

      {others.length > 0 && (
        <ul className="docs__list">
          {others.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              rootDir={rootDir}
              missing={missing.includes(doc.id)}
              current={activeDocumentId === doc.id && !showLetters}
              onOpen={() => setLettersPicked(false)}
            />
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
                  onClick={() => {
                    setLettersPicked(false)
                    if (rootDir !== null) openRoundTab(rootDir, round.id)
                  }}
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
        kind gets a plain outline. Letters get neither: they are one flat page,
        so the panel lists the project's letters instead — an outline of a
        cover letter is either empty or a single "untitled" row.
      */}
      <div className="docs__outline">
        {showLetters ? (
          <LetterList
            letters={letters}
            rootDir={rootDir}
            activeDocumentId={activeDocumentId}
          />
        ) : isManuscript ? (
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

      {/*
        Versions sits at the FOOT of the panel, below the outline: it is the
        manuscript's history, not one of the documents, and nothing in it is
        what the author is working on. Collapsed by default — a paper that has
        been through three rounds has a dozen of them.
      */}
      {versions.length > 0 && (
        <div className="docs__versions">
          <button
            className="docs__row docs__row-disclosure"
            onClick={() => setVersionsOpen((v) => !v)}
            aria-expanded={versionsOpen}
            title="Logged versions"
          >
            <span className={`docs__twisty${versionsOpen ? ' is-open' : ''}`} aria-hidden="true">
              ›
            </span>
            <span className="docs__row-title">Versions</span>
            <span className="docs__row-meta">{versions.length}</span>
          </button>
          {versionsOpen && (
            <ul className="docs__list docs__versions-list">
              {versionsNewestFirst(versions).map((v) => (
                <li key={v.id}>
                  <button
                    className="docs__row docs__row--nested"
                    onClick={() => {
                      setLettersPicked(false)
                      if (rootDir !== null) openVersionTab(rootDir, v.id)
                    }}
                    title={`${stageLabel(v.stage)} — read-only`}
                  >
                    <span className="docs__badge">{v.id}</span>
                    <span className="docs__row-title">{stageLabel(v.stage)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function DocumentRow({
  doc,
  rootDir,
  missing,
  current,
  onOpen
}: {
  doc: DocumentEntry
  rootDir: string | null
  missing: boolean
  /** This document's tab is the frontmost one — the row the outline below belongs to. */
  current: boolean
  /** Hand the lower panel back to this document when its row is clicked. */
  onOpen: () => void
}): JSX.Element {
  // The filename, not the folder. Two letters to the same journal can carry
  // the same title, and the thing that tells them apart is the file — so the
  // row shows it rather than making the user open both to find out.
  const fileName = doc.file === null ? null : (doc.file.split('/').pop() ?? doc.file)

  if (missing) {
    return (
      <li>
        <div className="docs__row docs__row--missing" title={doc.file ?? doc.title}>
          <span className="docs__badge">{KIND_LABEL[doc.kind] ?? doc.kind}</span>
          <span className="docs__row-body">
            <span className="docs__row-title">{doc.title}</span>
            <span className="docs__row-file">file is gone — {fileName}</span>
          </span>
          <button
            className="docs__row-forget"
            title="Remove from the registry. Deletes nothing."
            onClick={() => {
              if (rootDir !== null) void useDocumentsStore.getState().remove(rootDir, doc.id)
            }}
          >
            Forget
          </button>
        </div>
      </li>
    )
  }

  return (
    <li>
      <button
        className={`docs__row${current ? ' docs__row--current' : ''}`}
        onClick={() => {
          onOpen()
          if (rootDir !== null) openDocumentTab(rootDir, doc.id, doc.kind, doc.file)
        }}
        title={doc.file ?? doc.title}
      >
        <span className="docs__badge">{KIND_LABEL[doc.kind] ?? doc.kind}</span>
        <span className="docs__row-body">
          <span className="docs__row-title">{doc.title}</span>
          {fileName !== null && <span className="docs__row-file">{fileName}</span>}
        </span>
      </button>
    </li>
  )
}
