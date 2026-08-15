import type { LLMProvider } from '../../../llm/types.ts'
import type { SentenceCore, Span } from '../schemas/grammarAnalysis.schema.ts'
import type { ReadingGuide } from '../schemas/readingGuide.schema.ts'
import { analyzeReadingGuide } from './ReadingGuideAnalyzer.ts'

export type ReadingGuideOutcome =
  | { success: true; readingGuide: ReadingGuide }
  | { success: false; error: string }

export interface ReadingGuideCacheKey {
  /** The text Reading Guide is generated/grounded against — pass
   * GrammarAnalysis.normalizedText here, the same text sentenceCore's own spans were
   * resolved against, not the raw pre-normalization input. */
  originalText: string
  model: string
  /** Prototype 2.3C item 26: cache key includes sentenceCore even though
   * analyzeReadingGuide itself no longer reads it (ReadingGuide dropped its sentenceCore
   * dependency — see ReadingGuideAnalyzer.ts). Kept as a defensive invalidation trigger:
   * a forced-core recovery means the confirmed analysis materially changed, and the cache
   * should not silently keep serving a Reading Guide generated under the pre-recovery
   * state just because the raw sentence text happened to stay the same. */
  sentenceCore: SentenceCore
}

export interface GetReadingGuideParams extends ReadingGuideCacheKey {
  provider: LLMProvider
  temperature: number
}

/**
 * In-memory Reading Guide cache, entirely separate from the OCR page caches
 * (paddleOcrService.ts / highResPageCache.ts / ocrService.ts) and from the independent
 * PredicateStructure cache (predicateStructureService.ts, Prototype 2.3C item 26) — a
 * different module-level Map. Values are promises so concurrent requests for the same key
 * share one LLM call instead of firing it twice.
 */
let cache = new Map<string, Promise<ReadingGuideOutcome>>()

export function resetReadingGuideCache(): void {
  cache = new Map()
}

function spanKey(span: Span | null): string {
  return span ? `${span.start}:${span.end}:${span.text}` : 'null'
}

/** Field-by-field, not JSON.stringify — deterministic regardless of object key order,
 * and changes whenever any constituent of the core (including its resolved offsets)
 * changes, which is exactly what should invalidate a cached Reading Guide. */
function cacheKeyOf({ originalText, model, sentenceCore }: ReadingGuideCacheKey): string {
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
 * Runs (or reuses a cached) Reading Guide generation for the given (text, model,
 * sentenceCore) triple. Never invoked automatically — only from the user-triggered
 * "英語の語順で読む" click, and only once sentenceCore is confirmed (not in core-failure
 * state) — see AnalysisResultPanel, which gates the click itself.
 */
export async function getReadingGuide(params: GetReadingGuideParams): Promise<ReadingGuideOutcome> {
  const key = cacheKeyOf(params)
  const cached = cache.get(key)
  if (cached) return cached

  const promise = analyzeReadingGuide({
    provider: params.provider,
    model: params.model,
    sentence: params.originalText,
    temperature: params.temperature,
  })

  cache.set(key, promise)
  // A failed generation shouldn't be remembered as "the" result for this key — the next
  // "再試行" click should get a clean retry, not the same rejected outcome forever.
  promise.then((outcome) => {
    if (!outcome.success && cache.get(key) === promise) cache.delete(key)
  })
  return promise
}
