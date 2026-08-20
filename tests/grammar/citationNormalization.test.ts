import { describe, expect, it } from 'vitest'
import { removeCitationMarkersForAnalysis } from '../../src/features/grammar/domain/citationNormalization.ts'

describe('removeCitationMarkersForAnalysis', () => {
  it('removes a single mid-sentence citation "[9]"', () => {
    expect(removeCitationMarkersForAnalysis('The value of k can then be used as a moderator [9] for the cosine equation.')).toBe(
      'The value of k can then be used as a moderator for the cosine equation.',
    )
  })

  it('removes a single citation "[1]"', () => {
    expect(removeCitationMarkersForAnalysis('This method was proposed [1] for correction.')).toBe('This method was proposed for correction.')
  })

  it('removes a single citation "[11]" (two digits)', () => {
    expect(removeCitationMarkersForAnalysis('as described in the paper [11] previously.')).toBe('as described in the paper previously.')
  })

  it('removes a citation list "[9], [11]" as one unit', () => {
    expect(removeCitationMarkersForAnalysis('this was shown [9], [11] previously.')).toBe('this was shown previously.')
  })

  it('removes a citation range "[1]–[3]" (en dash) as one unit', () => {
    expect(removeCitationMarkersForAnalysis('several approaches [1]–[3] exist.')).toBe('several approaches exist.')
  })

  it('removes the exact real Failure A/B fixture citation sequence cleanly (item 7/20)', () => {
    const withCitations = 'applied in forested areas [1]–[3], [9], [11] and are based on an'
    expect(removeCitationMarkersForAnalysis(withCitations)).toBe('applied in forested areas and are based on an')
  })

  it('produces no double space and no dangling comma/dash after range+list removal', () => {
    const result = removeCitationMarkersForAnalysis('methods [1]–[3], [9], [11] were compared.')
    expect(result).toBe('methods were compared.')
    expect(result).not.toMatch(/\s{2,}/)
    expect(result).not.toMatch(/[,–-]\s*(were|$)/)
  })

  it('leaves no dangling space before a following period (citation before punctuation)', () => {
    expect(removeCitationMarkersForAnalysis('This effect has been reported previously [7].')).toBe('This effect has been reported previously.')
  })

  it('leaves the subject intact when a citation follows a noun phrase (item 17)', () => {
    expect(removeCitationMarkersForAnalysis('The algorithm [12] improves performance.')).toBe('The algorithm improves performance.')
  })

  it('leaves the object intact when a citation follows it (item 18)', () => {
    expect(removeCitationMarkersForAnalysis('We use the method [5].')).toBe('We use the method.')
  })

  it('handles a citation sequence at the very start of the string (no leading space to consume)', () => {
    expect(removeCitationMarkersForAnalysis('[9] shows the result clearly.')).toBe('shows the result clearly.')
  })

  it('preserves the equation display placeholder "[式 (5)]" untouched', () => {
    const text = 'for the cosine equation, as [式 (5)]'
    expect(removeCitationMarkersForAnalysis(text)).toBe(text)
  })

  it('preserves the equation analysis placeholder "[EQUATION_5]" untouched', () => {
    const text = 'for the cosine equation, as [EQUATION_5]'
    expect(removeCitationMarkersForAnalysis(text)).toBe(text)
  })

  it('does not collide with equation normalization regardless of ordering (item 11)', () => {
    const text = 'for the cosine equation [9], as [式 (5)]'
    expect(removeCitationMarkersForAnalysis(text)).toBe('for the cosine equation, as [式 (5)]')
  })

  it('does not remove "[Equation]" (no digits) -- negative control', () => {
    const text = 'see [Equation] above'
    expect(removeCitationMarkersForAnalysis(text)).toBe(text)
  })

  it('does not remove "[x]" (non-numeric single letter) -- negative control', () => {
    const text = 'let [x] denote the parameter'
    expect(removeCitationMarkersForAnalysis(text)).toBe(text)
  })

  it('does not remove "[see Appendix A]" -- negative control', () => {
    const text = 'details are given [see Appendix A] here'
    expect(removeCitationMarkersForAnalysis(text)).toBe(text)
  })

  it('does not remove a malformed lookalike "[9a]" (item 30)', () => {
    const text = 'unclear reference [9a] here'
    expect(removeCitationMarkersForAnalysis(text)).toBe(text)
  })

  it('does not remove a malformed lookalike "[1-foo]" (item 30)', () => {
    const text = 'unclear reference [1-foo] here'
    expect(removeCitationMarkersForAnalysis(text)).toBe(text)
  })

  it('does not remove non-numeric brackets "[abc]"', () => {
    const text = 'a bracketed word [abc] here'
    expect(removeCitationMarkersForAnalysis(text)).toBe(text)
  })

  it('leaves text with no brackets at all unchanged', () => {
    const text = 'The value of k can then be used as a moderator for the cosine equation.'
    expect(removeCitationMarkersForAnalysis(text)).toBe(text)
  })
})

/**
 * Prototype 2.6G2.8A: a single bracket containing multiple numbers ("[5, 7]", "[3-6]",
 * "[3–6]") is a different, also-common citation shape from the sequence-of-separate-brackets
 * form above ("[5], [7]") -- both are numeric bibliographic citations and must both be
 * stripped for analysis while leaving the source display untouched (that remains App.tsx's
 * responsibility; this module only ever produces the analysis-facing string).
 */
describe('removeCitationMarkersForAnalysis -- single-bracket list/range citations', () => {
  it('removes a single-bracket comma list "[5, 7]"', () => {
    expect(removeCitationMarkersForAnalysis('The method [5, 7] was applied.')).toBe('The method was applied.')
  })

  it('removes a single-bracket hyphen range "[3-6]"', () => {
    expect(removeCitationMarkersForAnalysis('The method [3-6] was applied.')).toBe('The method was applied.')
  })

  it('removes a single-bracket en-dash range "[3–6]"', () => {
    expect(removeCitationMarkersForAnalysis('The method [3–6] was applied.')).toBe('The method was applied.')
  })

  it('removes a single-bracket list with three or more numbers "[5, 7, 9]"', () => {
    expect(removeCitationMarkersForAnalysis('reported widely [5, 7, 9] in the literature.')).toBe('reported widely in the literature.')
  })

  it('handles a single-bracket list adjacent to a coordinated constituent', () => {
    expect(removeCitationMarkersForAnalysis('temperature and pressure [5, 7] were measured.')).toBe('temperature and pressure were measured.')
  })

  it('handles a single-bracket list adjacent to a supplement/parenthetical', () => {
    expect(removeCitationMarkersForAnalysis('the correction factor (see Table 2) [5, 7] was applied.')).toBe(
      'the correction factor (see Table 2) was applied.',
    )
  })

  it('still does not remove the malformed lookalike "[1-foo]" (mixed digit/non-digit)', () => {
    const text = 'unclear reference [1-foo] here'
    expect(removeCitationMarkersForAnalysis(text)).toBe(text)
  })

  it('does not collide with the equation placeholder forms', () => {
    const text = 'reported widely [5, 7] as [式 (5)]'
    expect(removeCitationMarkersForAnalysis(text)).toBe('reported widely as [式 (5)]')
  })

  it('combines with a separate-bracket sequence on the same sentence', () => {
    expect(removeCitationMarkersForAnalysis('as shown [5, 7], [11] previously.')).toBe('as shown previously.')
  })
})
