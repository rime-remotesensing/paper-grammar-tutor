import { describe, expect, it } from 'vitest'
import {
  buildSourceHighlightSegments,
  buildSourceHighlightSegmentsFromSourceText,
  projectAnalysisSpanToSourceHighlight,
} from '../../src/features/grammar/domain/sourceSentenceHighlight'
import { normalizeSentenceForGrammarAnalysis, projectSentenceForGrammarAnalysis } from '../../src/features/grammar/domain/grammarInputNormalization'
import { activeTreeNodeKey, EMPTY_TREE_READING_INTERACTION, reduceTreeReadingInteraction } from '../../src/features/grammar/domain/treeReadingInteraction'

describe('buildSourceHighlightSegments', () => {
  it('highlights an exact Tree span', () => {
    expect(buildSourceHighlightSegments('alpha beta gamma', { start: 6, end: 10 })).toEqual({
      before: 'alpha ', active: 'beta', after: ' gamma',
    })
  })

  it('highlights a nested Tree span without expanding to its parent', () => {
    expect(buildSourceHighlightSegments('can be rotated to the horizontal', { start: 15, end: 32 }).active)
      .toBe('to the horizontal')
  })

  it('uses offsets to distinguish repeated source text', () => {
    const sentence = 'signal and signal'
    expect(buildSourceHighlightSegments(sentence, { start: 11, end: 17 }).active).toBe('signal')
    expect(buildSourceHighlightSegments(sentence, { start: 11, end: 17 }).before).toBe('signal and ')
  })

  it('preserves multiline text around the active span', () => {
    const sentence = 'first line\nsecond line\nthird line'
    expect(buildSourceHighlightSegments(sentence, { start: 11, end: 22 })).toEqual({
      before: 'first line\n', active: 'second line', after: '\nthird line',
    })
  })

  it('highlights an opaque equation placeholder by normalized coordinates', () => {
    const sentence = 'value [EQUATION_6] follows'
    expect(buildSourceHighlightSegments(sentence, { start: 6, end: 18 }).active).toBe('[EQUATION_6]')
  })

  it('explicitly renders citation-free, equation-shielded normalized text rather than applying normalized offsets to raw text', () => {
    // Prototype 2.6G2.8A: the display-equation placeholder is no longer passed through to
    // the analysis-facing text at all -- it is replaced with the live-verified-safe neutral
    // surrogate (scientificTextShielding.ts) before anything downstream (Stanza, spans,
    // highlighting) ever sees it.
    const raw = 'The value [9] is given by [式 (5)].'
    const normalized = normalizeSentenceForGrammarAnalysis(raw)
    const start = 'The value is given by '.length
    const result = buildSourceHighlightSegments(normalized, { start, end: start + 'the formula'.length })

    expect(normalized).toBe('The value is given by the formula.')
    expect(result.active).toBe('the formula')
    expect(`${result.before}${result.active}${result.after}`).toBe(normalized)
    expect(`${result.before}${result.active}${result.after}`).not.toBe(raw)
  })

  it('returns the full sentence without a highlight when no node is active', () => {
    expect(buildSourceHighlightSegments('alpha beta', null)).toEqual({ before: 'alpha beta', active: null, after: '' })
  })

  it('mirrors hover override, pin restore, and Escape clear through one active state', () => {
    const sentence = 'alpha beta'
    const spans: Record<string, { start: number; end: number }> = { a: { start: 0, end: 5 }, b: { start: 6, end: 10 } }
    let state = reduceTreeReadingInteraction(EMPTY_TREE_READING_INTERACTION, { type: 'togglePin', key: 'a' })
    expect(buildSourceHighlightSegments(sentence, spans[activeTreeNodeKey(state)!]).active).toBe('alpha')

    state = reduceTreeReadingInteraction(state, { type: 'preview', key: 'b' })
    expect(buildSourceHighlightSegments(sentence, spans[activeTreeNodeKey(state)!]).active).toBe('beta')

    state = reduceTreeReadingInteraction(state, { type: 'leave', key: 'b' })
    expect(buildSourceHighlightSegments(sentence, spans[activeTreeNodeKey(state)!]).active).toBe('alpha')

    state = reduceTreeReadingInteraction(state, { type: 'clearPin' })
    expect(buildSourceHighlightSegments(sentence, null).active).toBeNull()
  })
})

