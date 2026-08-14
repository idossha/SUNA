import { useMemo, type JSX } from 'react'
import type { Affiliation, Author } from '@suna/core'
import { numberAffiliations } from '../title-page'
import {
  affiliationsPatch,
  blankAffiliation,
  moveAffiliationById,
  removeAffiliationById,
  updateAffiliation,
  validateAffiliations
} from './patches'
import { useArrayField } from './useArrayField'

/**
 * Compact row editor: order (up/down), text, remove, add. The number on each
 * row is the DERIVED superscript (numberAffiliations — first appearance in
 * author order, unreferenced affiliations after), i.e. exactly the marker the
 * rendered title page shows, so the editor never displays a number the reader
 * will not see. Rows themselves stay in manuscript.json array order, which is
 * what up/down reorders.
 */
export function AffiliationsEditor({
  rootDir,
  affiliations,
  authors
}: {
  rootDir: string
  affiliations: readonly Affiliation[]
  authors: readonly Author[]
}): JSX.Element {
  const field = useArrayField<Affiliation>({
    rootDir,
    value: affiliations,
    buildPatch: affiliationsPatch,
    validate: validateAffiliations
  })
  const numberOf = useMemo(
    () => numberAffiliations(authors, field.list).numberOf,
    [authors, field.list]
  )

  return (
    <div className="tp__affiliations-editor">
      {field.list.map((affiliation, i) => (
        <div key={affiliation.id} className="tp__affiliation-row">
          <span className="tp__affiliation-num">{numberOf.get(affiliation.id) ?? i + 1}</span>
          <input
            className="tp__affiliation-text"
            value={affiliation.text}
            placeholder="Affiliation"
            onChange={(e) =>
              field.edit(updateAffiliation(field.list, affiliation.id, { text: e.target.value }))
            }
            onBlur={field.flush}
          />
          <div className="tp__affiliation-controls">
            <button
              type="button"
              className="tp__affiliation-move-up"
              disabled={i === 0}
              onClick={() => field.mutate(moveAffiliationById(field.list, affiliation.id, -1))}
              aria-label="Move affiliation up"
            >
              ↑
            </button>
            <button
              type="button"
              className="tp__affiliation-move-down"
              disabled={i === field.list.length - 1}
              onClick={() => field.mutate(moveAffiliationById(field.list, affiliation.id, 1))}
              aria-label="Move affiliation down"
            >
              ↓
            </button>
            <button
              type="button"
              className="tp__affiliation-remove"
              onClick={() => field.mutate(removeAffiliationById(field.list, affiliation.id))}
              aria-label="Remove affiliation"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="tp__add-affiliation"
        onClick={() => field.mutate([...field.list, blankAffiliation(field.list)])}
      >
        + Add affiliation
      </button>
      {field.error !== null && <div className="tp__field-error">{field.error}</div>}
    </div>
  )
}
