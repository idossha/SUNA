import { useRef, useState, type JSX } from 'react'
import { useProjectStore } from '../state/project'
import { openReviewImportTab } from '../state/dock'
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
