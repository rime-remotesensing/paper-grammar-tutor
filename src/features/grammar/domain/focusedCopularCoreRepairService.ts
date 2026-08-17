import type { LLMProvider } from '../../../llm/types.ts'
import { repairFocusedCopularCore, type FocusedCopularCoreRepairResult } from './FocusedCopularCoreRepairer.ts'

export type FocusedCopularCoreRepairOutcome =
  | { success: true; result: FocusedCopularCoreRepairResult }
  | { success: false; error: string }

export interface FocusedCopularCoreRepairCacheKey {
  originalText: string
  model: string
  stage2Hint: string | null
}

export interface GetFocusedCopularCoreRepairParams extends FocusedCopularCoreRepairCacheKey {
  provider: LLMProvider
  temperature: number
}

/**
 * In-memory cache for Focused Copular Core Repair (Prototype 2.5W), independent from every
 * other LLM-result cache in the app — its own module-level Map, same philosophy as
 * focusedSubjectVerbRepairService.ts. Success-only: a technical failure is evicted so the
 * next attempt gets a clean retry rather than replaying the same rejected outcome forever.
 * `stage2Hint` is part of the cache key (item 14) even though it is not wired to a live
 * value in this phase — future callers that do supply it get correctly-scoped caching.
 */
let cache = new Map<string, Promise<FocusedCopularCoreRepairOutcome>>()

export function resetFocusedCopularCoreRepairCache(): void {
  cache = new Map()
}

function cacheKeyOf({ originalText, model, stage2Hint }: FocusedCopularCoreRepairCacheKey): string {
  return [originalText, model, stage2Hint ?? 'null'].join('|')
}

export async function getFocusedCopularCoreRepair(params: GetFocusedCopularCoreRepairParams): Promise<FocusedCopularCoreRepairOutcome> {
  const key = cacheKeyOf(params)
  const cached = cache.get(key)
  if (cached) return cached

  const promise = repairFocusedCopularCore({
    provider: params.provider,
    model: params.model,
    sentence: params.originalText,
    temperature: params.temperature,
    stage2Hint: params.stage2Hint,
  })

  cache.set(key, promise)
  promise.then((outcome) => {
    if (!outcome.success && cache.get(key) === promise) cache.delete(key)
  })
  return promise
}
