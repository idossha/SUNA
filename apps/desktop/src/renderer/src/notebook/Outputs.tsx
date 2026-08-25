import type { JSX } from 'react'
import { parseSciMark, renderHtml } from '@suna/markdown'
import type { DisplayOutput, ErrorOutput, Output, StreamOutput } from '@suna/notebook'
import { ansiToSpans } from './ansi'
import { InteractiveOutput } from './Interactive'
import { interactiveHtml } from './interactiveHtml'
import { INTERACTIVE_MIMES, dataUri, pickRepresentation } from './mime'

/**
 * Rendering the outputs a kernel produced.
 *
 * Nothing here transforms the output on its way to the screen: the object
 * being rendered is the same object that gets written into the .ipynb, so
 * what the author sees and what the file says can never drift apart.
 */

/** Text with a kernel's ANSI colours preserved. */
function AnsiText({ text, className }: { text: string; className?: string }): JSX.Element {
  return (
    <pre className={className ?? 'nb-output__text'}>
      {ansiToSpans(text).map((span, index) => (
        <span key={index} className={span.className === '' ? undefined : span.className}>
          {span.text}
        </span>
      ))}
    </pre>
  )
}

function StreamView({ output }: { output: StreamOutput }): JSX.Element {
  const text = typeof output.text === 'string' ? output.text : output.text.join('')
  // stderr is a warning, not a failure: `print(..., file=sys.stderr)` and
  // every logging call land here, and painting them as errors would cry wolf.
  return (
    <AnsiText
      text={text}
      className={output.name === 'stderr' ? 'nb-output__text nb-output__text--stderr' : 'nb-output__text'}
    />
  )
}

function ErrorView({ output }: { output: ErrorOutput }): JSX.Element {
  const traceback = output.traceback.join('\n')
  return (
    <div className="nb-output__error">
      <AnsiText
        text={traceback === '' ? `${output.ename}: ${output.evalue}` : traceback}
        className="nb-output__text nb-output__text--error"
      />
    </div>
  )
}

/** The bundle minus its interactive types: what to draw when none renders. */
function staticFallback(data: Record<string, unknown>): Record<string, unknown> {
  const rest: Record<string, unknown> = {}
  for (const [mime, value] of Object.entries(data)) {
    if (!INTERACTIVE_MIMES.has(mime)) rest[mime] = value
  }
  return rest
}

function DisplayView({ output }: { output: DisplayOutput }): JSX.Element | null {
  const picked = pickRepresentation(output.data)
  // A live plot nothing here can draw is not a dead output: the kernel sends
  // a static png beside it, and that is what a reader gets.
  const rep =
    picked.kind === 'interactive' && interactiveHtml(picked.mime, picked.value) === null
      ? pickRepresentation(staticFallback(output.data))
      : picked
  switch (rep.kind) {
    case 'interactive':
      return <InteractiveOutput html={interactiveHtml(rep.mime, rep.value) as string} />
    case 'script-html':
      return <InteractiveOutput html={rep.html} />
    case 'image':
      return <img className="nb-output__image" src={dataUri(rep.mime, rep.data)} alt="" />
    case 'svg':
      // An SVG figure is markup the kernel produced; it renders as markup,
      // which is the only way a vector plot is a vector plot at all.
      return (
        <div className="nb-output__svg" dangerouslySetInnerHTML={{ __html: rep.svg }} />
      )
    case 'html':
      // DataFrame tables, ipywidgets' static HTML, plotting libraries'
      // snippets. Scripts do not run: React sets innerHTML, and innerHTML
      // never executes a <script> it inserts.
      return <div className="nb-output__html" dangerouslySetInnerHTML={{ __html: rep.html }} />
    case 'markdown':
      return (
        <div
          className="nb-output__html"
          dangerouslySetInnerHTML={{ __html: renderHtml(parseSciMark(rep.text)) }}
        />
      )
    case 'json':
      return <AnsiText text={JSON.stringify(rep.value, null, 2)} />
    case 'text':
      return <AnsiText text={rep.text} />
    case 'none':
      return (
        <div className="nb-output__unsupported">
          {'application/vnd.jupyter.widget-view+json' in output.data
            ? 'This output is an ipywidget. SUNA runs the kernel but not the widget front end yet — for an interactive plot, use plotly, altair/vega or bokeh.'
            : `Nothing here can render ${Object.keys(output.data).join(', ') || 'this output'}.`}
        </div>
      )
  }
}

export function OutputView({ output }: { output: Output }): JSX.Element | null {
  if (output.output_type === 'stream') return <StreamView output={output} />
  if (output.output_type === 'error') return <ErrorView output={output} />
  return <DisplayView output={output} />
}

export function OutputList({ outputs }: { outputs: readonly Output[] }): JSX.Element | null {
  if (outputs.length === 0) return null
  return (
    <div className="nb-output">
      {outputs.map((output, index) => (
        <OutputView key={index} output={output} />
      ))}
    </div>
  )
}
