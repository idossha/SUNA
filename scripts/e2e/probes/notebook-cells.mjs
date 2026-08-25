/**
 * Drive probe — notebook cell editing and interactive output:
 *
 *   1. the modal keyboard: `b` inserts a code cell below, `m` makes it
 *      markdown, `dd` deletes it and `z` puts it back;
 *   2. ⌘⇧↓ moves a cell, and the toolbar's "+ Code" inserts one;
 *   3. a saved plotly output renders in the sandboxed suna-output: frame,
 *      not as the static png sitting beside it in the same bundle;
 *   4. ⇧↵ typed INSIDE a cell editor runs it without CodeMirror also
 *      inserting the newline it normally binds that key to;
 *   5. `?` opens the app's one centred shortcut dialog on the Notebook tab,
 *      and `?` again closes it;
 *   6. the file that comes back out is still a notebook, with the cells the
 *      editing left behind.
 *
 * Run:  node scripts/e2e/drive.mjs --boot --example
 *       node scripts/e2e/drive.mjs scripts/e2e/probes/notebook-cells.mjs
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

const NOTEBOOK = {
  cells: [
    { cell_type: 'markdown', id: 'a1', metadata: {}, source: '# Probe notebook\n' },
    {
      cell_type: 'code',
      id: 'a2',
      metadata: {},
      execution_count: 1,
      source: 'print("hello")\n',
      outputs: [
        {
          output_type: 'display_data',
          metadata: {},
          data: {
            'application/vnd.plotly.v1+json': {
              data: [{ type: 'scatter', x: [1, 2, 3], y: [2, 1, 3] }],
              layout: { title: { text: 'probe' } }
            },
            'image/png': 'iVBORw0KGgo=',
            'text/plain': '<plotly.Figure>'
          }
        }
      ]
    }
  ],
  metadata: {},
  nbformat: 4,
  nbformat_minor: 5
}

export default async (ctx) => {
  await ctx.waitFor(`!!window.__sunaDev`, { timeoutMs: 20000, desc: 'window.__sunaDev (dev build)' })
  const rootDir = await ctx.evalJs(`window.__sunaDev.projectStore.getState().rootDir`)
  assert(rootDir, 'no project open — boot with: node scripts/e2e/drive.mjs --boot --example')

  const path = join(rootDir, 'analysis', `probe_cells_${process.pid}.ipynb`)
  writeFileSync(path, `${JSON.stringify(NOTEBOOK, null, 1)}\n`)
  await ctx.evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(path)})`)
  await ctx.waitFor(`document.querySelectorAll('.nb-cell').length === 2`, {
    timeoutMs: 15000,
    desc: 'the notebook tab with its two cells'
  })

  /** The cell list as the DOM has it: type per cell, plus what is selected. */
  const cells = () =>
    ctx.evalJs(`[...document.querySelectorAll('.nb-cell')].map((el) => ({
      type: el.classList.contains('nb-cell--code') ? 'code'
        : el.classList.contains('nb-cell--markdown') ? 'markdown' : 'raw',
      selected: el.classList.contains('nb-cell--selected')
    }))`)

  const press = async (key, opts = {}) =>
    ctx.evalJs(`(() => {
      const scroller = document.querySelector('.nb__cells');
      scroller.focus();
      const target = document.activeElement ?? scroller;
      const event = new KeyboardEvent('keydown', Object.assign(
        { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }, ${JSON.stringify(opts)}));
      target.dispatchEvent(event);
      return true;
    })()`)

  // ---- 1. select the first cell, then b / m / dd / z ----------------------
  await ctx.evalJs(`document.querySelector('.nb-cell').dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true }))`)
  await press('b')
  let list = await cells()
  assert(list.length === 3, `b did not insert a cell (got ${list.length})`)
  assert(list[1].type === 'code' && list[1].selected, 'the inserted cell is not the selected one')

  await press('m')
  list = await cells()
  assert(list[1].type === 'markdown', 'm did not turn the new cell into markdown')

  await press('d')
  await press('d')
  list = await cells()
  assert(list.length === 2, `dd did not delete the cell (got ${list.length})`)

  await press('z')
  list = await cells()
  assert(list.length === 3 && list[1].type === 'markdown', 'z did not restore the deleted cell')

  // ---- 2. move it, and insert from the toolbar ---------------------------
  await press('ArrowUp', { metaKey: true, shiftKey: true })
  list = await cells()
  assert(list[0].type === 'markdown' && list[1].type === 'markdown', '⌘⇧↑ did not move the cell')

  await ctx.evalJs(`[...document.querySelectorAll('.nb-toolbar__button')]
    .find((b) => b.textContent.includes('+ Code')).click()`)
  list = await cells()
  assert(list.length === 4, `"+ Code" did not insert a cell (got ${list.length})`)

  // ---- 3. the interactive output ------------------------------------------
  const frame = await ctx.evalJs(`(() => {
    const el = document.querySelector('.nb-output__frame');
    return el === null ? null : { src: el.getAttribute('src'), sandbox: el.getAttribute('sandbox') };
  })()`)
  assert(frame !== null, 'the plotly output did not render in a frame (static png won instead?)')
  assert(frame.src.startsWith('suna-output://'), `frame src is ${frame.src}`)
  assert(!frame.sandbox.includes('allow-same-origin'), 'the output frame is not cross-origin')

  // The frame reports its own height once its library has drawn; without a
  // network that library cannot load, so this is a warning, never a failure.
  await ctx.sleep(2500)
  const height = await ctx.evalJs(
    `document.querySelector('.nb-output__frame')?.getBoundingClientRect().height ?? 0`
  )
  console.log(
    height > 200
      ? `  plot frame grew to ${Math.round(height)}px — plotly loaded and drew`
      : `  plot frame is ${Math.round(height)}px — the CDN was probably unreachable (offline)`
  )

  // ---- 4. ⇧↵ inside the editor: runs, and leaves no stray newline --------
  // The FIRST code cell, by index: ⇧↵ runs and steps on, so "the last one"
  // would name a different cell before and after.
  const codeCellText = () =>
    ctx.evalJs(`document.querySelectorAll('.nb-cell--code')[0]
      .querySelector('.cm-content').textContent`)
  await ctx.evalJs(`(() => {
    document.querySelectorAll('.nb-cell--code')[0].querySelector('.cm-content').focus();
    return true;
  })()`)
  const before = await codeCellText()
  await ctx.evalJs(`(() => {
    const content = document.activeElement;
    content.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'Enter', code: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    return true;
  })()`)
  assert(
    (await codeCellText()) === before,
    'Shift-Enter inside a cell inserted a newline as well as running it'
  )

  // ---- 5. the one shortcut dialog, on the notebook section ----------------
  const helpSection = () =>
    ctx.evalJs(`document.querySelector('.help-overlay')?.dataset.helpSection ?? null`)
  assert((await helpSection()) === null, 'the help overlay is already open')
  const pressHelp = () =>
    ctx.evalJs(`(() => {
      document.querySelector('.nb__cells').focus();
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown',
        { key: '?', code: 'Slash', shiftKey: true, bubbles: true, cancelable: true }));
      return true;
    })()`)
  await pressHelp()
  assert((await helpSection()) === 'notebook', `? opened on ${await helpSection()}, not notebook`)
  const notebookRows = await ctx.evalJs(
    `[...document.querySelectorAll('.help-overlay kbd')].map((k) => k.textContent)`
  )
  assert(notebookRows.includes('d d'), 'the notebook section does not list the cell keys')
  await ctx.evalJs(`(() => {
    document.querySelector('.help-overlay').dispatchEvent(new KeyboardEvent('keydown',
      { key: '?', code: 'Slash', shiftKey: true, bubbles: true, cancelable: true }));
    return true;
  })()`)
  assert((await helpSection()) === null, '? a second time did not close the overlay')

  // ---- 6. save, and read the file back ------------------------------------
  await press('s', { metaKey: true })
  await ctx.waitFor(
    `[...document.querySelectorAll('.nb-toolbar__button')].some((b) => b.textContent === 'Saved')`,
    { timeoutMs: 8000, desc: 'the notebook to save' }
  )
  const saved = JSON.parse(
    await ctx.evalJs(`window.suna.invoke('fs:read-text', { path: ${JSON.stringify(path)} })
      .then((r) => r.content)`)
  )
  assert(saved.cells.length === 4, `saved notebook has ${saved.cells.length} cells, expected 4`)
  assert(
    saved.cells.every((c) => typeof c.cell_type === 'string' && c.source !== undefined),
    'a saved cell is missing its required keys'
  )
  assert(
    saved.cells.filter((c) => c.cell_type === 'markdown').every((c) => !('outputs' in c)),
    'a markdown cell was saved carrying outputs'
  )

  console.log('notebook-cells: ok')
}
