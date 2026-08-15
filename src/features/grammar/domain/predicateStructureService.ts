import type { LLMProvider } from '../../../llm/types.ts'
import type { SentenceCore, Span } from '../schemas/grammarAnalysis.schema.ts'
import type { PredicateStructure } from '../schemas/predicateStructure.schema.ts'
import { analyzePredicateStructure } from './PredicateStructureAnalyzer.ts'

export type PredicateStructureOutcome =
  | { success: true; structure: PredicateStructure }
  | { success: false; error: string }

export interface PredicateStructureCacheKey {
  /** Must be the same text sentenceCore's own spans were resolved against
   * (GrammarAnalysis.normalizedText). */
  originalText: string
  model: string
  /** Prototype 2.3C item 26: cache key includes sentenceCore. The raw LLM call itself
   * (analyzePredicateStructure) does not read sentenceCore, but the hybrid-merged result
   * the UI ultimately shows depends on BOTH the raw structure and sentenceCore together —
   * keying on sentenceCore too means a forced-core recovery (which changes sentenceCore
   * without necessarily changing originalText) can't leave a stale structure cached under
   * a key that looks unrelated to the change that just happened. */
  sentenceCore: SentenceCore
}

export interface GetPredicateStructureParams extends PredicateStructureCacheKey {
  provider: LLMProvider
  temperature: number
}

/**
 * In-memory PredicateStructure cache, independent from the ReadingGuide cache
 * (readingGuideService.ts, Prototype 2.3C item 26) and from the OCR page caches — its own
 * module-level Map. Values are promises so concurrent requests for the same key share one
 * LLM call instead of firing it twice.
 */
let cache = new Map<string, Promise<PredicateStructureOutcome>>()

export function resetPredicateStructureCache(): void {
  cache = new Map()
}

function spanKey(span: Span | null): string {
  return span ? `${span.start}:${span.end}:${span.text}` : 'null'
}

function cacheKeyOf({ originalText, model, sentenceCore }: PredicateStructureCacheKey): string {
  return [
    originalText,
    model,
    sentenceCore.pattern,
    spanKey(sentenceCore.subject),
    spanKey(sentenceCore.subjectHead),
    spanKey(sentenceCore.verb),
    spanKey(sentenceCore.indirectObject),
    spanKey(sentenceCore.object),
    spanKey(sentenceCore.complement),
  ].join('|')
}

/**
 * Runs (or reuses a cached) structure generation for the given (text, model, sentenceCore)
 * triple. Never invoked automatically — only alongside ReadingGuide from the
 * user-triggered "英語の語順で読む" click (see readingSupportOrchestrator.ts), and only
 * once sentenceCore is confirmed (not in core-failure state).
 */
export async function getPredicateStructure(params: GetPredicateStructureParams): Promise<PredicateStructureOutcome> {
  const key = cacheKeyOf(params)
  const cached = cache.get(key)
  if (cached) return cached

  const promise = analyzePredicateStructure({
    provider: params.provider,
    model: params.model,
    sentence: params.originalText,
    temperature: params.temperature,
  })

  cache.set(key, promise)
  // A failed generation shouldn't be remembered as "the" result for this key — the next
  // retry click should get a clean attempt, not the same rejected outcome forever.
  promise.then((outcome) => {
    if (!outcome.success && cache.get(key) === promise) cache.delete(key)
  })
  return promise
}
