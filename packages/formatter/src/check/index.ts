export type {
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticSurface,
  DiagnosticTarget,
} from './types';
export { checkFigureSvg } from './figure';
export {
  checkManuscript,
  countWords,
  scanFigureReferences,
  WORDS_PER_REFERENCE_ESTIMATE,
  type FigureReferenceScan,
  type ManuscriptCheckInput,
} from './manuscript';
