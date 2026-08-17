import type { LLMProvider } from '../../../llm/types.ts'
import type { Span } from '../schemas/grammarAnalysis.schema.ts'
import { repairFocusedWhereClause, type FocusedWhereClauseRepairResult } from './FocusedWhereClauseRepairer.ts'

export type FocusedWhereClauseRepairOutcome =
  | { success: true; result: FocusedWhereClauseRepairResult }
  | { success: false; error: string }

export interface FocusedWhereClauseRepairCacheKey {
  originalText: string
  model: string
  clauseSpan: Span
  acceptedPredicateCandidates: string[]
}

export interface GetFocusedWhereClauseRepairParams extends FocusedWhereClauseRepairCacheKey {
  provider: LLMProvider
  temperature: number
}

/**
 * In-memory cache for Focused Where-Clause Repair (Prototype 2.5W), independent from every
 * other LLM-result cache in the app — its own module-level Map, same philosophy as
 * focusedSubjectVerbRepairService.ts / focusedCopularCoreRepairService.ts. Success-only: a
 * technical failure is evicted so the next attempt gets a clean retry.
 */
let cache = new Map<string, Promise<FocusedWhereClauseRepairOutcome>>()

export function resetFocusedWhereClauseRepairCache(): void {
  cache = new Map()
}

function spanKey(span: Span): string {
  return `${span.start}:${span.end}:${span.text}`
}

function cacheKeyOf({ originalText, model, clauseSpan, acceptedPredicateCandidates }: FocusedWhereClauseRepairCacheKey): string {
  return [originalText, model, spanKey(clauseSpan), acceptedPredicateCandidates.join(',')].join('|')
}

export async function getFocusedWhereClauseRepair(params: GetFocusedWhereClauseRepairParams): Promise<FocusedWhereClauseRepairOutcome> {
  const key = cacheKeyOf(params)
  const cached = cache.get(key)
  if (cached) return cached

  const promise = repairFocusedWhereClause({
    provider: params.provider,
    model: params.model,
    sentence: params.originalText,
    temperature: params.temperature,
    clauseSpan: params.clauseSpan,
    acceptedPredicateCandidates: params.acceptedPredicateCandidates,
  })

  cache.set(key, promise)
  promise.then((outcome) => {
    if (!outcome.success && cache.get(key) === promise) cache.delete(key)
  })
  return promise
}
