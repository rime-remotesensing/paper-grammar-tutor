import { describe, expect, it } from 'vitest'
import { normalizeSentenceForGrammarAnalysis } from '../../src/features/grammar/domain/grammarInputNormalization.ts'

describe('normalizeSentenceForGrammarAnalysis', () => {
  it('removes citations AND converts the equation placeholder in one pass (the real Soenen sentence)', () => {
    const source = 'The value of k can then be used as a moderator [9] for the cosine equation, as [式 (5)]'
    expect(normalizeSentenceForGrammarAnalysis(source)).toBe('The value of k can then be used as a moderator for the cosine equation, as [EQUATION_5]')
  })

  it('is a no-op on text with neither citations nor an equation placeholder', () => {
    const source = 'The results indicate that the method is effective.'
    expect(normalizeSentenceForGrammarAnalysis(source)).toBe(source)
  })

  it('handles citation-only text (no equation placeholder present)', () => {
    expect(normalizeSentenceForGrammarAnalysis('This was shown previously [7].')).toBe('This was shown previously.')
  })

  it('handles equation-only text (no citation present)', () => {
    expect(normalizeSentenceForGrammarAnalysis('the result follows, as [式 (5)]')).toBe('the result follows, as [EQUATION_5]')
  })
})
