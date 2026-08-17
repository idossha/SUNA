import { useEffect, type JSX } from 'react'
import { useUiStore, type Toast } from '../state/ui'
import './toasts.css'

/**
 * App-shell toast overlay (bottom center) — the destructive-action pattern:
 * act immediately, offer Undo for a few seconds. Rendered once in App.tsx as
 * a sibling of the workbench, so no scrolling ancestor can ever clip it (the
 * failure mode the old in-card delete confirm had).
 */

function ToastCard({ toast }: { toast: Toast }): JSX.Element {
  const dismiss = useUiStore((s) => s.dismissToast)

  useEffect(() => {
    if (toast.ttlMs <= 0) return
    const timer = window.setTimeout(() => dismiss(toast.id), toast.ttlMs)
    return () => window.clearTimeout(timer)
  }, [toast.id, toast.ttlMs, dismiss])

  return (
    <div className="toast" role="status">
      <span className="toast__message">{toast.message}</span>
      {toast.action !== undefined && (
        <button
          className="toast__action"
          onClick={() => {
            toast.action?.run()
            dismiss(toast.id)
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button className="toast__close" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
        ×
      </button>
    </div>
  )
}

export function Toasts(): JSX.Element | null {
  const toasts = useUiStore((s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
