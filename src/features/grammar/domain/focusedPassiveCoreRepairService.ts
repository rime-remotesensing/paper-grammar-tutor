import type { LLMProvider } from '../../../llm/types.ts'
import type { Span, SentencePattern } from '../schemas/grammarAnalysis.schema.ts'
import { repairFocusedPassiveCore, type FocusedPassiveCoreRepairResult } from './FocusedPassiveCoreRepairer.ts'

export type FocusedPassiveCoreRepairOutcome =
  | { success: true; result: FocusedPassiveCoreRepairResult }
  | { success: false; error: string }

export interface FocusedPassiveCoreRepairCacheKey {
  originalText: string
  model: string
  verb: Span
  /** Not sent to the prompt itself, but part of the cache key (item 15): the decision this
   * call answers is scoped to "does THIS core's claimed O/C structure hold up", so a
   * different current pattern/object/indirectObject/complement is a different question even
   * for the same sentence+verb. */
  pattern: SentencePattern
  object: Span | null
  indirectObject: Span | null
  complement: Span | null
}

export interface GetFocusedPassiveCoreRepairParams extends FocusedPassiveCoreRepairCacheKey {
  provider: LLMProvider
  temperature: number
}

/**
 * In-memory cache for Focused Passive-Core Overcomplement Repair (Prototype 2.5Z),
 * independent from every other LLM-result cache in the app — its own module-level Map, same
 * philosophy as focusedCopularCoreRepairService.ts. Success-only: a technical failure is
 * evicted so the next attempt gets a clean retry rather than replaying the same rejected
 * outcome forever.
 */
let cache = new Map<string, Promise<FocusedPassiveCoreRepairOutcome>>()

export function resetFocusedPassiveCoreRepairCache(): void {
  cache = new Map()
}

function spanKey(span: Span | null): string {
  return span ? `${span.start}:${span.end}:${span.text}` : 'null'
}

function cacheKeyOf({ originalText, model, verb, pattern, object, indirectObject, complement }: FocusedPassiveCoreRepairCacheKey): string {
  return [originalText, model, spanKey(verb), pattern, spanKey(object), spanKey(indirectObject), spanKey(complement)].join('|')
}

export async function getFocusedPassiveCoreRepair(params: GetFocusedPassiveCoreRepairParams): Promise<FocusedPassiveCoreRepairOutcome> {
  const key = cacheKeyOf(params)
  const cached = cache.get(key)
  if (cached) return cached

  const promise = repairFocusedPassiveCore({
    provider: params.provider,
    model: params.model,
    sentence: params.originalText,
    temperature: params.temperature,
    verbText: params.verb.text,
  })

  cache.set(key, promise)
  promise.then((outcome) => {
    if (!outcome.success && cache.get(key) === promise) cache.delete(key)
  })
  return promise
}
