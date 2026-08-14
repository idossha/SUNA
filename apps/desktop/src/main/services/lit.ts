/**
 * Literature providers — re-exported from `@suna/bib`, the shared module
 * both this main process and the standalone MCP server (packages/agent/src/mcp)
 * import, so the two hosts run the exact same provider fetch/mapping logic
 * (see @suna/bib/src/providers.ts for the full implementation and its tests).
 */
export { lookupByDoi, searchLiterature } from '@suna/bib'
