import type { JSX } from 'react'
import type { DocumentEntry } from '@suna/core'
import { docSlice, useManuscriptDocStore } from '../state/manuscriptDoc'
import { useProjectStore } from '../state/project'
import { openDocumentTab } from '../state/dock'
import { OutlineList } from '../views/OutlineList'
import './documents.css'

/**
 * The outline of a non-manuscript document (document-kinds-ux.md §A.1).
 *
 * The same list the manuscript gets — same rows, same chips, same rolled-up
 * word counts, same collapse twisties (views/OutlineList) — because a
 * supplement is read the same way a manuscript is, and two outlines that
 * looked and behaved differently for no reason was the whole bug.
 *
 * What stays document-specific is the heading and what a click does: the
 * document's own tab is brought to the front before the scroll, since "take
 * me to Supplementary Methods" is meaningless while the supplement is not the
 * frontmost tab.
 */
export function DocumentOutline({ doc }: { doc: DocumentEntry }): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const slice = useManuscriptDocStore((s) => docSlice(s, doc.id))

  return (
    <div className="docout">
      <OutlineList
        title={doc.title}
        sections={slice.outline}
        activeIndex={slice.activeSectionIndex}
        highlightActive={slice.tabActive}
        disabled={rootDir === null}
        emptyLabel={
          slice.tabMounted
            ? 'No headings in this document.'
            : 'Open the document to see its outline.'
        }
        onPick={(index) => {
          if (rootDir === null) return
          openDocumentTab(rootDir, doc.id, doc.kind, doc.file, doc.title)
          useManuscriptDocStore.getState().requestScroll(doc.id, index)
        }}
      />
    </div>
  )
}
