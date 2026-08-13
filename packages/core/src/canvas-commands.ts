import { z } from 'zod';

/**
 * Canvas command vocabulary (canvas-engine.md §3).
 *
 * One serializable command union shared by the GUI editor, the properties
 * panel, and the AI agent tool layer. `@suna/canvas` dispatches these against
 * the live SVG DOM; inverses are themselves commands so undo/redo and agent
 * edits travel through the same bus.
 *
 * Note: overlay ops in `figure.ts` are a historical subset of this
 * vocabulary (per-figure provenance). Keep names aligned; do not merge.
 */

/** Element id, structural address ('#<ancestorId>>nth:<k>'), or '#root'. */
export type Target = string;
export const TargetSchema: z.ZodType<Target> = z.string().min(1);

export interface SetAttrsCommand {
  kind: 'set-attrs';
  target: Target;
  /** null deletes the attribute. */
  attrs: Record<string, string | null>;
}

export interface SetStyleCommand {
  kind: 'set-style';
  target: Target;
  /** null deletes the property. */
  props: Record<string, string | null>;
}

export interface SetTextCommand {
  kind: 'set-text';
  target: Target;
  text: string;
}

export interface TranslateCommand {
  kind: 'translate';
  targets: Target[];
  /** World units (root viewBox user units). */
  dx: number;
  dy: number;
}

export type MatrixTuple = [number, number, number, number, number, number];

export interface TransformCommand {
  kind: 'transform';
  target: Target;
  /** [a, b, c, d, e, f] as in matrix(a,b,c,d,e,f). */
  matrix: MatrixTuple;
  mode: 'replace' | 'compose';
}

export interface ReorderCommand {
  kind: 'reorder';
  target: Target;
  mode: 'front' | 'back' | 'forward' | 'backward';
}

export interface ReparentCommand {
  kind: 'reparent';
  target: Target;
  parent: Target;
  /** Element-child index after the move; omitted appends. */
  index?: number;
}

export interface GroupCommand {
  kind: 'group';
  targets: Target[];
  id?: string;
}

export interface UngroupCommand {
  kind: 'ungroup';
  target: Target;
}

export interface InsertCommand {
  kind: 'insert';
  /** Defaults to the root <svg>. */
  parent?: Target;
  /** Element-child index; omitted appends. */
  index?: number;
  svg: string;
  id?: string;
}

export interface RemoveCommand {
  kind: 'remove';
  targets: Target[];
}

export interface AlignCommand {
  kind: 'align';
  targets: Target[];
  axis: 'x' | 'y';
  mode: 'start' | 'center' | 'end';
}

export interface DistributeCommand {
  kind: 'distribute';
  targets: Target[];
  axis: 'x' | 'y';
}

export interface SetArtboardCommand {
  kind: 'set-artboard';
  widthMm?: number;
  heightMm?: number;
}

export interface BatchCommand {
  kind: 'batch';
  commands: CanvasCommand[];
  label?: string;
}

export type CanvasCommand =
  | SetAttrsCommand
  | SetStyleCommand
  | SetTextCommand
  | TranslateCommand
  | TransformCommand
  | ReorderCommand
  | ReparentCommand
  | GroupCommand
  | UngroupCommand
  | InsertCommand
  | RemoveCommand
  | AlignCommand
  | DistributeCommand
  | SetArtboardCommand
  | BatchCommand;

const AttrValueSchema = z.string().nullable();

export const SetAttrsCommandSchema = z.object({
  kind: z.literal('set-attrs'),
  target: TargetSchema,
  attrs: z.record(z.string(), AttrValueSchema),
});

export const SetStyleCommandSchema = z.object({
  kind: z.literal('set-style'),
  target: TargetSchema,
  props: z.record(z.string(), AttrValueSchema),
});

export const SetTextCommandSchema = z.object({
  kind: z.literal('set-text'),
  target: TargetSchema,
  text: z.string(),
});

export const TranslateCommandSchema = z.object({
  kind: z.literal('translate'),
  targets: z.array(TargetSchema),
  dx: z.number(),
  dy: z.number(),
});

