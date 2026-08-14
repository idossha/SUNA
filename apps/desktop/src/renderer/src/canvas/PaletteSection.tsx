import { useEffect, useState, type JSX } from 'react'
import type { CanvasCommand, PublisherProfile } from '@suna/core'
import { buildPaletteRamps, parseImportedPalette, type PaletteRamp } from './palette'

/**
 * Palette section (canvas parity spec §4): swatch ramps with a Fill/Stroke
 * toggle, a "No fill/stroke" chip, and "Import palette…" (a JSON array of
 * hex strings), persisted per-project through the frozen settings IPC —
 * never by importing the settings store directly (its own header comment
 * asks other zones to coordinate via IPC instead).
 */

interface PaletteSectionProps {
  profile: PublisherProfile | null
  rootDir: string | null
  selectedIds: string[]
  apply: (command: CanvasCommand, label: string) => boolean
  note: (text: string) => void
}

const SETTINGS_KEY = 'canvas.customPalettes'

async function loadCustomRamps(rootDir: string): Promise<PaletteRamp[]> {
  const { settings } = await window.suna.invoke('settings:get', {})
  const all = settings[SETTINGS_KEY]
  if (typeof all !== 'object' || all === null) return []
  const forProject = (all as Record<string, unknown>)[rootDir]
  if (!Array.isArray(forProject)) return []
  const ramps: PaletteRamp[] = []
  for (const entry of forProject) {
    if (typeof entry !== 'object' || entry === null) continue
    const name = (entry as Record<string, unknown>)['name']
    const colorsRaw = (entry as Record<string, unknown>)['colors']
    if (typeof name !== 'string' || !Array.isArray(colorsRaw)) continue
    const colors = colorsRaw.filter((c): c is string => typeof c === 'string')
    if (colors.length > 0) ramps.push({ name, colors })
  }
  return ramps
}

async function saveCustomRamp(rootDir: string, ramp: PaletteRamp): Promise<void> {
  const { settings } = await window.suna.invoke('settings:get', {})
  const raw = settings[SETTINGS_KEY]
  const all: Record<string, PaletteRamp[]> =
    typeof raw === 'object' && raw !== null ? { ...(raw as Record<string, PaletteRamp[]>) } : {}
  const existingRaw = all[rootDir]
  const existing = Array.isArray(existingRaw) ? existingRaw : []
  all[rootDir] = [...existing, ramp]
  await window.suna.invoke('settings:set', { patch: { [SETTINGS_KEY]: all } })
}

export function PaletteSection(props: PaletteSectionProps): JSX.Element {
  const { profile, rootDir, selectedIds, apply, note } = props
  const [mode, setMode] = useState<'fill' | 'stroke'>('fill')
  const [customRamps, setCustomRamps] = useState<PaletteRamp[]>([])

  useEffect(() => {
    let cancelled = false
    if (!rootDir) {
      setCustomRamps([])
      return
    }
    void loadCustomRamps(rootDir).then((ramps) => {
      if (!cancelled) setCustomRamps(ramps)
    })
    return () => {
      cancelled = true
    }
  }, [rootDir])

  const ramps = buildPaletteRamps(profile, customRamps)

  const applyColor = (hex: string | null): void => {
    if (selectedIds.length === 0) {
      note('Select an object to apply a color')
      return
    }
    const prop = mode === 'fill' ? 'fill' : 'stroke'
    const commands: CanvasCommand[] = selectedIds.map((target) => ({
      kind: 'set-style',
      target,
      props: { [prop]: hex }
    }))
    const command: CanvasCommand =
      commands.length === 1 ? (commands[0] as CanvasCommand) : { kind: 'batch', commands }
    apply(command, mode === 'fill' ? 'Fill' : 'Stroke')
  }

  const handleImport = (file: File): void => {
    void file.text().then((text) => {
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        note('Import palette: not valid JSON')
        return
      }
      const colors = parseImportedPalette(json)
      if (!colors) {
        note('Import palette: expected a JSON array of hex colors')
        return
      }
      const ramp: PaletteRamp = { name: file.name.replace(/\.json$/i, ''), colors }
      setCustomRamps((prev) => [...prev, ramp])
      if (rootDir) void saveCustomRamp(rootDir, ramp)
      note(`Imported palette "${ramp.name}" (${colors.length} colors)`)
    })
  }

  return (
    <div className="canvas-props__section">
      <div className="canvas-props__title">Palette</div>
      <div className="canvas-props__segmented canvas-palette__mode">
        <button aria-pressed={mode === 'fill'} onClick={() => setMode('fill')}>
          Fill
        </button>
        <button aria-pressed={mode === 'stroke'} onClick={() => setMode('stroke')}>
          Stroke
        </button>
      </div>
      <button className="canvas-palette__nochip" onClick={() => applyColor('none')}>
        No {mode}
      </button>
      <div className="canvas-palette__ramps">
        {ramps.map((ramp) => (
          <div key={ramp.name} className="canvas-palette__ramp" title={ramp.name}>
            {ramp.colors.map((c, i) => (
              <button
                key={`${ramp.name}-${i}-${c}`}
                className="canvas-props__chip canvas-palette__chip"
                style={{ background: c }}
                title={`${ramp.name}: ${c}`}
                onClick={() => applyColor(c)}
              />
            ))}
          </div>
        ))}
      </div>
      <label className="canvas-palette__import">
        Import palette…
        <input
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleImport(file)
            e.target.value = ''
          }}
        />
      </label>
    </div>
  )
}
