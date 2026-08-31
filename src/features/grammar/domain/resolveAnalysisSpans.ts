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

  const resolveAfter = (span: Span | null, label: string, minimumStart: number): Span | null => {
    if (span === null) return null
    const start = normalizedText.indexOf(span.text, Math.max(0, minimumStart))
    if (start < 0) return resolve(span, label)
    return { text: span.text, start, end: start + span.text.length }
  }

  const subject = resolve(analysis.sentenceCoreSet.subject, '主語')
  const subjectHead = resolve(analysis.sentenceCoreSet.subjectHead, '主語の中心語')
  let predicateCursor = subject?.end ?? 0
  const predicateCores = analysis.sentenceCoreSet.predicateCores.map((core, index) => {
    const verb = resolveAfter(core.verb, index === 0 ? '主動詞' : `述語${index + 1}の動詞`, predicateCursor)
    let connector: Span | null = null
    if (index > 0 && core.connector && verb?.start !== undefined && verb.start >= predicateCursor) {
      const connectorStart = normalizedText.indexOf(core.connector.text, predicateCursor)
      if (connectorStart >= predicateCursor && connectorStart + core.connector.text.length <= verb.start) {
        connector = { text: core.connector.text, start: connectorStart, end: connectorStart + core.connector.text.length }
      }
    }
    if (verb && verb.start >= 0) predicateCursor = verb.end
    return {
      ...core,
      connector,
      verb,
      indirectObject: resolve(core.indirectObject, `述語${index + 1}の間接目的語`),
      object: resolve(core.object, `述語${index + 1}の目的語`),
      complement: resolve(core.complement, `述語${index + 1}の補語`),
    }
  })

  return {
    unresolvedNotes,
    analysis: {
      ...analysis,
      sentenceCoreSet: {
        ...analysis.sentenceCoreSet,
        subject,
        subjectHead,
        predicateCores,
      },
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