/**
 * Prototype 2.6G2.8B item 17 -- the user-visible "英文" panel now shows the TRUE source
 * sentence (citations/equation placeholders intact), never the internal analysis projection.
 * Highlighting maps the active Tree span's TEXT (not its projection offsets, which are only
 * valid against the projection string) back into the real source via the same span-resolution
 * utility ReadingGuide grounding already trusts.
 */
describe('buildSourceHighlightSegmentsFromSourceText', () => {
  it('highlights the correct span in the TRUE source when the projection removed a citation before it', () => {
    const sourceText = 'The method [9] was applied successfully.'
    const projectionText = 'The method was applied successfully.'
    // In the projection, "applied" is at a different offset than in the true source.
    const start = projectionText.indexOf('applied')
    const end = start + 'applied'.length
    const result = buildSourceHighlightSegmentsFromSourceText(sourceText, projectionText, { start, end })
    expect(result.active).toBe('applied')
    expect(result.before).toBe('The method [9] was ')
    expect(result.after).toBe(' successfully.')
  })

  it('shows the source with no highlight (never a drifted one) when the active span text came from shielded material', () => {
    const sourceText = 'The value of k can then be used as a moderator for the cosine equation, as [式 (5)]'
    const projectionText = normalizeSentenceForGrammarAnalysis(sourceText)
    // "the formula" is the internal-only surrogate -- it never appears in sourceText at all.
    const start = projectionText.indexOf('the formula')
    const end = start + 'the formula'.length
    const result = buildSourceHighlightSegmentsFromSourceText(sourceText, projectionText, { start, end })
    expect(result.active).toBeNull()
    expect(result.before).toBe(sourceText)
    expect(result.after).toBe('')
  })

  it('returns the full source with no highlight when no node is active', () => {
    expect(buildSourceHighlightSegmentsFromSourceText('alpha beta', 'alpha beta', null)).toEqual({
      before: 'alpha beta', active: null, after: '',
    })
  })

  it('locates an unambiguous span correctly when source and projection are identical (no citation/equation involved)', () => {
    const sourceText = 'The signal was measured and logged.'
    const projectionText = sourceText
    const start = projectionText.indexOf('measured')
    const end = start + 'measured'.length
    const result = buildSourceHighlightSegmentsFromSourceText(sourceText, projectionText, { start, end })
    expect(result.before).toBe('The signal was ')
    expect(result.active).toBe('measured')
  })

  it('known limitation: a repeated exact phrase resolves to its FIRST occurrence in the source (text-search-based, not offset-based, unlike buildSourceHighlightSegments)', () => {
    const sourceText = 'The signal was measured and the signal was logged.'
    const projectionText = sourceText
    const start = projectionText.lastIndexOf('signal')
    const end = start + 'signal'.length
    const result = buildSourceHighlightSegmentsFromSourceText(sourceText, projectionText, { start, end })
    expect(result.before).toBe('The ')
    expect(result.active).toBe('signal')
  })

  it('never claims a highlight when projection offsets are invalid', () => {
    const result = buildSourceHighlightSegmentsFromSourceText('source text', 'projection', { start: -1, end: 5 })
    expect(result.active).toBeNull()
    expect(result.before).toBe('source text')
  })
})

/**
 * Prototype 2.6G2.8E -- the authoritative mapping (Track A). Replaces text search with exact
 * index lookup against `Projection.sourceIndexOf`, so short scientific variables and repeated
 * phrases resolve to their true, exact source occurrence, never the first textual match.
 */
