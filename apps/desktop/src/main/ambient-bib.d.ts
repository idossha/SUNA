// @suna/bib ships raw TS and relies on an ambient declaration for
// @retorquere/bibtex-parser (whose published types are missing). That ambient
// file is only in bib's own tsconfig include, so the desktop node (main
// process) program must reference it explicitly too — main/services/lit.ts
// re-exports from @suna/bib, which pulls in bib's parseBibtex.
// Mirrors src/renderer/src/views/ambient-bib.d.ts (same need, web program).
/// <reference path="../../../../packages/bib/src/retorquere-bibtex-parser.d.ts" />
