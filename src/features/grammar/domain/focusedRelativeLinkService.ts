import type { LLMProvider } from '../../../llm/types.ts'
import { analyzeFocusedRelativeLink } from './FocusedRelativeLinkAnalyzer.ts'
import { groundRelativeLinkRelations, type GroundedRelativeLinkRelation } from './relativeLinkGrounding.ts'

export type FocusedRelativeLinkOutcome =
  | { success: true; relations: GroundedRelativeLinkRelation[] }
  | { success: false; error: string }

export interface FocusedRelativeLinkCacheKey {
  /** Prototype 2.3O item 15: relative-link analysis depends ONLY on the sentence text and
   * model, never on sentenceCore -- unlike PredicateStructure/ReadingGuide's cache keys, no
   * sentenceCore component is included here, since a core repair that leaves the source text
   * unchanged has no bearing on where relative clauses sit in that text. */
  originalText: string
  model: string
}

export interface GetFocusedRelativeLinkParams extends FocusedRelativeLinkCacheKey {
  provider: LLMProvider
  temperature: number
}

/**
 * In-memory Focused Relative-Link cache, independent from the ReadingGuide/PredicateStructure
 * caches -- its own module-level Map. Values are promises so concurrent requests for the same
 * key share one LLM call instead of firing it twice (item 49/50: re-opening "英語の語順で
 * 読む" for the same sentence/model must not re-call).
 */
let cache = new Map<string, Promise<FocusedRelativeLinkOutcome>>()

export function resetFocusedRelativeLinkCache(): void {
  cache = new Map()
}

function cacheKeyOf({ originalText, model }: FocusedRelativeLinkCacheKey): string {
  return [originalText, model].join('|')
}

/**
 * Runs (or reuses a cached) Focused Relative-Link generation for the given (text, model)
 * pair, then grounds+mechanically-sanity-checks every relation (relativeLinkGrounding.ts)
 * before returning -- callers never see an ungrounded relation. A technical failure (item
 * 48) resolves to `{success: false}` and is NOT cached (item 15: "technical failureは
 * cacheしない"), so the next retry gets a clean attempt.
 */
export async function getFocusedRelativeLink(params: GetFocusedRelativeLinkParams): Promise<FocusedRelativeLinkOutcome> {
  const key = cacheKeyOf(params)
  const cached = cache.get(key)
  if (cached) return cached

  const promise = analyzeFocusedRelativeLink({
    provider: params.provider,
    model: params.model,
    sentence: params.originalText,
    temperature: params.temperature,
  }).then((result): FocusedRelativeLinkOutcome => {
    if (!result.success) return { success: false, error: result.error }
    return { success: true, relations: groundRelativeLinkRelations(params.originalText, result.relations) }
  })

  cache.set(key, promise)
  promise.then((outcome) => {
    if (!outcome.success && cache.get(key) === promise) cache.delete(key)
  })
  return promise
}
