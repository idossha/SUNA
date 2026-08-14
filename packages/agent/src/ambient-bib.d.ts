// @suna/bib ships raw TS and relies on an ambient declaration for
// @retorquere/bibtex-parser (whose published types are missing). That ambient
// file is only in bib's own tsconfig include, so any program that pulls in
// @suna/bib must reference it explicitly. packages/agent/src/mcp/lit.ts now
// imports appendLitResultToBib/searchLiterature/lookupByDoi from @suna/bib,
// which transitively pulls in parseBibtex.
// Mirrors apps/desktop/src/{renderer/src/views,main}/ambient-bib.d.ts.
/// <reference path="../../bib/src/retorquere-bibtex-parser.d.ts" />
