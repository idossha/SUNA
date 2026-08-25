import { protocol } from 'electron'

/**
 * The `suna-output:` scheme: one static page that notebook outputs render
 * INSIDE, in an isolated frame.
 *
 * Why a scheme at all. Interactive plots — plotly, bokeh, altair/vega — are
 * HTML that only means anything once its <script> runs, and the renderer's
 * CSP (`script-src 'self'`) forbids that, rightly: an output is data that
 * arrived from a kernel, and it must never be able to touch the app. An
 * `srcdoc` or `blob:` iframe would not help, because both INHERIT the parent
 * document's CSP. A document fetched over a real scheme does not, so this
 * serves one — sandboxed, cross-origin to the app, with no preload and no
 * access to `window.suna`.
 *
 * The frame holds no output content of its own: the renderer posts the HTML
 * in, and the frame posts its height back. Nothing is registered, cached or
 * written to disk, so there is no store here to leak between notebooks.
 */

export const OUTPUT_FRAME_SCHEME = 'suna-output'
export const OUTPUT_FRAME_URL = `${OUTPUT_FRAME_SCHEME}://frame/`

/** Called before `app.whenReady()`; Electron requires that ordering. */
export function registerOutputFrameScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: OUTPUT_FRAME_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ])
}

export function handleOutputFrameScheme(): void {
  protocol.handle(OUTPUT_FRAME_SCHEME, (request) => {
    const { pathname } = new URL(request.url)
    if (pathname !== '/' && pathname !== '') {
      return new Response('not found', { status: 404 })
    }
    return new Response(FRAME_HTML, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    })
  })
}

/**
 * The frame's bootstrap.
 *
 * `innerHTML` does not execute a <script> it inserts — that is exactly why
 * the in-app HTML output renderer is safe, and exactly why this frame has to
 * exist. Here the scripts are re-created as real elements, in document order,
 * each awaited: plotly's bundle must have finished loading before the
 * `Plotly.newPlot` call that follows it runs.
 */
const FRAME_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body { font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #33333a; }
  #root { overflow: auto; }
  #offline { display: none; margin: 6px 0; padding: 6px 8px; font-size: 12px;
             border-left: 2px solid #b8873c; color: #7a6236; background: #fbf6ec; }
</style>
</head>
<body>
<div id="root"></div>
<div id="offline">This plot's library could not be loaded. Interactive output needs a network
connection the first time, or a notebook saved with the library inlined
(e.g. <code>include_plotlyjs=True</code>).</div>
<script>
(function () {
  var root = document.getElementById('root')
  var offline = document.getElementById('offline')
  var sent = -1

  function report() {
    var height = Math.ceil(document.documentElement.scrollHeight)
    if (height === sent) return
    sent = height
    parent.postMessage({ type: 'suna-output-size', height: height }, '*')
  }

  function runScript(old) {
    return new Promise(function (done) {
      var next = document.createElement('script')
      for (var i = 0; i < old.attributes.length; i++) {
        next.setAttribute(old.attributes[i].name, old.attributes[i].value)
      }
      next.text = old.textContent || ''
      if (next.src) {
        next.onload = function () { done() }
        next.onerror = function () { offline.style.display = 'block'; done() }
      }
      old.parentNode.replaceChild(next, old)
      if (!next.src) done()
    })
  }

  async function render(html) {
    root.innerHTML = html
    var scripts = Array.prototype.slice.call(root.querySelectorAll('script'))
    for (var i = 0; i < scripts.length; i++) {
      try { await runScript(scripts[i]) } catch (error) { /* one bad script is not the page */ }
    }
    report()
    // Plot libraries lay out asynchronously; keep measuring for a moment.
    new ResizeObserver(report).observe(document.documentElement)
    setTimeout(report, 60)
    setTimeout(report, 400)
  }

  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data || data.type !== 'suna-output-render') return
    if (typeof data.color === 'string') document.body.style.color = data.color
    void render(String(data.html || ''))
  })

  parent.postMessage({ type: 'suna-output-ready' }, '*')
})()
</script>
</body>
</html>
`
