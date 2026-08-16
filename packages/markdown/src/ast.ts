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

  interface ImageData {
    /**
     * The width from a `![alt](x.png){width=50%}` attribute block, already
     * normalised to a CSS length. Absent unless the source carried a
     * well-formed block.
     *
     * It is a CEILING, not a size: every renderer applies it as
     * `min(natural, requested, measure)`, so it can narrow an image but never
     * widen one past its natural size or past the measure. That is the one
     * reading the three renderers can agree on — reading mode narrows the
     * holder and leaves the art alone, and a definite width in the export
     * distorts the picture the moment the height cap binds.
     */
    width?: string;
  }
}

export type InlineMathNode = import('mdast').PhrasingContentMap['inlineMath'];
export type MathNode = import('mdast').BlockContentMap['math'];

export type SciMarkRoot = Root;
