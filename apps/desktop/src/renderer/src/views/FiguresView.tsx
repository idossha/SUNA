import { useEffect, useMemo, useState, type JSX } from 'react'
import { useProjectStore } from '../state/project'
import { openFileTab } from '../state/dock'
import { parseFigureMeta, scanFigures, svgDataUrl, type FigureHit } from './figures-scan'
import './views.css'

interface FigureCard {
  hit: FigureHit
  thumbUrl: string | null
  captionTitle: string | null
  widthPreset: 'single' | 'double' | null
}

async function loadCard(hit: FigureHit): Promise<FigureCard> {
  let thumbUrl: string | null = null
  try {
    const { content } = await window.suna.invoke('fs:read-text', { path: hit.svgPath })
    thumbUrl = svgDataUrl(content)
  } catch {
    // unreadable svg — show a placeholder
  }
  let captionTitle: string | null = null
  let widthPreset: 'single' | 'double' | null = null
  try {
    const { content } = await window.suna.invoke('fs:read-text', { path: hit.jsonPath })
    const meta = parseFigureMeta(content)
    captionTitle = meta.captionTitle
    widthPreset = meta.widthPreset
  } catch {
    // figure.json is optional
  }
  return { hit, thumbUrl, captionTitle, widthPreset }
}

export function FiguresView(): JSX.Element {
  const tree = useProjectStore((s) => s.tree)
  const saveBump = useProjectStore((s) => s.saveBump)
  const hits = useMemo(() => scanFigures(tree), [tree])
  const [cards, setCards] = useState<FigureCard[]>([])

  useEffect(() => {
    let cancelled = false
    void Promise.all(hits.map(loadCard)).then((loaded) => {
      if (!cancelled) setCards(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [hits, saveBump])

  if (hits.length === 0) {
    return (
      <p className="sidebar__empty">
        No figures found. Each figure lives in figures/&lt;id&gt;/ with a figure.svg canvas.
      </p>
    )
  }

  return (
    <div className="view figs">
      {cards.map((card) => (
        <button
          key={card.hit.dirPath}
          className="figs__card"
          onClick={() => openFileTab(card.hit.svgPath)}
          title={`Open ${card.hit.id} on the canvas`}
        >
          {card.thumbUrl !== null ? (
            <span className="figs__thumb">
              <img src={card.thumbUrl} alt={card.hit.id} draggable={false} />
            </span>
          ) : (
            <span className="figs__thumb figs__thumb--missing">no preview</span>
          )}
          <span className="figs__caption">
            <span className="figs__name">{card.hit.id}</span>
            {card.widthPreset !== null && <span className="chip">{card.widthPreset}</span>}
          </span>
          {card.captionTitle !== null && <span className="figs__title">{card.captionTitle}</span>}
        </button>
      ))}
    </div>
  )
}
