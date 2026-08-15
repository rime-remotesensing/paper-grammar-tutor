import { z } from 'zod'

/**
 * Prototype 2.3I — production port of the Prototype 2.3H feasibility spike's focused
 * complement verifier schema, unchanged. A third, tiny, single-purpose LLM call:
 * given a candidate SVOC reading (subject/verb/object/candidate complement as plain text,
 * no offsets), decide whether the candidate complement genuinely predicates the object
 * (OBJECT_COMPLEMENT — e.g. "found the sensor operating normally") or is a comma-attached
 * supplementary -ing addition to the whole main clause that GrammarAnalysis mistakenly
 * folded into `complement` (SUPPLEMENTARY_ING — the target failure class, e.g. "describe
 * the algorithm, emphasizing..."). Never asked anything else — no translation, no reading
 * guide, no relative-clause work (Prototype 2.3H item 9). See docs/design-notes.md.
 */

export const focusedClassificationSchema = z.enum(['OBJECT_COMPLEMENT', 'SUPPLEMENTARY_ING', 'UNCERTAIN'])
export type FocusedClassification = z.infer<typeof focusedClassificationSchema>

export const focusedReasonCodeSchema = z.enum(['OBJECT_PREDICATION', 'COMMA_SUPPLEMENT', 'INSUFFICIENT_EVIDENCE'])
export type FocusedReasonCode = z.infer<typeof focusedReasonCodeSchema>

export const llmFocusedComplementVerificationSchema = z.object({
  classification: focusedClassificationSchema,
  reasonCode: focusedReasonCodeSchema,
})
export type LlmFocusedComplementVerification = z.infer<typeof llmFocusedComplementVerificationSchema>
