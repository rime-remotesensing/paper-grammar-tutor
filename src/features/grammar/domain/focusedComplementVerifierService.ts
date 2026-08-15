import type { LLMProvider } from '../../../llm/types.ts'
import type { Span } from '../schemas/grammarAnalysis.schema.ts'
import type { FocusedClassification, FocusedReasonCode } from '../schemas/focusedComplementVerification.schema.ts'
import { verifyFocusedComplement } from './FocusedComplementVerifier.ts'

export type FocusedComplementVerificationOutcome =
  | { success: true; classification: FocusedClassification; reasonCode: FocusedReasonCode }
  | { success: false; error: string }

export interface FocusedComplementVerifierCacheKey {
  originalText: string
  model: string
  subject: Span
  verb: Span
  indirectObject: Span | null
  object: Span
  complement: Span
}

export interface GetFocusedComplementVerificationParams extends FocusedComplementVerifierCacheKey {
  provider: LLMProvider
  temperature: number
}

/**
 * In-memory cache for the focused complement verifier (Prototype 2.3I item 7), independent
 * from every other LLM-result cache in the app (ReadingGuide/PredicateStructure/OCR) — its
 * own module-level Map. Cache key includes `indirectObject` even though the verifier
 * prompt itself never reads it (only subject/verb/object/complement are sent — see
 * FocusedComplementVerifier.ts) — defensive parity with the full candidate core, same
 * rationale as the other 2.3C-era caches keying on more of sentenceCore than their prompt
 * strictly needs.
 *
 * UNCERTAIN is cached (it is a completed, successful verifier response, not a technical
 * failure) — only a JSON-parse/schema-validation failure (even after the one repair
 * attempt) is treated as a failure and evicted, so a later attempt gets a clean retry
 * rather than replaying the same rejected outcome forever.
 */
let cache = new Map<string, Promise<FocusedComplementVerificationOutcome>>()

export function resetFocusedComplementVerifierCache(): void {
  cache = new Map()
}

function spanKey(span: Span | null): string {
  return span ? `${span.start}:${span.end}:${span.text}` : 'null'
}

function cacheKeyOf({ originalText, model, subject, verb, indirectObject, object, complement }: FocusedComplementVerifierCacheKey): string {
  return [originalText, model, spanKey(subject), spanKey(verb), spanKey(indirectObject), spanKey(object), spanKey(complement)].join('|')
}

export async function getFocusedComplementVerification(
  params: GetFocusedComplementVerificationParams,
): Promise<FocusedComplementVerificationOutcome> {
  const key = cacheKeyOf(params)
  const cached = cache.get(key)
  if (cached) return cached

  const promise = verifyFocusedComplement({
    provider: params.provider,
    model: params.model,
    sentence: params.originalText,
    subject: params.subject.text,
    verb: params.verb.text,
    object: params.object.text,
    complement: params.complement.text,
    temperature: params.temperature,
  })

  cache.set(key, promise)
  promise.then((outcome) => {
    if (!outcome.success && cache.get(key) === promise) cache.delete(key)
  })
  return promise
}
