import { describe, expect, it } from 'vitest'
import { normalizeSentenceForGrammarAnalysis } from '../../src/features/grammar/domain/grammarInputNormalization'
import { resolveSpan } from '../../src/utils/spanMatch'

const SENTENCE = 'The results obtained in the previous experiment indicate that the method is effective.'

describe('resolveSpan', () => {
  it('accepts correct offsets as-is', () => {
    const result = resolveSpan(SENTENCE, { text: 'The results', start: 0, end: 11 })
    expect(result).toEqual({ text: 'The results', start: 0, end: 11, resolved: true, corrected: false })
  })

  it('corrects wrong offsets when the text is an exact substring', () => {
    const result = resolveSpan(SENTENCE, { text: 'indicate', start: 0, end: 0 })
    expect(result.resolved).toBe(true)
    expect(result.corrected).toBe(true)
    expect(result.start).toBe(SENTENCE.indexOf('indicate'))
    expect(result.end).toBe(SENTENCE.indexOf('indicate') + 'indicate'.length)
  })

  it('falls back to whitespace-insensitive matching', () => {
    const result = resolveSpan(SENTENCE, {
      text: 'The results  obtained\nin the previous experiment',
      start: 0,
      end: 0,
    })
    expect(result.resolved).toBe(true)
    expect(result.text).toBe('The results obtained in the previous experiment')
  })

  it('flags spans that cannot be located at all', () => {
    const result = resolveSpan(SENTENCE, { text: 'a phrase not in the sentence', start: 0, end: 0 })
    expect(result.resolved).toBe(false)
    expect(result.start).toBe(-1)
    expect(result.end).toBe(-1)
  })

  it('resolves a span containing the Prototype 2.5G equation placeholder token exactly (item 52/53)', () => {
    const withEquation = 'The value of k can then be used as a moderator for the equation, as [EQUATION_5].'
    const result = resolveSpan(withEquation, { text: 'as [EQUATION_5]', start: 0, end: 0 })
    expect(result.resolved).toBe(true)
    expect(result.corrected).toBe(true)
    expect(result.text).toBe('as [EQUATION_5]')
    expect(withEquation.slice(result.start, result.end)).toBe('as [EQUATION_5]')
  })

  it('Prototype 2.5H item 32/12 (updated 2.6G2.8A): resolves spans against the citation-free, equation-shielded NORMALIZED analysis text, never raw source offsets', () => {
    const source = 'The value of k can then be used as a moderator [9] for the cosine equation, as [式 (5)]'
    const analysisText = normalizeSentenceForGrammarAnalysis(source)
    expect(analysisText).toBe('The value of k can then be used as a moderator for the cosine equation, as the formula.')
    // A span the LLM reports (e.g. the object/adverbial "as the formula") must resolve
    // against THIS normalized text -- its offsets would be meaningless against `source`,
    // which still contains "[9]"/"[式 (5)]" and has entirely different character positions.
    const result = resolveSpan(analysisText, { text: 'as the formula', start: 0, end: 0 })
    expect(result.resolved).toBe(true)
    expect(analysisText.slice(result.start, result.end)).toBe('as the formula')
  })
})