describe('projectAnalysisSpanToSourceHighlight (LEVEL 2)', () => {
  function activeText(sourceText: string, runs: { start: number; end: number }[]): string {
    return runs.map((r) => sourceText.slice(r.start, r.end)).join('|')
  }

  const SHORT_VARIABLE_CASES: Array<{ name: string; sourceText: string; needle: string }> = [
    { name: 'a', sourceText: 'The parameter a can be estimated from the data.', needle: 'a' },
    { name: 'b', sourceText: 'The parameter b can be estimated from the data.', needle: 'b' },
    { name: 'k', sourceText: 'The value of k can then be used as a moderator.', needle: 'k' },
    { name: 'x', sourceText: 'The variable x can be solved for directly.', needle: 'x' },
    { name: 'L', sourceText: 'The radiance L can be measured at the sensor.', needle: 'L' },
    { name: 'Ln', sourceText: 'The normalized radiance Ln can be computed from L.', needle: 'Ln' },
    { name: 'Lavg', sourceText: 'The average radiance Lavg can be computed from L.', needle: 'Lavg' },
    { name: 'R2', sourceText: 'The coefficient R2 can be computed from the fit.', needle: 'R2' },
  ]

  it.each(SHORT_VARIABLE_CASES)(
    'highlights the true, exact occurrence of short variable "$name", never a substring inside an unrelated word',
    ({ sourceText, needle }) => {
      const projection = projectSentenceForGrammarAnalysis(sourceText)
      // These plain sentences have no citations/equations, so the projection is byte-identical
      // to the source -- the standalone token (space-padded) is the true variable occurrence.
      const trueStart = sourceText.indexOf(` ${needle} `) + 1
      const start = trueStart
      const end = start + needle.length
      const result = projectAnalysisSpanToSourceHighlight(sourceText, projection, { start, end })
      expect(result.activeRuns).toEqual([{ start: trueStart, end: trueStart + needle.length }])
      expect(activeText(sourceText, result.activeRuns)).toBe(needle)
    },
  )

  it('never highlights the "b" inside "be" for the live-reported regression sentence', () => {
    const sourceText =
      'This regression line can be rotated to the horizontal to normalize the data using the equation ' +
      '[式 (6)] where Ln is the normalized radiance, a and b are the y-intercept and slope of the ' +
      'regression line, respectively, and Lavg is the average of the measured radiance data.'
    const projection = projectSentenceForGrammarAnalysis(sourceText)
    const start = projection.text.indexOf('b are')
    const end = start + 1
    const result = projectAnalysisSpanToSourceHighlight(sourceText, projection, { start, end })
    const trueStart = sourceText.indexOf('b are')
    expect(result.activeRuns).toEqual([{ start: trueStart, end: trueStart + 1 }])
    expect(activeText(sourceText, result.activeRuns)).toBe('b')
    expect(activeText(sourceText, result.activeRuns)).not.toBe(sourceText[sourceText.indexOf('be rotated') + 1])
  })

  it('resolves the SECOND occurrence of a repeated phrase by exact position, never falling back to the first', () => {
    const sourceText = 'The value was compared with the value.'
    const projection = projectSentenceForGrammarAnalysis(sourceText)
    const start = projection.text.lastIndexOf('value')
    const end = start + 'value'.length
    const result = projectAnalysisSpanToSourceHighlight(sourceText, projection, { start, end })
    const trueStart = sourceText.lastIndexOf('value')
    expect(result.activeRuns).toEqual([{ start: trueStart, end: trueStart + 'value'.length }])
  })

  it('produces no highlight run when the span falls entirely on synthetic (source-less) text', () => {
    const sourceText = 'The angle approaches 90 as [式 (5)].'
    const projection = projectSentenceForGrammarAnalysis(sourceText)
    const start = projection.text.indexOf('the formula')
    const end = start + 'the formula'.length
    const result = projectAnalysisSpanToSourceHighlight(sourceText, projection, { start, end })
    expect(result.activeRuns).toEqual([])
  })

  it('splits into multiple runs when a span crosses removed content (a stripped citation)', () => {
    const sourceText = 'a moderator [9] for the cosine equation'
    const projection = projectSentenceForGrammarAnalysis(sourceText)
    // The full projected text ("a moderator for the cosine equation") has no removed content
    // left inside it, but a span constructed to straddle where the citation used to sit must
    // still resolve each side to its own exact, non-adjacent source run.
    const start = projection.text.indexOf('moderator')
    const end = projection.text.indexOf('for') + 'for'.length
    const result = projectAnalysisSpanToSourceHighlight(sourceText, projection, { start, end })
    expect(result.activeRuns.length).toBe(2)
    expect(activeText(sourceText, result.activeRuns)).toBe('moderator| for')
  })

  it('returns no highlight when no node is active', () => {
    const sourceText = 'alpha beta'
    const projection = projectSentenceForGrammarAnalysis(sourceText)
    const result = projectAnalysisSpanToSourceHighlight(sourceText, projection, null)
    expect(result.activeRuns).toEqual([])
    expect(result.sourceText).toBe(sourceText)
  })
})

