/**
 * Turning a plotting library's JSON output into the HTML its own renderer
 * understands.
 *
 * Jupyter's front end ships each library's javascript; SUNA does not, so the
 * frame loads it the way `plotly.io.to_html(include_plotlyjs='cdn')` and
 * `altair.save(..., 'html')` do — from the library's CDN. That needs a
 * network the first time; the frame says so plainly when it fails, and the
 * notebook's own static fallback image is untouched either way.
 */

const PLOTLY_JS = 'https://cdn.plot.ly/plotly-2.35.2.min.js'
const VEGA_JS = 'https://cdn.jsdelivr.net/npm/vega@5'
const VEGA_LITE_JS = 'https://cdn.jsdelivr.net/npm/vega-lite@5'
const VEGA_EMBED_JS = 'https://cdn.jsdelivr.net/npm/vega-embed@6'

/** JSON safe to sit inside a <script> block. */
function embedJson(value: unknown): string {
  return JSON.stringify(value ?? null).replace(/</g, '\\u003c')
}

function plotlyHtml(value: unknown): string {
  const spec = (value ?? {}) as { data?: unknown; layout?: unknown; config?: unknown }
  return `<div id="plot"></div>
<script src="${PLOTLY_JS}"></script>
<script>
Plotly.newPlot('plot', ${embedJson(spec.data ?? [])}, ${embedJson(spec.layout ?? {})},
  Object.assign({responsive: true}, ${embedJson(spec.config ?? {})}));
</script>`
}

function vegaHtml(mime: string, value: unknown): string {
  const lite = mime.includes('vegalite')
  return `<div id="plot"></div>
<script src="${VEGA_JS}"></script>
${lite ? `<script src="${VEGA_LITE_JS}"></script>` : ''}
<script src="${VEGA_EMBED_JS}"></script>
<script>
vegaEmbed('#plot', ${embedJson(value)}, {actions: true});
</script>`
}

/**
 * The HTML for one interactive mime bundle entry, or null when nothing here
 * knows how to draw it — the caller then falls back to the static picture the
 * kernel sent alongside it.
 */
export function interactiveHtml(mime: string, value: unknown): string | null {
  if (mime === 'application/vnd.plotly.v1+json') return plotlyHtml(value)
  if (mime.startsWith('application/vnd.vega')) return vegaHtml(mime, value)
  return null
}
