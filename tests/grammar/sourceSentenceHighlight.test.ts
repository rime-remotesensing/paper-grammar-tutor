import { describe, expect, it } from 'vitest'
import { buildSourceHighlightSegments } from '../../src/features/grammar/domain/sourceSentenceHighlight'
import { normalizeSentenceForGrammarAnalysis } from '../../src/features/grammar/domain/grammarInputNormalization'
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

  it('explicitly renders citation-free normalized text rather than applying normalized offsets to raw text', () => {
    const raw = 'The value [9] is given by [式 (5)].'
    const normalized = normalizeSentenceForGrammarAnalysis(raw)
    const start = 'The value is given by '.length
    const result = buildSourceHighlightSegments(normalized, { start, end: start + '[EQUATION_5]'.length })

    expect(normalized).toBe('The value is given by [EQUATION_5].')
    expect(result.active).toBe('[EQUATION_5]')
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
