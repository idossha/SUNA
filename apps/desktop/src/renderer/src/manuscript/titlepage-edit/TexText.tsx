import { useMemo, type JSX } from 'react'
import katex from 'katex'
import { splitTexSpans } from '../title-page'

/**
 * Prose with $...$ spans rendered through KaTeX (title, abstract,
 * significance, highlights). Shared by TitlePage's static rendering and the
 * titlepage-edit editors (e.g. a highlight row's non-editing display).
 */
export function TexText({ text }: { text: string }): JSX.Element {
  const segments = useMemo(() => splitTexSpans(text), [text])
  return (
    <>
      {segments.map((segment, i) =>
        segment.kind === 'math' ? (
          <span
            key={i}
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(segment.value, { throwOnError: false })
            }}
          />
        ) : (
          <span key={i}>{segment.value}</span>
        )
      )}
    </>
  )
}
