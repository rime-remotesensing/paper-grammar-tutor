import { z } from 'zod'

/**
 * Prototype 2.3L — production port of the Prototype 2.3J feasibility spike's Focused
 * Subject-Verb Repair schema, unchanged. A fourth, tiny, single-purpose LLM call: given a
 * sentence whose GrammarAnalysis core failed with SUBJECT_VERB_OVERLAP (the subject
 * span swallowed the main verb, e.g. subject="We found the sensor" verb="found"), asks
 * ONLY for the main-clause subject/subjectHead/verb — nothing else (no IO/O/C, no clause
 * classification, no translation). Validated in Prototype 2.3J/2.3K: 61/61 correct on
 * actual routed SUBJECT_VERB_OVERLAP cases, 0 worse-after-repair, ~263ms average latency.
 * See docs/design-notes.md.
 */

export const llmFocusedSubjectVerbRepairSchema = z.object({
  subject: z.string().min(1),
  subjectHead: z.string().min(1),
  verb: z.string().min(1),
})
export type LlmFocusedSubjectVerbRepair = z.infer<typeof llmFocusedSubjectVerbRepairSchema>
