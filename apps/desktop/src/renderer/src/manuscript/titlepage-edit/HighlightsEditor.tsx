import { useState, type JSX } from 'react'
import { commitManuscriptPatch } from './commit'
import { EditableBlock } from './EditableBlock'
import { TexText } from './TexText'
import { addHighlight, highlightsPatch, removeHighlight, reorderHighlight, updateHighlight } from './patches'
import { useInlineField } from './useInlineField'

function HighlightRow({
  rootDir,
  highlights,
  index
}: {
  rootDir: string
  highlights: readonly string[]
  index: number
}): JSX.Element {
  const value = highlights[index] ?? ''
  const field = useInlineField({
    rootDir,
    value,
    validate: (raw) =>
      raw.trim() === '' ? 'Highlight text cannot be empty — use the remove button instead.' : null,
    buildPatch: (raw) => highlightsPatch(updateHighlight(highlights, index, raw))
  })
  return (
    <EditableBlock className="msdoc__front-text tp__highlight-text" field={field} ariaLabel="highlight">
      <TexText text={value} />
    </EditableBlock>
  )
}

/**
 * List add/remove/reorder for manuscript.highlights, each item independently
 * click-to-edit (EditableBlock) for its text. Structural ops (add/remove/
 * reorder) commit immediately — they're discrete clicks, not typed text.
 */
export function HighlightsEditor({
  rootDir,
  highlights
}: {
  rootDir: string
  highlights: readonly string[]
}): JSX.Element {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftNew, setDraftNew] = useState('')

  const runStructural = async (next: string[]): Promise<boolean> => {
    setPending(true)
    const result = await commitManuscriptPatch(rootDir, highlightsPatch(next))
    setPending(false)
    setError(result.ok ? null : result.error)
    return result.ok
  }

  const onAdd = async (): Promise<void> => {
    const text = draftNew.trim()
    if (text === '') return
    const ok = await runStructural(addHighlight(highlights, text))
    if (ok) setDraftNew('')
  }

  return (
    <div className="tp__highlights-list">
      {highlights.map((_, i) => (
        // eslint-disable-next-line react/no-array-index-key -- highlights are plain strings with no stable id
        <div key={i} className="tp__highlight-row">
          <HighlightRow rootDir={rootDir} highlights={highlights} index={i} />
          <div className="tp__highlight-controls">
            <button
              type="button"
              className="tp__move-highlight-up"
              disabled={pending || i === 0}
              onClick={() => void runStructural(reorderHighlight(highlights, i, -1))}
              aria-label="Move highlight up"
            >
              ↑
            </button>
            <button
              type="button"
              className="tp__move-highlight-down"
              disabled={pending || i === highlights.length - 1}
              onClick={() => void runStructural(reorderHighlight(highlights, i, 1))}
              aria-label="Move highlight down"
            >
              ↓
            </button>
            <button
              type="button"
              className="tp__remove-highlight"
              disabled={pending}
              onClick={() => void runStructural(removeHighlight(highlights, i))}
              aria-label="Remove highlight"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      <div className="tp__add-highlight-row">
        <input
          className="tp__add-highlight-input"
          placeholder="New highlight…"
          value={draftNew}
          disabled={pending}
          onChange={(e) => setDraftNew(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void onAdd()
            }
          }}
        />
        <button
          type="button"
          className="tp__add-highlight"
          disabled={pending || draftNew.trim() === ''}
          onClick={() => void onAdd()}
        >
          + Add highlight
        </button>
      </div>
      {error !== null && <div className="tp__field-error">{error}</div>}
    </div>
  )
}
