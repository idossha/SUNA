import type { CanvasCommand, CommandResult } from '@suna/core';
import { dispatch } from './commands';
import type { CanvasDocument } from './document';

export interface HistoryEntry {
  command: CanvasCommand;
  inverse: CanvasCommand;
  label?: string;
}

/**
 * Bounded undo/redo stack of {command, inverse} transactions
 * (canvas-engine.md §3). Undo dispatches inverses; redo replays the original
 * command. `batch` commands land as one entry, and an open transaction
 * coalesces every applied command into a single batch entry on commit.
 */
export class CommandHistory {
  private readonly doc: CanvasDocument;
  private readonly limit: number;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private txBuffer: HistoryEntry[] | null = null;
  private txLabel: string | undefined;

  constructor(doc: CanvasDocument, limit = 200) {
    this.doc = doc;
    this.limit = limit;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  get inTransaction(): boolean {
    return this.txBuffer !== null;
  }

  /** Record an already-dispatched command. New work clears the redo stack. */
  push(entry: HistoryEntry): void {
    if (this.txBuffer !== null) {
      this.txBuffer.push(entry);
      return;
    }
    this.undoStack.push(entry);
    this.redoStack = [];
    while (this.undoStack.length > this.limit) this.undoStack.shift();
  }

  /** Dispatch a command against the document and record it on success. */
  apply(command: CanvasCommand, label?: string): CommandResult {
    const result = dispatch(this.doc, command);
    if (result.ok) {
      const entry: HistoryEntry = { command, inverse: result.inverse };
      if (label !== undefined) entry.label = label;
      this.push(entry);
    }
    return result;
  }

  /**
   * Open a transaction: subsequent pushes buffer until commit(), then
   * coalesce into one batch entry (one undo step).
   */
  begin(label?: string): void {
    if (this.txBuffer !== null) throw new Error('transaction already open');
    this.txBuffer = [];
    this.txLabel = label;
  }

  commit(): void {
    const buffer = this.txBuffer;
    if (buffer === null) throw new Error('no open transaction');
    const label = this.txLabel;
    this.txBuffer = null;
    this.txLabel = undefined;
    if (buffer.length === 0) return;
    const single = buffer.length === 1 ? buffer[0] : undefined;
    if (single !== undefined) {
      const entry: HistoryEntry = { command: single.command, inverse: single.inverse };
      const entryLabel = label ?? single.label;
      if (entryLabel !== undefined) entry.label = entryLabel;
      this.push(entry);
      return;
    }
    const entry: HistoryEntry = {
      command: { kind: 'batch', commands: buffer.map((e) => e.command) },
      inverse: { kind: 'batch', commands: buffer.map((e) => e.inverse).reverse() },
    };
    if (label !== undefined) entry.label = label;
    this.push(entry);
  }

  undo(): CommandResult | null {
    const entry = this.undoStack.pop();
    if (entry === undefined) return null;
    const result = dispatch(this.doc, entry.inverse);
    if (result.ok) this.redoStack.push(entry);
    else this.undoStack.push(entry);
    return result;
  }

  redo(): CommandResult | null {
    const entry = this.redoStack.pop();
    if (entry === undefined) return null;
    const result = dispatch(this.doc, entry.command);
    if (result.ok) {
      const replayed: HistoryEntry = { command: entry.command, inverse: result.inverse };
      if (entry.label !== undefined) replayed.label = entry.label;
      this.undoStack.push(replayed);
    } else {
      this.redoStack.push(entry);
    }
    return result;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.txBuffer = null;
    this.txLabel = undefined;
  }
}
