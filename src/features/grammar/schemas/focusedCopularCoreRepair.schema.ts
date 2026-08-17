import { z } from 'zod'

/**
 * Prototype 2.5W — Focused Copular Core Repair schema. A tiny, single-purpose LLM call:
 * given a sentence whose Stage-1 GrammarAnalysis core is suspected of misclassifying a
 * copular subject complement (e.g. "is a function of X" mislabeled as an object, or the
 * verb over-capturing the complement), asks ONLY for the PRIMARY clause's subject / bare
 * copular verb / subject complement — nothing else (no object/indirectObject/clauses/
 * offsets/explanations). See docs/design-notes.md (Prototype 2.5V) for the validated
 * spike numbers this schema was measured against (20/20 exact-target, 15/15 passive
 * negative controls, 0 false triggers).
 */

export const llmFocusedCopularCoreRepairSchema = z.object({
  subject: z.string().min(1),
  verb: z.string().min(1),
  complement: z.string().min(1),
})
export type LlmFocusedCopularCoreRepair = z.infer<typeof llmFocusedCopularCoreRepairSchema>
