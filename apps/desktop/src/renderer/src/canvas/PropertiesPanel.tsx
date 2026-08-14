import { useEffect, useState, type JSX } from 'react'
import { interact, type CanvasDocument } from '@suna/canvas'
import type { CanvasCommand, PublisherProfile } from '@suna/core'
import { AlignSection } from './AlignSection'
import { firstNumber, fmt, styleValue, toHexColor, type WorldRect } from './canvas-util'
import { ExportSection } from './ExportSection'
import { NumberField } from './fields'
import { FigureSection } from './FigureSection'
import { PaletteSection } from './PaletteSection'
import type { Diagnostic } from '@suna/formatter'

/** 1 pt = 0.3528 mm (canvas-engine.md §2). */
const MM_PER_PT = 0.3528

interface PropertiesPanelProps {
  doc: CanvasDocument | null
  rev: number
  selectedIds: string[]
  open: boolean
  onToggle: () => void
  mmPerUser: number | null
  profile: PublisherProfile | null
  worldBboxOf: (id: string) => WorldRect | null
  rotationOf: (id: string) => number
  /** One-shot edit → one history entry. */
  apply: (command: CanvasCommand, label: string) => boolean
  /** Continuous control gesture → debounced into one history transaction. */
  gestureApply: (command: CanvasCommand, label: string) => void
  /** Project + figure identity, for Duplicate/Export/Palette persistence. */
  rootDir: string | null
  figureId: string | null
  diagnostics: Diagnostic[]
  note: (text: string) => void
  /** Ensures figure.svg on disk matches the editor before an export reads it. */
  save: () => Promise<void>
}

