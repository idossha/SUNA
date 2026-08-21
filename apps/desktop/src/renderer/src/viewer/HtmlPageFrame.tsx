import type { JSX } from 'react'
import './HtmlPageFrame.css'

/**
 * The one way this app shows an HTML document: a fully sandboxed frame fed
 * from `srcdoc`.
 *
 * Two surfaces show one — the export dialog's web-page preview, and the
 * viewer that opens an .html file in the project — and the interesting part
 * is not the markup, it is the sandbox. A SUNA web export is self-contained
 * (export-html.ts inlines its CSS and images), so there is nothing for the
 * frame to fetch; with `sandbox=""` there is nothing it MAY fetch, script,
 * navigate or submit either, which is what makes it safe to point this at a
 * file the app did not necessarily write. The app's own CSP
 * (`script-src 'self'`) applies to srcdoc content as well, so a page's inline
 * script does not run here even before the sandbox has an opinion.
 *
 * That reasoning has to hold in both places, so it lives in one component
 * rather than in two `<iframe>` tags that could quietly drift apart — one
 * gaining `allow-scripts` for a demo and never losing it again.
 */
export function HtmlPageFrame({ html, title }: { html: string; title: string }): JSX.Element {
  return <iframe className="html-page-frame" title={title} srcDoc={html} sandbox="" />
}
