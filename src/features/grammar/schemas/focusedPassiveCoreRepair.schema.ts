import { z } from 'zod'

/**
 * Prototype 2.5Z — Focused Passive-Core Overcomplement Repair schema. A tiny, single-purpose
 * LLM call: given a sentence whose Stage-1 core has a passive-shaped verb (e.g. "can be
 * rotated") yet claims an SVC/SVOC complement, asks ONLY whether the primary clause
 * genuinely has a Japanese five-pattern subject complement — nothing else (no subject, no
 * verb, no object, no offsets, no explanations). See docs/design-notes.md (Prototype 2.5Y)
 * for the validated spike numbers this schema was measured against (15/15 correct
 * repairs, 0/25 false triggers).
 */

export const llmFocusedPassiveCoreRepairSchema = z.object({
  pattern: z.enum(['SV', 'SVC']),
  complement: z.string().min(1).nullable(),
})
export type LlmFocusedPassiveCoreRepair = z.infer<typeof llmFocusedPassiveCoreRepairSchema>
