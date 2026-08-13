// The published package points "types" at dist/types, which is absent from the
// npm tarball (v10.0.1). Shapes below were verified against dist/esm at runtime.
declare module '@retorquere/bibtex-parser' {
  export interface Creator {
    lastName?: string;
    firstName?: string;
    prefix?: string;
    suffix?: string;
    initial?: string;
    name?: string;
  }

  export type FieldValue = string | string[] | Creator[];

  export interface Entry {
    type: string;
    key: string;
    fields: Record<string, FieldValue>;
    mode: Record<string, string>;
    input: string;
  }

  export interface ParseError {
    error: string;
    input?: string;
  }

  export interface Bibliography {
    errors: ParseError[];
    entries: Entry[];
    comments: string[];
    strings: Record<string, string>;
    preamble: string[];
  }

  export interface ParseOptions {
    raw?: boolean;
    sentenceCase?:
      | boolean
      | { guess?: boolean; subSentence?: boolean; preserveQuoted?: boolean };
    caseProtection?: boolean | 'as-needed' | 'strict';
    english?: boolean | string[];
    applyCrossRef?: boolean;
    languageAsLangid?: boolean;
    strings?: Record<string, string>;
  }

  export function parse(input: string, options?: ParseOptions): Bibliography;
  export function parseAsync(input: string, options?: ParseOptions): Promise<Bibliography>;
}
