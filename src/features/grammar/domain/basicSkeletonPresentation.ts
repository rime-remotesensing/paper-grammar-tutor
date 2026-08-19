import type { SentenceCore, SentenceCoreSet } from '../schemas/grammarAnalysis.schema.ts'

/**
 * Prototype 2.6G2-F1 -- Basic Skeleton canonical presentation-text selection, isolated from
 * Structure Tree construction.
 *
 * Basic Skeleton always prefers the citation-free canonical PRESENTATION text produced by the
 * Stanza syntax authority's fine-grained citation pruning (2.6G2.5C4/C4.2) when one is
 * available, falling back to the constituent's own grounded `.text` otherwise -- exactly the
 * fallback the Qwen/LLM pipeline already gets for free, since it never populates these fields
 * (`effectiveCoreSet` may still be the legacy Qwen-derived `SentenceCoreSet` on the
 * legacy-qwen-fallback path; its presentation-text fields are simply always absent there).
 * `??` (never `||`) is deliberate: a genuinely empty string is a valid rendered value and must
 * not be treated the same as "no override".
 *
 * Zero Tree dependency -- this module imports only plain schema types.
 */
export interface BasicSkeletonDisplayText {
  subject: string | undefined
  indirectObject: string | undefined
  object: string | undefined
  complement: string | undefined
}

export function getBasicSkeletonDisplayText(
  effectiveCoreSet: SentenceCoreSet | null | undefined,
  legacyCore: SentenceCore,
): BasicSkeletonDisplayText {
  const primary = effectiveCoreSet?.predicateCores[0]
  return {
    subject: effectiveCoreSet?.subjectPresentationText ?? legacyCore.subject?.text,
    indirectObject: primary?.indirectObjectPresentationText ?? legacyCore.indirectObject?.text,
    object: primary?.objectPresentationText ?? legacyCore.object?.text,
    complement: primary?.complementPresentationText ?? legacyCore.complement?.text,
  }
}
