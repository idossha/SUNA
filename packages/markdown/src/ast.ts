import type { Literal, Node, Root } from 'mdast';

export type CrossRefKind = 'fig' | 'tbl' | 'eq' | 'sec';

export interface CitationNode extends Node {
  type: 'citation';
  keys: string[];
  narrative: boolean;
}

export interface CrossRefNode extends Node {
  type: 'crossRef';
  kind: CrossRefKind;
  id: string;
  suffix?: string;
}

export interface FigureEmbedNode extends Node {
  type: 'figureEmbed';
  figureId: string;
}

export interface RawLatexNode extends Literal {
  type: 'rawLatex';
}

declare module 'mdast' {
  interface PhrasingContentMap {
    citation: CitationNode;
    crossRef: CrossRefNode;
  }

  interface BlockContentMap {
    figureEmbed: FigureEmbedNode;
    rawLatex: RawLatexNode;
  }

  interface RootContentMap {
    citation: CitationNode;
    crossRef: CrossRefNode;
    figureEmbed: FigureEmbedNode;
    rawLatex: RawLatexNode;
  }
}

export type InlineMathNode = import('mdast').PhrasingContentMap['inlineMath'];
export type MathNode = import('mdast').BlockContentMap['math'];

export type SciMarkRoot = Root;
