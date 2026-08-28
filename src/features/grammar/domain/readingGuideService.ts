import { recordStageTiming } from '../../../llm/timing.ts'
import type { LLMProvider } from '../../../llm/types.ts'
import type { SentenceCore, Span } from '../schemas/grammarAnalysis.schema.ts'
import type { ReadingGuide } from '../schemas/readingGuide.schema.ts'
import { analyzeReadingGuide } from './ReadingGuideAnalyzer.ts'
import type { TreeReadingTarget } from './treeReadingTargets.ts'
import { treeReadingTargetSignature } from './treeReadingTargets.ts'

export type ReadingGuideOutcome =
  | { success: true; readingGuide: ReadingGuide; invalidTargetIds: string[]; duplicateTargetIds: string[] }
  | { success: false; error: string }

export interface ReadingGuideCacheKey {
  /** Normalized sentence used for prompt context and Expression grounding. */
  originalText: string
  model: string
  /** Effective core remains a defensive invalidation trigger alongside the authoritative
   * Tree-target signature. */
  sentenceCore: SentenceCore
  targets: readonly TreeReadingTarget[]
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
function cacheKeyOf({ originalText, model, sentenceCore, targets }: ReadingGuideCacheKey): string {
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
    treeReadingTargetSignature(targets),
  ].join('|')
}

/**
 * Runs (or reuses) ReadingGuide for text/model/effective-core/final-target identity.
 */
export async function getReadingGuide(params: GetReadingGuideParams): Promise<ReadingGuideOutcome> {
  const key = cacheKeyOf(params)
  const cached = cache.get(key)
  if (cached) return cached

  const startedAt = performance.now()
  const promise = analyzeReadingGuide({
    provider: params.provider,
    model: params.model,
    sentence: params.originalText,
    targets: params.targets,
    temperature: params.temperature,
  })
  promise.then(() => recordStageTiming('reading guide + expressions LLM', performance.now() - startedAt))

  cache.set(key, promise)
  // A failed generation shouldn't be remembered as "the" result for this key — the next
  // "再試行" click should get a clean retry, not the same rejected outcome forever.
  promise.then((outcome) => {
    if (!outcome.success && cache.get(key) === promise) cache.delete(key)
  })
  return promise
}
