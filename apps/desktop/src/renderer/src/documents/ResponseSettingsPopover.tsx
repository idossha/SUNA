import { useEffect, useRef, type JSX } from 'react'
import { CHANGE_MARK, QUOTE_CLOSE, QUOTE_OPEN } from '@suna/core'
import { useResolved, useSettingsStore } from '../state/settings'
import { sourceLabel } from '../settings/sourceLabel'
import './documents.css'

/**
 * The response workspace's own settings, behind the gear in its header.
 *
 * Two switches, both about how this group writes a response rather than about
 * the app, which is why they are here and not only in the Settings tab: you
 * decide them while looking at a reply, not while looking at a preferences
 * screen. They are ordinary members of the two-level hierarchy — this writes
 * the GLOBAL level and reports when a project is overriding it, the same
 * contract the editor's gear has.
 *
 * The legend is the substantive part. A colour convention nobody can read off
 * the screen is a convention people get wrong, and this is the only place the
 * app says what the three hues mean.
 */
export function ResponseSettingsPopover({ onClose }: { onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const { value: colorRoles, source: colorSource } = useResolved('response.colorRoles')
  const { value: quickInsert, source: quickSource } = useResolved('response.quickInsert')
  const setGlobal = useSettingsStore((s) => s.setGlobal)

  useEffect(() => {
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      // The gear toggles; let its own handler close this.
      if (target.closest('.round__gear')) return
      if (ref.current !== null && !ref.current.contains(target)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div ref={ref} className="round__settings" role="dialog" aria-label="Response settings">
      <div className="round__settings-row">
        <label htmlFor="rx-set-color">
          <input
            id="rx-set-color"
            type="checkbox"
            checked={colorRoles}
            disabled={colorSource === 'project'}
            onChange={(e) => void setGlobal('response.colorRoles', e.target.checked)}
          />
          Colour the three voices
        </label>
        <span className="round__settings-src">{sourceLabel(colorSource)}</span>
      </div>
      <p className="round__settings-note">
        In this workspace and in every exported response. The values are the ones both response
        letters in <code>examples/peer-review/</code> use.
      </p>

      <ul className="round__legend">
        <li>
          <span className="round__swatch round__v-comment" aria-hidden="true" />
          The reviewer&rsquo;s comment — never editable, never coloured by us
        </li>
        <li>
          <span className="round__swatch round__v-reply" aria-hidden="true" />
          Our reply
        </li>
        <li>
          <span className="round__swatch round__v-quote" aria-hidden="true" />
          {/* Same hue as the comment — italic is what tells them apart, in the
              export as well as here, so the legend has to show it. */}
          <em>Manuscript quoted unchanged</em>
        </li>
        <li>
          <span className="round__swatch round__v-change" aria-hidden="true" />
          Manuscript text that is new
        </li>
      </ul>

      <div className="round__settings-row">
        <label htmlFor="rx-set-quick">
          <input
            id="rx-set-quick"
            type="checkbox"
            checked={quickInsert}
            disabled={quickSource === 'project'}
            onChange={(e) => void setGlobal('response.quickInsert', e.target.checked)}
          />
          Quick insertions
        </label>
        <span className="round__settings-src">{sourceLabel(quickSource)}</span>
      </div>

      <dl className="round__keys">
        <dt>
          <kbd>::</kbd>
        </dt>
        <dd>
          Opens a manuscript excerpt (<code>{QUOTE_OPEN}</code> … <code>{QUOTE_CLOSE}</code>).
          Inside an excerpt <code>{QUOTE_CLOSE}</code> stays the closing fence.
        </dd>
        <dt>
          <kbd>⌘⇧Q</kbd>
        </dt>
        <dd>The same, wrapping the selection if there is one</dd>
        <dt>
          <kbd>⌘⇧R</kbd>
        </dt>
        <dd>
          Mark the selection as new manuscript text (<code>{CHANGE_MARK}</code> … {' '}
          <code>{CHANGE_MARK}</code>) — press again to unmark
        </dd>
        <dt>
          <kbd>RE:</kbd>
        </dt>
        <dd>Added on the first keystroke into an empty reply</dd>
      </dl>
      <p className="round__settings-note">
        The marks are hidden while you write and come back when the caret enters what they
        belong to. They are never removed from the reply — the file stays plain text.
      </p>

      {(colorSource === 'project' || quickSource === 'project') && (
        <p className="round__settings-note">
          A setting marked <em>from project</em> is fixed in <code>suna.json</code> — change it in
          the Settings tab, where the project level is edited.
        </p>
      )}
    </div>
  )
}
