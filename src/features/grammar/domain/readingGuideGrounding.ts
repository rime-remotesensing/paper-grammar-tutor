import { resolveSpanAfter } from '../../../utils/spanMatch.ts'
import type { LlmReadingGuide, ReadingGuide, ResolvedReadingStep } from '../schemas/readingGuide.schema.ts'
import { containsSimplifiedChineseCharacters } from './japaneseLanguagePurity.ts'

export type GroundReadingGuideResult =
  | { success: true; readingGuide: ReadingGuide }
  | { success: false; error: string }

/**
 * Re-derives each readingStep's position in `sentence` (never trusts the LLM's own claim,
 * same rationale as resolveAnalysisSpans.ts) and enforces the left-to-right reading-order
 * contract: every step must resolve to an exact substring of `sentence`, and each step's
 * resolved start must be strictly greater than the previous step's. That single strict-
 * increase check also rejects an exact duplicate span (same start reappearing) and a
 * source-order reversal — unchanged since Prototype 2.1.
 *
 * Prototype 2.3C: no `sentenceCore` parameter — the structural attachment tree
 * (`structureBranches`, which was the only reason grounding ever needed sentenceCore for
 * `attachTo` validation) moved entirely to predicateStructureGrounding.ts +
 * hybridPredicateMerger.ts. ReadingGuide grounding is purely about the sentence text now.
 */
export function groundReadingGuide(llm: LlmReadingGuide, sentence: string): GroundReadingGuideResult {
  const resolvedSteps: ResolvedReadingStep[] = []
  let nextStart = 0

  for (const step of llm.readingSteps) {
    const resolved = resolveSpanAfter(sentence, step.text, nextStart)
    if (!resolved.resolved) {
      return { success: false, error: `readingStep「${step.text}」が原文中に見つからないか、左から右への順序と一致しません。` }
    }
    resolvedSteps.push({
      text: resolved.text,
      // Prototype 2.3P item 2/4: a contaminated cue/explanation is blanked out rather than
      // dropping the whole step -- dropping would break the required left-to-right walk
      // (the exact reason an empty cue/explanation was already treated as a display nicety,
      // not a grounding failure, see the schema comment). The UI already renders cue/
      // explanation conditionally on non-empty, so this degrades to the same accepted
      // "model left it blank" state, never leaving Chinese text visible to the user.
      cue: containsSimplifiedChineseCharacters(step.cue) ? '' : step.cue,
      explanation: containsSimplifiedChineseCharacters(step.explanation) ? '' : step.explanation,
      start: resolved.start,
      end: resolved.end,
    })
    nextStart = resolved.end
  }

  return {
    success: true,
    readingGuide: {
      readingSteps: resolvedSteps,
      connections: dropBlankConnections(llm.connections),
      expressions: groundExpressions(llm.expressions, sentence),
      readingAdvice: llm.readingAdvice.filter((advice) => advice.trim().length > 0 && !containsSimplifiedChineseCharacters(advice)),
    },
  }
}

/**
 * Expressions are only useful if genuinely present in the sentence (Prototype 2.1 item 9:
 * "実際に文中にある場合のみ検出できる設計"). Unlike readingSteps, an unresolved,
 * duplicate-span, or incomplete (blank pattern/meaning/function) expression is silently
 * dropped rather than failing the whole Reading Guide — expressions are a supplementary
 * list, not the sentence's required backbone, so a partial list is an acceptable
 * degradation where a broken readingSteps sequence is not.
 *
 * Prototype 2.3P item 2/4: the same drop-not-fail treatment now also applies to an entry
 * whose pattern/meaning/function contains Simplified-Chinese-only characters (live
 * diagnosis found this specifically in `pattern`, e.g. "主語 + 动词" instead of "主語 +
 * 動詞") — a card with wrong-language text is worse than no card, matching this file's
 * existing "never show a broken/incomplete entry" precedent.
 */
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
    if (
      containsSimplifiedChineseCharacters(expr.pattern) ||
      containsSimplifiedChineseCharacters(expr.meaning) ||
      containsSimplifiedChineseCharacters(expr.function)
    )
      continue
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

/** Structure Tree already teaches these elementary shapes; keep the expression panel for
 * reusable lexical usage. Preposition-bearing combinations remain eligible. */
function isReusableExpression(text: string, pattern: string): boolean {
  const normalizedText = text.trim()
  if (/^where\b/i.test(normalizedText)) return false
  if (/^be\s*\+\s*past participle$/i.test(pattern.trim())) return false
  if (/^(?:can|may|must|should|could)\s+be\s+\w+(?:ed|en)$/i.test(normalizedText)) return false
  return true
}

/** Drops a connection entry if either field came back blank, OR if the explanation contains
 * Simplified-Chinese-only characters (Prototype 2.3P item 2/4) — a half-empty or
 * wrong-language card is not useful to show, but (unlike readingSteps) this is purely a
 * display-completeness filter, not a grounding/safety check, so it never fails the whole
 * Reading Guide. */
function dropBlankConnections(connections: LlmReadingGuide['connections']): ReadingGuide['connections'] {
  return connections.filter(
    (c) => c.text.trim().length > 0 && c.explanation.trim().length > 0 && !containsSimplifiedChineseCharacters(c.explanation),
  )
}
