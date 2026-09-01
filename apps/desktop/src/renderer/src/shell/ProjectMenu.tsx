/**
 * Title-bar project switcher (DECISIONS 2026-08-15): opened from the project
 * name button in TitleBar.tsx. Lists recent projects (capped at 8, missing
 * ones dimmed with a Remove action), then "Open project…", "New project…",
 * "Open example".
 *
 * Rendered through a portal onto `document.body` and positioned with
 * `position: fixed` off the anchor button's own rect — the title bar is a
 * drag region with `overflow` effectively clipping anything laid out inside
 * it, so the menu has to live outside that box to avoid being cut off.
 *
 * Selectors for e2e drivers / styling: `.projmenu` (the menu), `.projmenu-
 * scrim` (outside-click dismiss layer), `.projmenu__row` (one per recent
 * project, `.projmenu__row--missing` when dimmed), `.projmenu__row--active`
 * (keyboard-focused), `.projmenu__remove` (the Missing row's Remove
 * button), `.projmenu__sep` (the separator before the static actions),
 * `.projmenu__item` (Open project… / New project… / Open example, `data-
 * action` holds the action id, `.projmenu__item--active` when keyboard-
 * focused).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { RecentProjectEntry } from '@suna/core'
import { useProjectStore, openProjectAt } from '../state/project'
import { openOnboardingTab } from '../state/dock'
import { toRecentProjectRow } from './recentsFormat'
import './ProjectMenu.css'

type StaticActionId = 'open' | 'new' | 'example'

const STATIC_ACTIONS: ReadonlyArray<{ id: StaticActionId; label: string }> = [
  { id: 'open', label: 'Open project…' },
  { id: 'new', label: 'New project…' },
  { id: 'example', label: 'Open example' }
]

const MAX_RECENTS = 8
const MENU_MARGIN = 8

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(record)) {
    if (k !== key) out[k] = v
  }
  return out
}

interface ProjectMenuProps {
  anchorEl: HTMLElement
  onClose: () => void
}

export function ProjectMenu({ anchorEl, onClose }: ProjectMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [recents, setRecents] = useState<RecentProjectEntry[] | null>(null)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [pos, setPos] = useState(() => {
    const rect = anchorEl.getBoundingClientRect()
    return { left: rect.left, top: rect.bottom + 4 }
  })

  useEffect(() => {
    let cancelled = false
    void window.suna
      .invoke('project:recents', {})
      .then(({ recents: entries }) => {
        if (!cancelled) setRecents(entries.slice(0, MAX_RECENTS))
      })
      .catch(() => {
        if (!cancelled) setRecents([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  // measure after mount/content-change, then clamp to the viewport
  useLayoutEffect(() => {
    const el = menuRef.current
    const rect = anchorEl.getBoundingClientRect()
    const width = el?.offsetWidth ?? 260
    const height = el?.offsetHeight ?? 160
    const left = Math.min(Math.max(MENU_MARGIN, rect.left), window.innerWidth - width - MENU_MARGIN)
    const top = Math.min(
      Math.max(MENU_MARGIN, rect.bottom + 4),
      window.innerHeight - height - MENU_MARGIN
    )
    setPos({ left, top })
  }, [anchorEl, recents])

  const openableRecents = useMemo(() => recents?.filter((r) => r.exists) ?? [], [recents])
  const navigableKeys = useMemo(
    () => [...openableRecents.map((r) => r.path), ...STATIC_ACTIONS.map((a) => a.id)],
    [openableRecents]
  )
  const [activeKey, setActiveKey] = useState<string | null>(null)
  useEffect(() => {
    if (activeKey === null && navigableKeys.length > 0) setActiveKey(navigableKeys[0] ?? null)
  }, [activeKey, navigableKeys])

  const openRecent = async (entry: RecentProjectEntry): Promise<void> => {
    setBusyPath(entry.path)
    setRowErrors((prev) => withoutKey(prev, entry.path))
    try {
      await openProjectAt(entry.path)
      onClose()
    } catch (error) {
      setRowErrors((prev) => ({ ...prev, [entry.path]: errMessage(error) }))
      setRecents((prev) => prev?.map((e) => (e.path === entry.path ? { ...e, exists: false } : e)) ?? prev)
    } finally {
      setBusyPath(null)
    }
  }

  const removeRecent = async (path: string): Promise<void> => {
    setBusyPath(path)
    try {
      const { recents: next } = await window.suna.invoke('project:forget-recent', { path })
      setRecents(next.slice(0, MAX_RECENTS))
      setRowErrors((prev) => withoutKey(prev, path))
    } catch (error) {
      setRowErrors((prev) => ({ ...prev, [path]: errMessage(error) }))
    } finally {
      setBusyPath(null)
    }
  }

  const runStaticAction = (id: StaticActionId): void => {
    switch (id) {
      case 'open':
        onClose()
        void useProjectStore.getState().openProject()
        return
      case 'new':
        onClose()
        openOnboardingTab({ mode: 'create' })
        return
      case 'example':
        onClose()
        void useProjectStore.getState().openExampleProject()
    }
  }

  const activate = (key: string): void => {
    const action = STATIC_ACTIONS.find((a) => a.id === key)
    if (action) {
      runStaticAction(action.id)
      return
    }
    const entry = openableRecents.find((r) => r.path === key)
    if (entry) void openRecent(entry)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (navigableKeys.length === 0) return
        const current = activeKey === null ? -1 : navigableKeys.indexOf(activeKey)
        const step = event.key === 'ArrowDown' ? 1 : -1
        const next = navigableKeys[(current + step + navigableKeys.length) % navigableKeys.length]
        setActiveKey(next ?? null)
        return
      }
      if (event.key === 'Enter') {
        if (activeKey === null) return
        event.preventDefault()
        activate(activeKey)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, navigableKeys, onClose])

  return createPortal(
    <>
      <div className="projmenu-scrim" onMouseDown={onClose} />
      <div ref={menuRef} className="projmenu" style={{ left: pos.left, top: pos.top }} role="menu" aria-label="Project">
        {recents !== null && recents.length > 0 && (
          <>
            <div className="projmenu__section">Recent projects</div>
            <ul className="projmenu__list">
              {recents.map((entry) => {
                const row = toRecentProjectRow(entry)
                const rowError = rowErrors[entry.path] ?? null
                const busy = busyPath === entry.path
                const active = activeKey === entry.path
                return (
                  <li className="projmenu__row-item" key={entry.path}>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={row.missing || busy}
                      className={
                        'projmenu__row' +
                        (row.missing ? ' projmenu__row--missing' : '') +
                        (active ? ' projmenu__row--active' : '')
                      }
                      onMouseEnter={() => !row.missing && setActiveKey(entry.path)}
                      onClick={() => void openRecent(entry)}
                    >
                      <span className="projmenu__name">{row.name}</span>
                      <span className="projmenu__path">{row.parentPath}</span>
                      {row.missing && <span className="projmenu__badge">Missing</span>}
                    </button>
                    {row.missing && (
                      <button
                        type="button"
                        className="projmenu__remove"
                        disabled={busy}
                        onClick={() => void removeRecent(entry.path)}
                      >
                        Remove
                      </button>
                    )}
                    {rowError !== null && <div className="projmenu__error">{rowError}</div>}
                  </li>
                )
              })}
            </ul>
          </>
        )}
        <div className="projmenu__sep" role="separator" />
        {STATIC_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            role="menuitem"
            data-action={action.id}
            className={'projmenu__item' + (activeKey === action.id ? ' projmenu__item--active' : '')}
            onMouseEnter={() => setActiveKey(action.id)}
            onClick={() => runStaticAction(action.id)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </>,
    document.body
  )
}
