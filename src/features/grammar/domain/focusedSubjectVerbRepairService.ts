import type { LLMProvider } from '../../../llm/types.ts'
import type { Span } from '../schemas/grammarAnalysis.schema.ts'
import { repairFocusedSubjectVerb, type FocusedSubjectVerbRepairResult } from './FocusedSubjectVerbRepairer.ts'

export type FocusedSubjectVerbRepairOutcome =
  | { success: true; result: FocusedSubjectVerbRepairResult }
  | { success: false; error: string }

export interface FocusedSubjectVerbRepairCacheKey {
  originalText: string
  model: string
  /** The RAW (broken) subject/subjectHead/verb that triggered SUBJECT_VERB_OVERLAP —
   * item 13 of the 2.3L order: included for defensive cache-key parity with the other
   * 2.3C/2.3I-era caches, even though the underlying prompt only sends `originalText`
   * (see FocusedSubjectVerbRepairPrompt.ts — it re-derives subject/verb from scratch,
   * never reads the raw broken values at all). */
  rawSubject: Span | null
  rawSubjectHead: Span | null
  rawVerb: Span | null
}

export interface GetFocusedSubjectVerbRepairParams extends FocusedSubjectVerbRepairCacheKey {
  provider: LLMProvider
  temperature: number
}

/**
 * In-memory cache for Focused Subject-Verb Repair, independent from every other LLM-result
 * cache in the app (ReadingGuide/PredicateStructure/FocusedComplementVerifier/OCR) — its
 * own module-level Map. Success-only: a technical failure (malformed output even after the
 * one repair attempt) is evicted so the next attempt gets a clean retry rather than
 * replaying the same rejected outcome forever.
 */
let cache = new Map<string, Promise<FocusedSubjectVerbRepairOutcome>>()

export function resetFocusedSubjectVerbRepairCache(): void {
  cache = new Map()
}

function spanKey(span: Span | null): string {
  return span ? `${span.start}:${span.end}:${span.text}` : 'null'
}

function cacheKeyOf({ originalText, model, rawSubject, rawSubjectHead, rawVerb }: FocusedSubjectVerbRepairCacheKey): string {
  return [originalText, model, spanKey(rawSubject), spanKey(rawSubjectHead), spanKey(rawVerb)].join('|')
}

export async function getFocusedSubjectVerbRepair(
  params: GetFocusedSubjectVerbRepairParams,
): Promise<FocusedSubjectVerbRepairOutcome> {
  const key = cacheKeyOf(params)
  const cached = cache.get(key)
  if (cached) return cached

  const promise = repairFocusedSubjectVerb({
    provider: params.provider,
    model: params.model,
    sentence: params.originalText,
    temperature: params.temperature,
  })

  cache.set(key, promise)
  promise.then((outcome) => {
    if (!outcome.success && cache.get(key) === promise) cache.delete(key)
  })
  return promise
}