/** Color control: swatch + hex field + none toggle (+ optional palette row). */
function ColorControl(props: {
  label: string
  value: string | null
  palette: string[]
  onChange: (value: string, continuous: boolean) => void
  onNone: () => void
}): JSX.Element {
  const hex = toHexColor(props.value)
  const isNone = props.value === 'none' || props.value === null
  const [text, setText] = useState(hex ?? '')
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setText(hex ?? '')
  }, [hex, editing])
  return (
    <div className="canvas-props__color">
      <div className="canvas-props__color-row">
        <span className="canvas-props__color-label">{props.label}</span>
        <input
          type="color"
          className="canvas-props__swatch"
          value={hex ?? '#000000'}
          onChange={(e) => props.onChange(e.target.value, true)}
          title={`${props.label} color`}
        />
        <input
          className="canvas-props__hex"
          value={text}
          placeholder={isNone ? 'none' : ''}
          spellCheck={false}
          onFocus={() => setEditing(true)}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            setEditing(false)
            const v = text.trim()
            if (v !== '' && /^#[0-9a-fA-F]{3,6}$/.test(v) && v !== hex) props.onChange(v, false)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
        <button
          className={`canvas-props__none${isNone ? ' canvas-props__none--active' : ''}`}
          title={`No ${props.label.toLowerCase()}`}
          onClick={props.onNone}
        >
          ∅
        </button>
      </div>
      {props.palette.length > 0 && (
        <div className="canvas-props__palette">
          {props.palette.map((c) => (
            <button
              key={c}
              className="canvas-props__chip"
              style={{ background: c }}
              title={c}
              aria-pressed={hex === c.toLowerCase()}
              onClick={() => props.onChange(c, false)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Properties panel (spec §5): reads the ENGINE document (attributes) and the
 * mirror-derived world bboxes (geometry); every edit dispatches
 * set-style/set-attrs/transform commands through the host.
 */
export function PropertiesPanel(props: PropertiesPanelProps): JSX.Element {
  const { doc, selectedIds, open, onToggle, mmPerUser, profile, apply, gestureApply } = props

  if (!open) {
    return (
      <div className="canvas-side canvas-side--collapsed canvas-side--right">
        <button className="canvas-side__expand" title="Show properties" onClick={onToggle}>
          ‹
        </button>
        <span className="canvas-side__collapsed-label">Properties</span>
      </div>
    )
  }

  const firstId = selectedIds[0]
  const el = doc && firstId !== undefined ? doc.getById(firstId) : null
  const single = selectedIds.length === 1

  const body = ((): JSX.Element | null => {
    if (!doc || !el || firstId === undefined) {
      return null
    }

    const bboxes = selectedIds
      .map((id) => props.worldBboxOf(id))
      .filter((b): b is WorldRect => b !== null)
    const bbox = interact.unionRects(bboxes)
    const userToPt = mmPerUser !== null ? mmPerUser / MM_PER_PT : 1
    const userPerPt = userToPt !== 0 ? 1 / userToPt : 1
    const palette = profile?.figures.palette.suggestedHex ?? interact.DEFAULT_SHAPE_DEFAULTS.palette
    const isText = el.localName === 'text'

    const forAll = (make: (target: string) => CanvasCommand): CanvasCommand => {
      const first = selectedIds[0] as string
      if (selectedIds.length === 1) return make(first)
      return { kind: 'batch', commands: selectedIds.map(make) }
    }
    const setStyleAll = (prop: string, value: string | null): CanvasCommand =>
      forAll((target) => ({ kind: 'set-style', target, props: { [prop]: value } }))

    const scaleAll = (sx: number, sy: number, origin: { x: number; y: number }): void => {
      const matrix: [number, number, number, number, number, number] = [
        sx,
        0,
        0,
        sy,
        origin.x * (1 - sx),
        origin.y * (1 - sy)
      ]
      apply(
        forAll((target) => ({ kind: 'transform', target, matrix, mode: 'compose' })),
        'Resize'
      )
    }

    // ---- current values (engine document, never the mirror) ----------------
    const fill = styleValue(el, 'fill')
    const stroke = styleValue(el, 'stroke')
    const strokeWidthUser = firstNumber(styleValue(el, 'stroke-width')) ?? 1
    const dash = styleValue(el, 'stroke-dasharray')
    const opacity = firstNumber(styleValue(el, 'opacity')) ?? 1
    const fontSizeUser = firstNumber(styleValue(el, 'font-size'))
    const fontSizePt = fontSizeUser !== null ? fontSizeUser * userToPt : null
    const fontFamily = styleValue(el, 'font-family') ?? ''
    const fontWeight = styleValue(el, 'font-weight') ?? 'normal'
    const rotation = single ? props.rotationOf(firstId) : 0

    const minFontPt = profile?.figures.minFontPt ?? null
    const maxFontPt = profile?.figures.maxFontPt ?? null
    const fontViolation =
      fontSizePt !== null &&
      ((minFontPt !== null && fontSizePt < minFontPt - 1e-6) ||
        (maxFontPt !== null && fontSizePt > maxFontPt + 1e-6))
        ? `Profile wants ${minFontPt ?? '…'}–${maxFontPt ?? '…'} pt`
        : null

    const dashPresets: { name: string; value: string | null }[] = [
      { name: 'Solid', value: null },
      { name: 'Dash', value: `${fmt(4 * userPerPt)},${fmt(2 * userPerPt)}` },
      { name: 'Dot', value: `${fmt(1 * userPerPt)},${fmt(1.6 * userPerPt)}` }
    ]

    return (
      <>
        <div className="canvas-props__section">
          <div className="canvas-props__title">Geometry</div>
          <div className="canvas-props__grid">
            <NumberField
              label="X"
              value={bbox?.x ?? null}
              onCommit={(n) => {
                if (!bbox) return
                apply(
                  { kind: 'translate', targets: [...selectedIds], dx: n - bbox.x, dy: 0 },
                  'Set x'
                )
              }}
            />
            <NumberField
              label="Y"
              value={bbox?.y ?? null}
              onCommit={(n) => {
                if (!bbox) return
                apply(
                  { kind: 'translate', targets: [...selectedIds], dx: 0, dy: n - bbox.y },
                  'Set y'
                )
              }}
            />
            <NumberField
              label="W"
              value={bbox?.width ?? null}
              onCommit={(n) => {
                if (bbox && bbox.width > 1e-9 && n > 0) scaleAll(n / bbox.width, 1, bbox)
              }}
            />
            <NumberField
              label="H"
              value={bbox?.height ?? null}
              onCommit={(n) => {
                if (bbox && bbox.height > 1e-9 && n > 0) scaleAll(1, n / bbox.height, bbox)
              }}
            />
            <NumberField
              label="∠"
              value={rotation}
              disabled={!single}
              onCommit={(n) => {
                if (!bbox) return
                const delta = n - rotation
                if (Math.abs(delta) < 1e-6) return
                apply(
                  {
                    kind: 'transform',
                    target: firstId,
                    matrix: interact.rotationMatrix(interact.rectCenter(bbox), delta),
                    mode: 'compose'
                  },
                  'Rotate'
                )
              }}
            />
          </div>
          {bbox && mmPerUser !== null && (
            <div className="canvas-props__mm">
              {(bbox.width * mmPerUser).toFixed(1)} × {(bbox.height * mmPerUser).toFixed(1)} mm
            </div>
          )}
        </div>

        <div className="canvas-props__section">
          <div className="canvas-props__title">Fill</div>
          <ColorControl
            label="Fill"
            value={fill}
            palette={palette}
            onChange={(v, continuous) => {
              const cmd = setStyleAll('fill', v)
              if (continuous) gestureApply(cmd, 'Fill')
              else apply(cmd, 'Fill')
            }}
            onNone={() => apply(setStyleAll('fill', 'none'), 'Fill none')}
          />
        </div>

        <div className="canvas-props__section">
          <div className="canvas-props__title">Stroke</div>
          <ColorControl
            label="Stroke"
            value={stroke}
            palette={[]}
            onChange={(v, continuous) => {
              const cmd = setStyleAll('stroke', v)
              if (continuous) gestureApply(cmd, 'Stroke')
              else apply(cmd, 'Stroke')
            }}
            onNone={() => apply(setStyleAll('stroke', 'none'), 'Stroke none')}
          />
          <div className="canvas-props__grid">
            <NumberField
              label="W pt"
              value={strokeWidthUser * userToPt}
              step={0.25}
              onCommit={(n) => {
                if (n <= 0) return
                apply(setStyleAll('stroke-width', fmt(n * userPerPt)), 'Stroke width')
              }}
            />
          </div>
          <div className="canvas-props__segmented">
            {dashPresets.map((p) => (
              <button
                key={p.name}
                aria-pressed={p.value === null ? dash === null || dash === 'none' : dash === p.value}
                onClick={() => apply(setStyleAll('stroke-dasharray', p.value), 'Stroke dash')}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {isText && (
          <div className="canvas-props__section">
            <div className="canvas-props__title">Text</div>
            <label className="canvas-props__field canvas-props__field--wide">
              <span>Font</span>
              <input
                list="canvas-font-list"
                defaultValue={fontFamily}
                key={`${firstId}-${fontFamily}`}
                spellCheck={false}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v !== '' && v !== fontFamily) {
                    apply(setStyleAll('font-family', v), 'Font family')
                  }
                }}
              />
              <datalist id="canvas-font-list">
                {(profile?.figures.preferredFontFamilies ?? []).map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </label>
            <div className="canvas-props__grid">
              <NumberField
                label="Size pt"
                value={fontSizePt}
                step={0.5}
                invalid={fontViolation}
                onCommit={(n) => {
                  if (n > 0) apply(setStyleAll('font-size', fmt(n * userPerPt)), 'Font size')
                }}
              />
              <label className="canvas-props__field">
                <span>Weight</span>
                <select
                  value={fontWeight === 'bold' || Number(fontWeight) >= 600 ? 'bold' : 'normal'}
                  onChange={(e) => {
                    apply(
                      setStyleAll('font-weight', e.target.value === 'bold' ? 'bold' : null),
                      'Font weight'
                    )
                  }}
                >
                  <option value="normal">Regular</option>
                  <option value="bold">Bold</option>
                </select>
              </label>
            </div>
          </div>
        )}

        <div className="canvas-props__section">
          <div className="canvas-props__title">Opacity</div>
          <div className="canvas-props__opacity">
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(opacity * 100)}
              onChange={(e) => {
                const v = Number(e.target.value) / 100
                gestureApply(setStyleAll('opacity', v >= 0.999 ? null : fmt(v)), 'Opacity')
              }}
            />
            <span>{Math.round(opacity * 100)}%</span>
          </div>
        </div>
      </>
    )
  })()

  return (
    <div className="canvas-side canvas-side--right canvas-props">
      <div className="canvas-side__header">
        <button className="canvas-side__chevron" title="Hide properties" onClick={onToggle}>
          ›
        </button>
        <span>Properties</span>
      </div>
      <div className="canvas-props__body">
        <AlignSection selectedIds={selectedIds} apply={apply} />
        <FigureSection
          doc={doc}
          mmPerUser={mmPerUser}
          profile={profile}
          rootDir={props.rootDir}
          figureId={props.figureId}
          apply={apply}
          worldBboxOf={props.worldBboxOf}
          note={props.note}
        />
        <PaletteSection
          profile={profile}
          rootDir={props.rootDir}
          selectedIds={selectedIds}
          apply={apply}
          note={props.note}
        />
        <ExportSection
          doc={doc}
          rootDir={props.rootDir}
          figureId={props.figureId}
          profile={profile}
          diagnostics={props.diagnostics}
          note={props.note}
          save={props.save}
        />
        {body !== null && <div className="canvas-props__divider" />}
        {body}
        {body === null && <div className="canvas-props__empty">No selection</div>}
      </div>
    </div>
  )
}
