/**
 * Labels for the AI's model tier and reasoning effort ('ai.model' /
 * 'ai.effort'). One table, three surfaces: the Settings tab's project scope,
 * its global scope, and the editor's quick-settings popover — a user who sets
 * "Sonnet · Low" in one of them must read the same words in the other two.
 */
import type { AiEffort, AiModel } from '@suna/core'

export const AI_MODEL_LABELS: Record<AiModel, string> = {
  opus: 'Opus (most capable)',
  sonnet: 'Sonnet (balanced)',
  haiku: 'Haiku (fastest)'
}

export const AI_EFFORT_LABELS: Record<AiEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max'
}

/** "Sonnet · Low" — the pair as one line, for a control that shows both. */
export function aiChoiceLabel(model: AiModel, effort: AiEffort): string {
  const modelName = AI_MODEL_LABELS[model].split(' (')[0]
  return `${modelName} · ${AI_EFFORT_LABELS[effort]}`
}
