import { describe, expect, it } from 'vitest'
import { shieldDisplayEquationsForAnalysis } from '../../src/features/grammar/domain/scientificTextShielding.ts'

describe('shieldDisplayEquationsForAnalysis', () => {
  it('is a no-op when no equation placeholder is present', () => {
    const text = 'The results indicate that the method is effective.'
    expect(shieldDisplayEquationsForAnalysis(text)).toBe(text)
  })

  it('(dangling preposition, nothing follows) inserts the neutral surrogate and closes the sentence', () => {
    const text = 'The value of k can then be used as a moderator for the cosine equation, as [EQUATION_5]'
    expect(shieldDisplayEquationsForAnalysis(text)).toBe(
      'The value of k can then be used as a moderator for the cosine equation, as the formula.',
    )
  })

  it('preserves an immediately-adjacent closing period instead of adding a second one', () => {
    const text = 'as shown below, as [EQUATION_5].'
    expect(shieldDisplayEquationsForAnalysis(text)).toBe('as shown below, as the formula.')
  })

  it('(Prototype 2.6G2.8B Case C -- different-sentence boundary) drops a genuinely new sentence that follows the equation, capital-letter signalled', () => {
    const text = 'The value of k can then be used as a moderator for the cosine equation, as [EQUATION_5] In the case of lower k values, the denominator is increased.'
    expect(shieldDisplayEquationsForAnalysis(text)).toBe(
      'The value of k can then be used as a moderator for the cosine equation, as the formula.',
    )
  })

  it('(Prototype 2.6G2.8B Case A -- same-sentence continuation) preserves BOTH predicate structures across two display equations, with no surrogate where none is needed', () => {
    const text =
      'The parameter C is a function of the regression slope (b) and intercept (a) [EQUATION_8] and is introduced to the cosine correction model as an additive term [EQUATION_9]'
    const result = shieldDisplayEquationsForAnalysis(text)
    expect(result).toBe(
      'The parameter C is a function of the regression slope (b) and intercept (a) and is introduced to the cosine correction model as an additive term.',
    )
    expect(result).not.toContain('the formula')
    expect(result).not.toContain('EQUATION')
  })

  it('a standalone equation placeholder ("[EQUATION]", no number) is also shielded', () => {
    const text = 'the relationship is given below, as [EQUATION] and follows from the derivation above.'
    expect(shieldDisplayEquationsForAnalysis(text)).toBe(
      'the relationship is given below, as the formula and follows from the derivation above.',
    )
  })

  it('drops an equation entirely when it follows a complete noun phrase (no dangling preposition)', () => {
    const text = 'The additive term [EQUATION_9] captures the correction.'
    expect(shieldDisplayEquationsForAnalysis(text)).toBe('The additive term captures the correction.')
  })

  it('an equation opening the string with no dangling preposition before it is simply dropped, same general rule as any other position', () => {
    // No text precedes the equation (nothing to be "dangling"), and what follows starts
    // lowercase, so the general continuation signal applies exactly as it would mid-sentence
    // -- the equation is dropped and the remaining prose is kept as-is (an inherent,
    // documented limitation of a purely capitalization-driven signal for this rare
    // equation-opens-the-selection shape, not a targeted patch for this specific sentence).
    const text = '[EQUATION_1] shows the base case, followed by further discussion.'
    expect(shieldDisplayEquationsForAnalysis(text)).toBe('shows the base case, followed by further discussion.')
  })

  it('an equation opening the string followed by a capitalized sentence abstains toward an empty result rather than guessing', () => {
    const text = '[EQUATION_1] Table 3 summarizes the results.'
    expect(shieldDisplayEquationsForAnalysis(text)).toBe('')
  })

  it('the neutral surrogate never appears as literal English content when no equation is present (no false positive)', () => {
    const text = 'The formula for the coefficient was derived independently.'
    expect(shieldDisplayEquationsForAnalysis(text)).toBe(text)
  })

  it('continuation signal never matches a specific word -- any lowercase-starting continuation works, not just "and"', () => {
    const text = 'as derived above [EQUATION_2] therefore reduces to the simplified case.'
    const result = shieldDisplayEquationsForAnalysis(text)
    expect(result).toBe('as derived above therefore reduces to the simplified case.')
  })

  it('a boundary signal never matches a specific phrase -- any capital-starting sentence is treated as separate, not just "In the case"', () => {
    const text = 'as derived above [EQUATION_2] Table 3 summarizes the results.'
    const result = shieldDisplayEquationsForAnalysis(text)
    expect(result).toBe('as derived above.')
  })
})
