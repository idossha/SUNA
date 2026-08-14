import { useEffect, useState, type JSX } from 'react'
import type { ArticleType } from '@suna/core'
import { commitManuscriptPatch } from './commit'
import { articleTypePatch } from './patches'

const ARTICLE_TYPES: { value: ArticleType; label: string }[] = [
  { value: 'article', label: 'Article' },
  { value: 'review', label: 'Review' },
  { value: 'letter', label: 'Letter' }
]

/** Discrete choice — commits immediately on change, no debounce needed. */
export function ArticleTypeField({ rootDir, value }: { rootDir: string; value: ArticleType }): JSX.Element {
  const [override, setOverride] = useState<ArticleType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const shown = override ?? value

  useEffect(() => {
    if (override !== null && override === value) setOverride(null)
  }, [value, override])

  return (
    <label className="tp__meta-field">
      <span className="tp__meta-label">Article type</span>
      <select
        className="tp__article-type"
        value={shown}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as ArticleType
          setOverride(next)
          setPending(true)
          void commitManuscriptPatch(rootDir, articleTypePatch(next)).then((result) => {
            setPending(false)
            setError(result.ok ? null : result.error)
          })
        }}
      >
        {ARTICLE_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      {error !== null && <span className="tp__field-error">{error}</span>}
    </label>
  )
}
