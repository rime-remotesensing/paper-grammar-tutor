import { resolveSpan } from '../../../utils/spanMatch.ts'
import type { LlmGrammarAnalysis, Span } from '../schemas/grammarAnalysis.schema.ts'

export interface SpanResolutionResult {
  analysis: LlmGrammarAnalysis
  /** Japanese, human-readable notes about spans the app could not locate in the sentence. */
  unresolvedNotes: string[]
}

/**
 * Re-derives start/end for every span the LLM returned by locating its text in
 * `normalizedText`, since the model's own offsets are frequently off by a few
 * characters. Spans that cannot be found at all are left with start/end -1 and
 * surfaced as uncertainties instead of silently trusted.
 */
export function resolveAnalysisSpans(
  analysis: LlmGrammarAnalysis,
  normalizedText: string,
): SpanResolutionResult {
  const unresolvedNotes: string[] = []

  const resolve = (span: Span | null, label: string): Span | null => {
    if (span === null) return null
    const resolved = resolveSpan(normalizedText, span)
    if (!resolved.resolved) {
      unresolvedNotes.push(`${label}「${span.text}」が原文中に見つかりませんでした。`)
    }
    return { text: resolved.text, start: resolved.start, end: resolved.end }
  }

  const resolveRequired = (span: Span, label: string): Span => {
    const result = resolve(span, label)
    return result ?? span
  }

  return {
    unresolvedNotes,
    analysis: {
      ...analysis,
      sentenceCore: {
        ...analysis.sentenceCore,
        subject: resolve(analysis.sentenceCore.subject, '主語'),
        subjectHead: resolve(analysis.sentenceCore.subjectHead, '主語の中心語'),
        verb: resolve(analysis.sentenceCore.verb, '主動詞'),
        indirectObject: resolve(analysis.sentenceCore.indirectObject, '間接目的語'),
        object: resolve(analysis.sentenceCore.object, '目的語'),
        complement: resolve(analysis.sentenceCore.complement, '補語'),
      },
      chunks: analysis.chunks.map((chunk) => ({
        ...chunk,
        span: resolveRequired(chunk.span, '意味のまとまり'),
      })),
      modifiers: analysis.modifiers.map((modifier) => ({
        ...modifier,
        phrase: resolveRequired(modifier.phrase, '修飾句'),
        target: resolve(modifier.target, '修飾先'),
      })),
      clauses: analysis.clauses.map((clause) => ({
        ...clause,
        span: resolveRequired(clause.span, '節'),
      })),
      phrases: analysis.phrases.map((phrase) => ({
        ...phrase,
        span: resolveRequired(phrase.span, '熟語・定型表現'),
      })),
    },
  }
}
