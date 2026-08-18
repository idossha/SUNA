import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import './suna.css'

/**
 * Click-to-zoom for screenshots.
 *
 * Every image on this site is a whole application window, which is unreadable
 * at the column width the page sets. One click opens it at full size; Escape,
 * a second click, or navigating away closes it. Kept as a handful of DOM calls
 * rather than a lightbox dependency — the site ships no third-party runtime.
 */
function mountShotZoom(): () => void {
  let overlay: HTMLDivElement | null = null

  const close = (): void => {
    overlay?.remove()
    overlay = null
    document.documentElement.style.removeProperty('overflow')
  }

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close()
  }

  const onClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof HTMLImageElement)) return
    if (!target.closest('.shot')) return
    if (overlay !== null) return

    overlay = document.createElement('div')
    overlay.className = 'shot-zoom'
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-label', target.alt || 'Screenshot, full size')

    const full = document.createElement('img')
    full.src = target.currentSrc || target.src
    full.alt = target.alt

    const hint = document.createElement('div')
    hint.className = 'shot-zoom__hint'
    hint.textContent = 'Click anywhere or press Esc to close'

    overlay.append(full, hint)
    overlay.addEventListener('click', close)
    document.body.append(overlay)
    // The page behind must not scroll under the overlay.
    document.documentElement.style.overflow = 'hidden'
  }

  document.addEventListener('click', onClick)
  document.addEventListener('keydown', onKey)

  return () => {
    close()
    document.removeEventListener('click', onClick)
    document.removeEventListener('keydown', onKey)
  }
}

export default {
  extends: DefaultTheme,
  enhanceApp({ router }) {
    if (typeof document === 'undefined') return
    mountShotZoom()
    // A zoomed screenshot must not survive a client-side navigation.
    router.onBeforeRouteChange = () => {
      document.querySelector('.shot-zoom')?.remove()
      document.documentElement.style.removeProperty('overflow')
    }
  }
} satisfies Theme
