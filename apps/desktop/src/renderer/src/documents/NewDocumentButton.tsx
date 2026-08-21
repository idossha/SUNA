import { useRef, useState, type JSX } from 'react'
import { useProjectStore } from '../state/project'
import { useDocumentsStore, refreshDocuments } from '../state/documents'
import { useUiStore } from '../state/ui'
import { openReviewImportTab, openSupplementTab } from '../state/dock'
import { NewDocumentMenu } from './NewDocumentMenu'
import { NewLetterSheet } from './NewLetterSheet'
import './documents.css'

/**
 * The Writing view's "+" — the one visible way to add a document.
 *
 * Keeping a version of the manuscript is NOT here: it is not a new document,
 * it is a copy of the one you are already writing, so it lives as its own
 * button on the manuscript row (DocumentsView) instead.
 *
 * It lives in the sidebar's own header, beside the view title, where the
 * Explorer puts its new-file/new-folder actions (shell/SideBar). Rendering it
 * inside the panel body cost a whole row of vertical space and put the
 * control further from the label it belongs to.
 */
export function NewDocumentButton(): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const documents = useDocumentsStore((s) => s.documents)
  // Exactly one supplement per project: its path is fixed
  // (manuscript/supplementary.md — the path the export pipeline reads), so a
  // second one would have nowhere to live. The item disappears once the
  // project has it rather than sitting there disabled.
  const hasSupplement = documents.some((d) => d.kind === 'supplement' && !d.archived)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sheet, setSheet] = useState<'letter' | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  return (
    <span className="docs__new-wrap">
      <button
        ref={btnRef}
        className="docs__new"
        title="New document"
        aria-label="New document"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        disabled={rootDir === null}
      >
        +
      </button>
      {menuOpen && btnRef.current !== null && (
        <NewDocumentMenu
          anchorEl={btnRef.current}
          onClose={() => setMenuOpen(false)}
          items={[
            { label: 'Cover letter…', onSelect: () => setSheet('letter') },
            ...(hasSupplement
              ? []
              : [
                  {
                    label: 'Supplementary Information',
                    onSelect: () => {
                      void addSupplement(rootDir)
                    }
                  }
                ]),
            {
              label: 'Import reviewer comments…',
              onSelect: () => {
                if (rootDir !== null) openReviewImportTab(rootDir)
              }
            }
          ]}
        />
      )}
      {sheet === 'letter' && <NewLetterSheet onClose={() => setSheet(null)} />}
    </span>
  )
}

/**
 * Create the Supplementary Information and open it.
 *
 * No sheet: there is one per project, at one fixed path, with nothing to
 * choose. An existing supplementary.md is adopted rather than overwritten
 * (main/services/supplement-new.ts), which is the case for every project that
 * wrote one before it was a document.
 */
async function addSupplement(rootDir: string | null): Promise<void> {
  if (rootDir === null) return
  try {
    const res = await window.suna.invoke('supplement:new', { dir: rootDir })
    refreshDocuments()
    openSupplementTab(rootDir, res.documentId, res.proseFile)
    if (!res.fileCreated) {
      useUiStore
        .getState()
        .setStatusNote(`Adopted the manuscript/${res.proseFile} already in this project.`)
    }
  } catch (err) {
    useUiStore
      .getState()
      .setStatusNote(
        `Could not add Supplementary Information — ${err instanceof Error ? err.message : String(err)}`
      )
  }
}
