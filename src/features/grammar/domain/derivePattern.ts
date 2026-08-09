import type { LlmSentenceCore, SentencePattern, Span } from '../schemas/grammarAnalysis.schema.ts'

/**
 * Derives the SV/SVC/SVO/SVOO/SVOC label mechanically from which constituents are
 * present, instead of asking the LLM for it directly. Prototype 0 showed the LLM's
 * own `pattern` answer could contradict the S/V/O/C spans it had just produced
 * (e.g. filling `object` + `complement` but labelling the sentence "SVOO"). Since
 * the mapping from constituents to pattern name is a fixed, well-defined rule, it
 * is more reliable to compute it than to ask a small model to classify it.
 *
 * `indirectObject` only counts toward SVOO when `object` (the direct object) is also
 * present; an indirect object without a direct object is not a coherent 5-pattern
 * reading, so that combination falls back to 'other' rather than being guessed at.
 */
export function derivePattern(core: {
  verb: Span | null
  indirectObject: Span | null
  object: Span | null
  complement: Span | null
}): SentencePattern {
  if (!core.verb) return 'other'

  const hasIndirectObject = core.indirectObject !== null
  const hasObject = core.object !== null
  const hasComplement = core.complement !== null

  if (hasIndirectObject && !hasObject) return 'other'
  if (hasIndirectObject && hasObject) return 'SVOO'
  if (hasObject && hasComplement) return 'SVOC'
  if (hasObject) return 'SVO'
  if (hasComplement) return 'SVC'
  return 'SV'
}

export function attachDerivedPattern(
  core: LlmSentenceCore,
): LlmSentenceCore & { pattern: SentencePattern } {
  return { ...core, pattern: derivePattern(core) }
}