/**
 * Prototype 2.6G2.8M2 -- a math-run placeholder ("MATH_EXPR") is entirely synthetic
 * character-by-character, but unlike the equation surrogate ("the formula", which stands in
 * for REMOVED content with no source range to show), its complete original source run is
 * still known via `Projection.syntheticRunSourceRanges` -- a Tree click on that node must
 * highlight the WHOLE original math run, not nothing.
 */
describe('projectAnalysisSpanToSourceHighlight -- math-run placeholder highlighting (M2)', () => {
  it('highlights the complete original math run when the span covers the MATH_EXPR token', () => {
    const sourceText = 'the result was k = 0.5 in this case.'
    const projection = projectSentenceForGrammarAnalysis(sourceText)
    const start = projection.text.indexOf('MATH_EXPR')
    const end = start + 'MATH_EXPR'.length
    const result = projectAnalysisSpanToSourceHighlight(sourceText, projection, { start, end })
    expect(result.activeRuns).toEqual([{ start: sourceText.indexOf('k = 0.5'), end: sourceText.indexOf('k = 0.5') + 'k = 0.5'.length }])
  })

  it('highlights the whole run even for a span nested WITHIN the token (e.g. a sub-node covering only part of it)', () => {
    const sourceText = 'the result was k = 0.5 in this case.'
    const projection = projectSentenceForGrammarAnalysis(sourceText)
    const tokenStart = projection.text.indexOf('MATH_EXPR')
    const result = projectAnalysisSpanToSourceHighlight(sourceText, projection, { start: tokenStart, end: tokenStart + 3 })
    expect(result.activeRuns).toEqual([{ start: sourceText.indexOf('k = 0.5'), end: sourceText.indexOf('k = 0.5') + 'k = 0.5'.length }])
  })

  it('a simple/stable math run (never shielded) still resolves via the ordinary exact-index path, not the synthetic-range path', () => {
    const sourceText = 'the response is proportional to cos i.'
    const projection = projectSentenceForGrammarAnalysis(sourceText)
    expect(projection.text).toBe(sourceText) // never shielded -- literal
    const start = projection.text.indexOf('cos i')
    const end = start + 'cos i'.length
    const result = projectAnalysisSpanToSourceHighlight(sourceText, projection, { start, end })
    expect(result.activeRuns).toEqual([{ start, end }])
  })

  it('a span outside any synthetic range still falls back to ordinary per-character mapping', () => {
    const sourceText = 'the result was k = 0.5 in this case.'
    const projection = projectSentenceForGrammarAnalysis(sourceText)
    const start = projection.text.indexOf('the result')
    const end = start + 'the'.length
    const result = projectAnalysisSpanToSourceHighlight(sourceText, projection, { start, end })
    expect(result.activeRuns).toEqual([{ start: sourceText.indexOf('the result'), end: sourceText.indexOf('the result') + 3 }])
  })
})
