// @suna/bib ships raw TS and relies on an ambient declaration for
// @retorquere/bibtex-parser (whose published types are missing). That ambient
// file is only in bib's own tsconfig include, so the desktop web program must
// reference it explicitly for `import { parseBibtex } from '@suna/bib'`.
/// <reference path="../../../../../../packages/bib/src/retorquere-bibtex-parser.d.ts" />
