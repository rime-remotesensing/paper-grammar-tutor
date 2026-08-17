import { z } from 'zod'

/**
 * Prototype 2.5W — Focused Where-Clause Repair schema. A tiny, single-purpose LLM call:
 * given a sentence, a list of predicate candidates that would actually survive the merger
 * (never the raw, possibly-rejected Stage-2 predicate list — see whereClauseGate.ts's own
 * doc comment for why), and one "where ..." clause left as a loose sentence-level modifier,
 * decides which predicate the clause belongs to (or null to abstain when genuinely
 * ambiguous) and splits it into its internal finite subject-verb units. See
 * docs/design-notes.md (Prototype 2.5V) for the validated spike numbers this schema was
 * measured against (20/20 exact-target, 5/5 correct abstention on a genuine ambiguity
 * control, zero flattening once integrated with merger-accepted candidates only).
 */

export const llmFocusedWhereClauseRepairSchema = z.object({
  owner: z.string().min(1).nullable(),
  children: z.array(z.string().min(1)).min(1),
})
export type LlmFocusedWhereClauseRepair = z.infer<typeof llmFocusedWhereClauseRepairSchema>
