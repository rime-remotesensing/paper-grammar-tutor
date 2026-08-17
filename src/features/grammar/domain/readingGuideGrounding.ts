import { resolveSpanAfter } from '../../../utils/spanMatch.ts'
import type { LlmReadingGuide, ReadingGuide } from '../schemas/readingGuide.schema.ts'
import type { TreeReadingTarget } from './treeReadingTargets.ts'
import { containsSimplifiedChineseCharacters } from './japaneseLanguagePurity.ts'

export interface GroundReadingGuideResult {
  readingGuide: ReadingGuide
  invalidTargetIds: string[]
  duplicateTargetIds: string[]
}

/** Validates model-owned note IDs against the application request set. Unknown/duplicate,
 * blank, or wrong-language notes are dropped without disturbing valid notes or Expressions.
 * Tree text and offsets never come from this result. */
export function groundReadingGuide(
  llm: LlmReadingGuide,
  sentence: string,
  targets: readonly TreeReadingTarget[],
): GroundReadingGuideResult {
  const allowedIds = new Set(targets.map(({ targetId }) => targetId))
  const invalidTargetIds: string[] = []
  const targetIdCounts = new Map<string, number>()
  for (const step of llm.readingSteps) {
    targetIdCounts.set(step.targetId, (targetIdCounts.get(step.targetId) ?? 0) + 1)
  }
  const duplicateTargetIds = [...targetIdCounts]
    .filter(([, count]) => count > 1)
    .map(([targetId]) => targetId)
  const readingSteps: ReadingGuide['readingSteps'] = []

  for (const step of llm.readingSteps) {
    if (!allowedIds.has(step.targetId)) {
      invalidTargetIds.push(step.targetId)
      continue
    }
    // Conflicting guidance for one target is ambiguous. Drop every occurrence rather
    // than silently choosing the first model-owned note.
    if ((targetIdCounts.get(step.targetId) ?? 0) > 1) continue
    const guidance = step.guidance.trim()
    if (!guidance || containsSimplifiedChineseCharacters(guidance)) continue
    readingSteps.push({ targetId: step.targetId, guidance })
  }

  return {
    readingGuide: {
      readingSteps,
      expressions: groundExpressions(llm.expressions, sentence),
    },
    invalidTargetIds,
    duplicateTargetIds,
  }
}

function groundExpressions(
  expressions: LlmReadingGuide['expressions'],
  sentence: string,
): ReadingGuide['expressions'] {
  const seenSpans = new Set<string>()
  const grounded: ReadingGuide['expressions'] = []
  let nextStart = 0
  for (const expr of expressions) {
    if (!expr.pattern.trim() || !expr.meaning.trim() || !expr.function.trim()) continue
    if (!isReusableExpression(expr.text, expr.pattern)) continue
    if (containsBibliographicCitation(`${expr.pattern} ${expr.meaning} ${expr.function}`)) continue
    if (
      containsSimplifiedChineseCharacters(expr.pattern) ||
      containsSimplifiedChineseCharacters(expr.meaning) ||
      containsSimplifiedChineseCharacters(expr.function)
    ) continue
    const resolved = resolveSpanAfter(sentence, expr.text, nextStart)
    if (!resolved.resolved) continue
    const spanKey = `${resolved.start}:${resolved.end}`
    if (seenSpans.has(spanKey)) continue
    seenSpans.add(spanKey)
    grounded.push({ ...expr, text: resolved.text, start: resolved.start, end: resolved.end })
    nextStart = resolved.end
  }
  return grounded
}

function isReusableExpression(text: string, pattern: string): boolean {
  const normalizedText = text.trim()
  if (/\bbe\s+based\s+on\b/i.test(pattern) && !/\bbased\s+on\b/i.test(normalizedText)) return false
  if (/^where\b/i.test(normalizedText)) return false
  if (/^be\s*\+\s*past participle$/i.test(pattern.trim())) return false
  if (/^(?:can|may|must|should|could)\s+be\s+\w+(?:ed|en)$/i.test(normalizedText)) return false
  return true
}

function containsBibliographicCitation(text: string): boolean {
  return /\bet\s+al\.|\b(?:19|20)\d{2}[a-z]?\b/i.test(text)
}
