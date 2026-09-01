# FAQ

Straight answers to the questions an evaluator asks before committing a paper to a new tool. Where the answer is "not yet", it says so.

## Is SUNA ready to use? What state is it in?

It runs, and it does real work on a real manuscript. There are signed installers for macOS and Linux attached to every [release](https://github.com/idossha/SUNA/releases) — the macOS builds are notarized by Apple, so the `.dmg` opens by double-clicking it — and you can still build from source if you would rather. The shell, editor, manuscript view, figure canvas, publisher profiles, export and agent layer are all built and in daily use, and every file it touches is plain text under git, so a bad session is a `git checkout` away from undone.

It is still young software, and the version number is honest about that rather than the polish. Treat it as something to try on a real paper with your work in git, not as something with a decade of edge cases behind it.

Some paths are covered by unit tests but have never been driven end-to-end under automation — notably producing a real `.pdf` and the study-acquisition download ladder. Open the exported file and look at it before you rely on it. See [Install and run](/guide/install) for prerequisites.

## Does it work on Linux?

SUNA supports macOS and Linux; Windows is not supported. Installers are built for both, and every change is typechecked and unit-tested on Linux **and** macOS before it is merged — so platform-branching code (Python paths, file-manager labels) is genuinely exercised.

What macOS has that Linux does not is a machine that opens the packaged app: the build pipeline packages SUNA on macOS and launches the real bundle on every pull request, and nothing in it ever boots a packaged Linux build. Every walkthrough and measurement in the repository was also done on macOS. So treat Linux as **untested rather than unsupported** — it builds, the code carries the branches it needs, and no machine has confirmed the result opens. [Bug reports](https://github.com/idossha/SUNA/issues) from it are genuinely useful.

One feature is macOS-only by construction: the "Use Spotlight" control for finding reference PDFs.

## Can I collaborate with someone who does not use SUNA?

Yes, in one direction. Export the manuscript to Word (`.docx`), PDF or a self-contained web page from the Export page, and send that; the `.docx` is an ordinary Word file your co-author can edit and comment on. See [Export](/publishing/export).

Coming back is the hard part. SUNA's DOCX import always creates a *new* project and refuses unconditionally to write into a folder that already contains a `suna.json`, so a co-author's edited Word file cannot be merged back into the project it came from — you apply their changes by hand. Review comments live in `manuscript/comments.json`, not in the prose, so Word comments do not round-trip either. A collaborator who is willing to work in the git repository can edit `manuscript/manuscript.md` and `references.bib` in any text editor; they need SUNA only for the canvas, the live preview and the compliance checks.

## Does it do LaTeX?

It does LaTeX *math*, not LaTeX *typesetting*. The manuscript dialect, SciMark, takes `$…$` inline and `$$…$$` display math rendered with KaTeX, plus pandoc-crossref style cross-references like `@fig:cluster` and `@eq:tf`. See [SciMark](/writing/scimark).

There is no LaTeX toolchain involved anywhere. PDF export goes through Electron's own `printToPDF` on SUNA's HTML — no `pdflatex`, no Tectonic, no external binary to install. A `` ```{=latex} `` fence is recognised and preserved verbatim in your source file, but it is dropped from every current render and export rather than passed through.

::: warning Not built yet
There is no `.tex` export. You cannot hand SUNA a `.tex` file and have it typeset, and you cannot get a LaTeX source file out of it. If your journal requires LaTeX submission, SUNA is not your final step.
:::

## Can I submit straight from SUNA?

You can produce the submission files; you still upload them yourself. Export writes `.docx`, `.pdf` or `.html` into the project's `output/` directory and never touches your sources. Before it exports, the Export page runs the manuscript compliance check against the selected journal profile and lists what it found — "N errors, M warnings — export anyway if you choose; nothing here blocks it." Compliance flags, it never rewrites. See [Compliance](/publishing/compliance).

Two things to check by hand. PDF line numbers are measured from the on-screen wrapped lines before Chromium paginates, so they are an approximation rather than typesetting-grade. And the manuscript-side diagnostics appear only on the Export page — not in the manuscript editor as you write.

## What happens to my files if I stop using SUNA?

You keep an ordinary folder. `manuscript/manuscript.md` is Markdown, `references.bib` is BibTeX, every figure is a valid `figure.svg`, the metadata is JSON, and the whole tree is a git repository. Nothing is stored in a binary or proprietary format — that is a standing rule of the project, and PDF and DOCX exist only as export outputs. See [Files and folders](/reference/files).

Two things live outside the prose by design and will not appear in a plain Markdown reader: figure and table captions (they sit in `manuscript.json`, with numbering derived at format time rather than written into the text, so the prose contains `![[fig:cluster]]` and no caption), and review comments (in `manuscript/comments.json`). Export to `.docx` or `.html` if you want a single self-contained copy with everything resolved.

## Do I need an AI agent to use SUNA?

No. The onboarding wizard's AI step offers Skip explicitly, and the editor, canvas, references, compliance and export all work with no AI configured. Without a `claude` or `codex` CLI on your PATH, Settings tells you so and literature search falls back to its keyless HTTP providers; the `✦ AI` button on a comment card stays disabled with a stated reason.

Every project is wired for an agent whether or not you use one — `.mcp.json` (machine-local, gitignored), `AGENTS.md`/`CLAUDE.md` and the `context/` memory files are written on scaffold regardless of what you choose. See [AI overview](/ai/overview).

## Does anything leave my machine?

Only when you ask for something that needs the network. Your project files are read and written locally; SUNA runs no telemetry and needs no account. Network traffic happens in these cases:

| Action | Where it goes |
| --- | --- |
| Literature search | Crossref, OpenAlex, bioRxiv/medRxiv (via Crossref), arXiv |
| Polite-pool contact email (Settings → Literature providers) | Sent to Crossref/OpenAlex as a contact address, not a login |
| Finding and fetching a reference PDF | The publisher or open-access host for that DOI |
| AI chat with an API key | Anthropic or OpenAI |
| AI with an agent CLI | The CLI you already have, billed to its own subscription |
| AI with Ollama | `http://127.0.0.1:11434` — your own machine |

Local PDF search does reach outside the project folder, but only to read: Spotlight plus the roots you configure in Settings → Reference library (`~/Downloads`, `~/Documents`, `~/Zotero/storage` and `~/Papers` by default). Writes never leave the project. API keys are encrypted with the OS keychain via Electron `safeStorage`. There is no Sci-Hub or proxy fallback in the PDF download path — a 403 is reported as a 403.

## Can I use my existing BibTeX and figures?

Yes to both. The project bibliography is `manuscript/references.bib`, a plain BibTeX file — the References view reads it directly, and the editor has a `.bib` language pack with highlighting, linting and completion. A Zotero or JabRef export works, including its `file` field: SUNA resolves a reference's PDF from that field first, then `references/<citekey>.pdf`, then an `Author_Year*` fuzzy match. See [References](/writing/references).

For figures, drag an existing `.svg` or `.png` onto the canvas (or press <kbd>⌘⇧I</kbd>). An SVG comes in as a single group with its internal ids namespaced so nothing collides; a PNG comes in as a 300 dpi embedded image. An imported SVG stays editable element by element — matplotlib output especially, if you generate it with `svg.fonttype: none`. See [Figures from code](/figures/from-code).

## How do I move an existing paper in?

If it is a Word document, use **Import .docx…** on the Welcome screen. It parses the file with no external binary and shows a review screen listing detected sections, references, mapped citations and extracted figures, with editable title, authors, affiliations and abstract fields — and it writes nothing until you press **Import into new project…** and pick a target folder. Two caveats to expect: Word equations (OMML) are counted and flagged, never converted, and if the document marks no corresponding author the first author is guessed.

If it is anything else, create a project with the wizard and paste your prose into `manuscript/manuscript.md`, then convert citations to `[@key]` form and figures to `![[fig:id]]` embeds. See [Quickstart](/guide/quickstart) and [Your project](/guide/project).

## Is my journal supported, and what if it is not?

Ten profiles are offered in the pickers. Each is transcribed from that journal's official author guidelines, with a source URL and a provenance tag on every value, and an explicit `null` — checked as "not stated" — wherever the journal says nothing.

| Profile | In-text citations |
| --- | --- |
| SUNA style (house default) | (Author, Year) |
| Science | Bracketed numbers [1] |
| Nature | Superscript numbers¹ |
| Neuron | Superscript numbers¹ |
| PNAS | Bracketed numbers [1] |
| Brain Stimulation | Bracketed numbers [1] |
| SLEEP | Bracketed numbers [1] |
| SLEEP Advances | Bracketed numbers [1] |
| Journal of Neural Engineering | Bracketed numbers [1] |
| Journal of Neuroscience | (Author, Year) |

If yours is not listed, draft in **SUNA style** — the house default, which states no limits and flags nothing — and pick the closest journal at export time for its citation format and figure widths. Two of the listed profiles are thin: Neuron, because Cell Press returned HTTP 403 to every fetch of its author pages, and SLEEP Advances, whose guidelines page states no citation style of its own. Read their limits against the journal's site before trusting them. See [Publisher profiles](/publishing/profiles).

::: warning Not built yet
You cannot add your own profile JSON. The loader supports profile inheritance internally, but nothing reads a project-local or user-supplied profile file, so the bundled set is the whole set.
:::

## Can the AI edit my prose without me noticing?

It can edit your prose — that is the point of the MCP layer — but not invisibly. The agent writes the same files you do, so every change shows up three ways: in your open editor immediately (external writes arrive as a minimal mapped change, so your cursor, scroll position and comment anchors survive), in Source control as a normal git diff, and in the file itself. If a buffer has unsaved edits when the file changes underneath it, you get a banner reading "changed on disk while you have unsaved edits" with **Reload from disk** and **Keep my version** — never a silent clobber.

Nothing runs on its own. The agent acts when you launch it: "Open Claude Code here", the `?` mode in the command palette, the `✦ AI` button on a comment, or the canvas Agent rail. Resolving a review comment is human-only — there is no `resolve_comment` verb, and `reply_comment`'s own description says so. Commit before a long agent session anyway; `write_manuscript` and `edit_manuscript` have full write access to your prose. See [MCP verbs](/ai/mcp).
