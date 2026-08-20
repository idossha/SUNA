export type {
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticSurface,
  DiagnosticTarget,
} from './types';
export { checkFigureSvg } from './figure';
export { checkLetter, type LetterCheckInput } from './letter';
export { checkResponse, unassignedPoints, type ResponseCheckInput } from './response';
export {
  checkManuscript,
  countWords,
  scanFigureReferences,
  WORDS_PER_REFERENCE_ESTIMATE,
  type FigureReferenceScan,
  type ManuscriptCheckInput,
} from './manuscript';
