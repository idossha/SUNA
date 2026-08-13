import { z } from 'zod';

export const FigureNamespaceSchema = z.enum(['main', 'extended-data', 'box']);
export type FigureNamespace = z.infer<typeof FigureNamespaceSchema>;

export const WidthPresetSchema = z.enum(['single', 'double']);
export type WidthPreset = z.infer<typeof WidthPresetSchema>;

export const CaptionAbbreviationSchema = z.object({
  abbr: z.string().min(1),
  def: z.string().min(1),
});
export type CaptionAbbreviation = z.infer<typeof CaptionAbbreviationSchema>;

export const CaptionSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
  credits: z.string().min(1).optional(),
  abbreviations: z.array(CaptionAbbreviationSchema).optional(),
});
export type Caption = z.infer<typeof CaptionSchema>;

export const PanelSchema = z.object({
  letter: z.string().regex(/^[a-z]$/),
  subLabels: z.array(z.string().min(1)).optional(),
});
export type Panel = z.infer<typeof PanelSchema>;

/** Stable SVG element id / gid (e.g. "ax0.title", "legend"). */
const TargetSchema = z.string().min(1);

export const SetStyleOpSchema = z.object({
  op: z.literal('set-style'),
  target: TargetSchema,
  props: z.record(z.string(), z.string()),
});
export type SetStyleOp = z.infer<typeof SetStyleOpSchema>;

export const SetTextOpSchema = z.object({
  op: z.literal('set-text'),
  target: TargetSchema,
  text: z.string(),
});
export type SetTextOp = z.infer<typeof SetTextOpSchema>;

export const SetAttrOpSchema = z.object({
  op: z.literal('set-attr'),
  target: TargetSchema,
  attrs: z.record(z.string(), z.string()),
});
export type SetAttrOp = z.infer<typeof SetAttrOpSchema>;

export const TranslateOpSchema = z.object({
  op: z.literal('translate'),
  target: TargetSchema,
  dx: z.number(),
  dy: z.number(),
});
export type TranslateOp = z.infer<typeof TranslateOpSchema>;

export const ScaleOpSchema = z.object({
  op: z.literal('scale'),
  target: TargetSchema,
  sx: z.number(),
  sy: z.number(),
  cx: z.number().optional(),
  cy: z.number().optional(),
});
export type ScaleOp = z.infer<typeof ScaleOpSchema>;

export const DeleteOpSchema = z.object({
  op: z.literal('delete'),
  target: TargetSchema,
});
export type DeleteOp = z.infer<typeof DeleteOpSchema>;

export const ReorderOpSchema = z.object({
  op: z.literal('reorder'),
  target: TargetSchema,
  mode: z.enum(['front', 'back', 'forward', 'backward']),
});
export type ReorderOp = z.infer<typeof ReorderOpSchema>;

export const InsertOpSchema = z.object({
  op: z.literal('insert'),
  parent: TargetSchema.optional(),
  index: z.number().int().nonnegative().optional(),
  svg: z.string().min(1),
});
export type InsertOp = z.infer<typeof InsertOpSchema>;

export const OverlayOpSchema = z.discriminatedUnion('op', [
  SetStyleOpSchema,
  SetTextOpSchema,
  SetAttrOpSchema,
  TranslateOpSchema,
  ScaleOpSchema,
  DeleteOpSchema,
  ReorderOpSchema,
  InsertOpSchema,
]);
export type OverlayOp = z.infer<typeof OverlayOpSchema>;

export const GeneratorSchema = z.object({
  script: z.string().min(1),
  entry: z.string().min(1).optional(),
  interpreter: z.string().min(1).optional(),
});
export type Generator = z.infer<typeof GeneratorSchema>;

/** Null provenance = figure drawn from scratch (plain SVG, no generating code). */
export const ProvenanceSchema = z.object({
  generator: GeneratorSchema,
  baseSvgHash: z.string().min(1).optional(),
  overlay: z.array(OverlayOpSchema),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** figure.json — one per figure directory, beside figure.svg. */
export const FigureDocumentSchema = z.object({
  id: z.string().min(1),
  caption: CaptionSchema,
  namespace: FigureNamespaceSchema,
  widthPreset: WidthPresetSchema,
  panels: z.array(PanelSchema),
  provenance: ProvenanceSchema.nullable(),
});
export type FigureDocument = z.infer<typeof FigureDocumentSchema>;
