import { describe, expect, it } from 'vitest'
import {
  normalizeSentenceForGrammarAnalysis,
  normalizeSentenceForReadingGuide,
  projectSentenceForGrammarAnalysis,
} from '../../src/features/grammar/domain/grammarInputNormalization.ts'

describe('normalizeSentenceForGrammarAnalysis', () => {
  it('removes citations AND shields the display equation in one pass (the real Soenen sentence, Prototype 2.6G2.8A)', () => {
    const source = 'The value of k can then be used as a moderator [9] for the cosine equation, as [式 (5)]'
    // Citation removed, equation replaced with the live-verified-safe neutral surrogate --
    // never left as the literal "[EQUATION_5]" token Stanza would otherwise parse as an
    // ordinary grammatical constituent (see scientificTextShielding.ts's own doc comment).
    expect(normalizeSentenceForGrammarAnalysis(source)).toBe(
      'The value of k can then be used as a moderator for the cosine equation, as the formula.',
    )
  })

  it('is a no-op on text with neither citations nor an equation placeholder', () => {
    const source = 'The results indicate that the method is effective.'
    expect(normalizeSentenceForGrammarAnalysis(source)).toBe(source)
  })

  it('handles citation-only text (no equation placeholder present)', () => {
    expect(normalizeSentenceForGrammarAnalysis('This was shown previously [7].')).toBe('This was shown previously.')
  })

  it('handles equation-only text (no citation present)', () => {
    expect(normalizeSentenceForGrammarAnalysis('the result follows, as [式 (5)]')).toBe('the result follows, as the formula.')
  })

  it('(Prototype 2.6G2.8B Case C) drops a genuinely new, capital-letter-signalled sentence that follows the equation', () => {
    // The PDF layout service's own reconstruction joins PROSE_GROUP/DISPLAY_EQUATION/
    // PROSE_GROUP segments with "\n" (services/pymupdf_layout/main.py), which
    // normalizePdfSelectionText then collapses to a plain space indistinguishably from an
    // ordinary line-wrap -- by the time this function runs, the only remaining signal is the
    // general capitalization rule in scientificTextShielding.ts.
    const source =
      'The value of k can then be used as a moderator [9] for the cosine equation, as [式 (5)] ' +
      'In the case of lower k values, the denominator is increased and counteracts the overcorrection.'
    expect(normalizeSentenceForGrammarAnalysis(source)).toBe(
      'The value of k can then be used as a moderator for the cosine equation, as the formula.',
    )
  })

  it('(Prototype 2.6G2.8B Case A) preserves a sentence that genuinely continues past a display equation, across two equations', () => {
    const source =
      'The parameter C is a function of the regression slope (b) and intercept (a) [9] [式 (8)] ' +
      'and is introduced to the cosine correction model as an additive term [式 (9)]'
    expect(normalizeSentenceForGrammarAnalysis(source)).toBe(
      'The parameter C is a function of the regression slope (b) and intercept (a) and is introduced to the cosine correction model as an additive term.',
    )
  })
})

const PROJECTION_EQUIVALENCE_CASES = [
  'This regression line can be rotated to the horizontal to normalize the data using the equation [式 (6)] where Ln is the normalized radiance, a and b are the y-intercept and slope of the regression line, respectively, and Lavg is the average of the measured radiance data.',
  'A citation [9] appears mid-sentence and continues normally.',
  'A citation sequence [1]–[3], [9], [11] appears here.',
  'The angle approaches 90 as [式 (5)].',
  'The intercept (a) [式 (8)] and is introduced later as an additive term [式 (9)].',
  'No equations or citations at all in this plain sentence.',
  '[9] A leading citation with nothing before it.',
]

describe('Prototype 2.6G2.8E -- projectSentenceForGrammarAnalysis matches the string pipeline (LEVEL 1)', () => {
  it.each(PROJECTION_EQUIVALENCE_CASES)('produces byte-identical .text output for: %s', (sourceText) => {
    const expected = normalizeSentenceForGrammarAnalysis(sourceText)
    const projected = projectSentenceForGrammarAnalysis(sourceText)
    expect(projected.text).toBe(expected)
    expect(projected.sourceIndexOf.length).toBe(projected.text.length)
  })

  it('maps the "b" in "a and b are" to its exact source index, not the "b" in "be rotated"', () => {
    const sourceText = PROJECTION_EQUIVALENCE_CASES[0]
    const projected = projectSentenceForGrammarAnalysis(sourceText)
    const bIndex = projected.text.indexOf('b are')
    expect(projected.sourceIndexOf[bIndex]).toBe(sourceText.indexOf('b are'))
  })

  it('marks the equation-surrogate replacement text as fully synthetic', () => {
    const sourceText = 'The angle approaches 90 as [式 (5)].'
    const projected = projectSentenceForGrammarAnalysis(sourceText)
    const surrogateStart = projected.text.indexOf('the formula')
    expect(surrogateStart).toBeGreaterThanOrEqual(0)
    for (let i = surrogateStart; i < surrogateStart + 'the formula'.length; i++) {
      expect(projected.sourceIndexOf[i]).toBeNull()
    }
  })
})

/**
 * Prototype 2.6G2.8M2.2c -- MATH_EXPR is a Stanza SYNTAX-SHIELDING token, never source text
 * (item 2's own explicit requirement). `normalizeSentenceForReadingGuide` must give
 * ReadingGuide/Ollama the source-faithful relational math text Stanza itself never sees.
 */
describe('normalizeSentenceForReadingGuide', () => {
  it('never shields relational math -- the real live parameter sentence stays literal', () => {
    const source = 'the parameters for the r.slopeunits algorithm were determined as t = 200,000 m², a = 5,000 m², c = 0.3, and r = 10.'
    const result = normalizeSentenceForReadingGuide(source)
    expect(result).toBe(source)
    expect(result).not.toContain('MATH_EXPR')
  })

  it('produces different output than the Stanza-facing pipeline for the same relational sentence', () => {
    const source = 'The parameters were determined as t = 1 and r = 2.'
    const stanzaInput = normalizeSentenceForGrammarAnalysis(source)
    const readingGuideInput = normalizeSentenceForReadingGuide(source)
    expect(stanzaInput).toBe('The parameters were determined as MATH_EXPR and MATH_EXPR.')
    expect(readingGuideInput).toBe('The parameters were determined as t = 1 and r = 2.')
    expect(readingGuideInput).not.toBe(stanzaInput)
  })

  it('still removes citations and shields display equations, same as the Stanza pipeline', () => {
    const source = 'The value of k can then be used as a moderator [9] for the cosine equation, as [式 (5)]'
    expect(normalizeSentenceForReadingGuide(source)).toBe('The value of k can then be used as a moderator for the cosine equation, as the formula.')
  })

  it('is a no-op on text with no citations/equations/math at all', () => {
    const source = 'The results indicate that the method is effective.'
    expect(normalizeSentenceForReadingGuide(source)).toBe(source)
  })

  it('matches the Stanza pipeline exactly for a sentence with no relational math to shield (e.g. bare cos i, simple/stable per M1.1 policy)', () => {
    const source = 'The response is proportional to cos i.'
    expect(normalizeSentenceForReadingGuide(source)).toBe(normalizeSentenceForGrammarAnalysis(source))
  })
})