export const MatrixTupleSchema: z.ZodType<MatrixTuple> = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);

export const TransformCommandSchema = z.object({
  kind: z.literal('transform'),
  target: TargetSchema,
  matrix: MatrixTupleSchema,
  mode: z.enum(['replace', 'compose']),
});

export const ReorderCommandSchema = z.object({
  kind: z.literal('reorder'),
  target: TargetSchema,
  mode: z.enum(['front', 'back', 'forward', 'backward']),
});

export const ReparentCommandSchema = z.object({
  kind: z.literal('reparent'),
  target: TargetSchema,
  parent: TargetSchema,
  index: z.number().int().nonnegative().optional(),
});

export const GroupCommandSchema = z.object({
  kind: z.literal('group'),
  targets: z.array(TargetSchema).min(1),
  id: z.string().min(1).optional(),
});

export const UngroupCommandSchema = z.object({
  kind: z.literal('ungroup'),
  target: TargetSchema,
});

export const InsertCommandSchema = z.object({
  kind: z.literal('insert'),
  parent: TargetSchema.optional(),
  index: z.number().int().nonnegative().optional(),
  svg: z.string().min(1),
  id: z.string().min(1).optional(),
});

export const RemoveCommandSchema = z.object({
  kind: z.literal('remove'),
  targets: z.array(TargetSchema).min(1),
});

export const AlignCommandSchema = z.object({
  kind: z.literal('align'),
  targets: z.array(TargetSchema).min(1),
  axis: z.enum(['x', 'y']),
  mode: z.enum(['start', 'center', 'end']),
});

export const DistributeCommandSchema = z.object({
  kind: z.literal('distribute'),
  targets: z.array(TargetSchema).min(1),
  axis: z.enum(['x', 'y']),
});

export const SetArtboardCommandSchema = z.object({
  kind: z.literal('set-artboard'),
  widthMm: z.number().positive().optional(),
  heightMm: z.number().positive().optional(),
});

export const BatchCommandSchema = z.object({
  kind: z.literal('batch'),
  commands: z.lazy((): z.ZodType<CanvasCommand[]> => z.array(CanvasCommandSchema)),
  label: z.string().optional(),
});

export const CanvasCommandSchema: z.ZodType<CanvasCommand> = z.discriminatedUnion('kind', [
  SetAttrsCommandSchema,
  SetStyleCommandSchema,
  SetTextCommandSchema,
  TranslateCommandSchema,
  TransformCommandSchema,
  ReorderCommandSchema,
  ReparentCommandSchema,
  GroupCommandSchema,
  UngroupCommandSchema,
  InsertCommandSchema,
  RemoveCommandSchema,
  AlignCommandSchema,
  DistributeCommandSchema,
  SetArtboardCommandSchema,
  BatchCommandSchema,
]);

export const CommandErrorCodeSchema = z.enum([
  'target-not-found',
  'invalid-svg',
  'text-on-non-text',
  'invalid-command',
]);
export type CommandErrorCode = z.infer<typeof CommandErrorCodeSchema>;

export interface CommandError {
  code: CommandErrorCode;
  message: string;
}
export const CommandErrorSchema: z.ZodType<CommandError> = z.object({
  code: CommandErrorCodeSchema,
  message: z.string(),
});

export interface CommandSuccess {
  ok: true;
  /** Applying this command restores the pre-dispatch state. */
  inverse: CanvasCommand;
  /** Ids of touched elements (structural addresses report their minted id). */
  affected: string[];
}

export interface CommandFailure {
  ok: false;
  error: CommandError;
  affected: string[];
}

export type CommandResult = CommandSuccess | CommandFailure;

export const CommandResultSchema: z.ZodType<CommandResult> = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    inverse: CanvasCommandSchema,
    affected: z.array(z.string()),
  }),
  z.object({
    ok: z.literal(false),
    error: CommandErrorSchema,
    affected: z.array(z.string()),
  }),
]);
