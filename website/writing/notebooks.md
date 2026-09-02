# Notebooks and running code

A manuscript in SUNA sits beside the analysis that produced it, so the app runs code as well as prose: `.ipynb` notebooks against a real Jupyter kernel, and any script through a one-key run into the integrated terminal. Both use the interpreter you picked in the status bar, so what SUNA runs is what you would have run yourself.

## Notebooks

Open any `.ipynb` and it renders as a notebook, not as JSON.

<figure class="shot">
  <img src="/shots/notebook.webp" alt="A notebook open in SUNA: a toolbar with plus Code, plus Markdown, Run all, Interrupt, Restart and Clear outputs, rendered markdown headings between numbered code cells, and a kernel status reading no kernel on the right." />
  <figcaption>The example project's <code>analysis/explore_happiness.ipynb</code>. Markdown cells render; code cells keep their numbering; the kernel's status sits at the right of the toolbar.</figcaption>
</figure>

### The file is the document

SUNA reads and writes nbformat v4 byte-compatibly with the reference Python implementation — `json.dumps(..., indent=1, sort_keys=True, ensure_ascii=False)` plus a trailing newline, multi-line strings stored as lists of lines, and **unknown keys preserved**.

That last one matters more than it sounds. Notebooks carry metadata from tools that have nothing to do with SUNA — widget state, kernelspecs, extension settings — and dropping them on save would be data loss. Open a notebook, save it untouched, and `git diff` is empty.

### Kernels

A kernel starts per open notebook, on demand. SUNA does not speak the Jupyter ZMQ wire protocol itself: it runs `python/suna_kernel/bridge.py` under your selected interpreter and talks to it over plain stdin/stdout, one JSON object per line. `jupyter_client` — the same library Jupyter Lab and VS Code drive kernels with — does the protocol work on the Python side.

Two consequences worth knowing:

- **You need `ipykernel` in the environment you selected** — it pulls in `jupyter_client` and registers the kernel, and it is the whole setup. SUNA offers to install it for you rather than leaving it to you to remember: the [project wizard](/guide/install) offers it on its Python step, and if a kernel ever fails to start, the notebook says which interpreter it failed under and offers a one-click **Install ipykernel** into it. Where it cannot install — no network, or an interpreter you do not have write access to — it tells you the exact command to run instead.
- **Any Jupyter kernel works**, not only Python — anything with a kernelspec, because the bridge is protocol translation rather than a Python-specific integration.

The toolbar carries **Run all**, **Interrupt**, **Restart** and **Clear outputs**, and a status that reads `no kernel`, `starting…`, `idle`, `busy` or `not running`.

### Cell keys

The same bindings work while you are typing in a cell and while the cell is merely selected.

| Key | What it does |
| --- | --- |
| <kbd>⇧⏎</kbd> | Run the cell and select the next |
| <kbd>⌘⏎</kbd> | Run the cell and stay on it |
| <kbd>⌥⏎</kbd> | Run the cell and insert a new one below |
| <kbd>b</kbd> | Insert a code cell below |
| <kbd>b</kbd> then <kbd>m</kbd> | Insert a markdown cell below |
| <kbd>⌘⇧↑</kbd> / <kbd>⌘⇧↓</kbd> | Move the cell up or down |
| <kbd>Esc</kbd> | Leave the editor; the keyboard acts on the cell |

### Outputs

Outputs are stored exactly as the kernel sent them, because that same object is what ends up in the `.ipynb`. SUNA never interprets one on the way in.

Rendering handles the usual MIME types — text, HTML, images, tracebacks with their ANSI colour intact. An **interactive** output (a Plotly or Bokeh figure, anything that ships its own scripts) renders in a sandboxed iframe on SUNA's own `suna-output:` scheme: cross-origin, no preload, no access to `window.suna`. The frame is handed HTML and hands back a height, and nothing else crosses. So a plot stays a plot — pan, zoom, hover, legend clicks — without the notebook's scripts running inside the app.

## Running a script

Open any script and press <kbd>⌃⏎</kbd> (**Run File**), or use the ▶ button in the editor's top-right corner. SUNA opens a terminal tab in the project folder and types the command.

<figure class="shot">
  <img src="/shots/run-terminal.webp" alt="A Python module open in the editor with the integrated terminal panel below it, showing the command python code slash happiness underscore model dot py and its three lines of printed output." />
  <figcaption>The run lands in the integrated terminal as a visible, editable, re-runnable command — not in a hidden subprocess.</figcaption>
</figure>

That is the whole design: **nothing shells out on its own.** The command is in a terminal you can read, edit, re-run and <kbd>⌃C</kbd>, because a run you cannot inspect is a run you cannot debug.

| Extension | Command |
| --- | --- |
| `.py` | `python` (`python3` when no environment is selected) |
| `.r` | `Rscript` |
| `.jl` | `julia` |
| `.sh`, `.bash`, `.zsh` | `bash` / `zsh` |
| `.js`, `.mjs`, `.cjs` | `node` |
| `.ts`, `.mts` | `npx --yes tsx` |

The list is deliberately small: interpreters a researcher already has, each invoked the way its own docs say to. Compilers and build tools are not here — a "run" that needs a build step needs a task system, not a button.

## Choosing an interpreter

The status bar shows the environment the project uses; click it to pick another. SUNA scans for `uv`, `venv` and `conda` environments and lists what it finds. That choice is what runs your notebooks' kernels, your scripts, and anything you type in the terminal — the terminal is spawned with the environment already on `PATH`, so a run is plain `python file.py` and not a wrapper.

::: tip First open can be slow
A conda scan walks the environments directory and asks conda itself for the list. On a machine with many environments the first open takes a few seconds; later opens are quick.
:::

## Data files

A `.csv` or `.tsv` opens in a data grid with a row and column count, a numbered gutter and right-aligned numeric columns, and a **Text / Grid** toggle for when you would rather see the file itself. It renders at most 5,000 rows and says so when it truncates.

<figure class="shot">
  <img src="/shots/data-grid.webp" alt="A CSV file open in the data grid: a toolbar with a row and column count and a Text slash Grid toggle, a numbered row gutter, and right-aligned numeric columns." />
</figure>

## Where this fits

The example project is laid out the way the split is meant to work, and the same shape is worth copying:

| Folder | What belongs there |
| --- | --- |
| `data/` | inputs, never written by a script |
| `analysis/` | pipeline steps that turn `data/` into `results/` |
| `code/` | the reusable model those steps import |
| `results/` | committed numbers the manuscript quotes |

Numbers in the prose then come from a file on disk rather than from anybody's memory of what the plot looked like — and the notebook that checks whether they are still true is a file in the same repository. See [Figures from code](/figures/from-code) for the same idea applied to plots.
