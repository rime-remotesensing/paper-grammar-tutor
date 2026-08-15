import { describe, expect, it } from 'vitest'
import { parseRelativeClauseSuffix, startsWithRelativePronoun } from '../../src/features/grammar/domain/relativeClausePresentation'

// Prototype 2.3M — relative-clause presentation helper tests.

describe('startsWithRelativePronoun', () => {
  it('returns true when the text begins with "who"', () => {
    expect(startsWithRelativePronoun('who discovered the compound')).toBe(true)
  })

  it('returns true when the text begins with "that"', () => {
    expect(startsWithRelativePronoun('that have changed since Collection 5')).toBe(true)
  })

  it('returns false when the relative-pronoun-like word is not the first word', () => {
    expect(startsWithRelativePronoun('the method that we used')).toBe(false)
  })

  it('returns false for ordinary text', () => {
    expect(startsWithRelativePronoun('temperature increased')).toBe(false)
  })
})

describe('parseRelativeClauseSuffix — success cases', () => {
  it('splits "those aspects that have changed since Collection 5"', () => {
    const result = parseRelativeClauseSuffix('those aspects that have changed since Collection 5')
    expect(result).toEqual({
      antecedentText: 'those aspects',
      relativeClauseText: 'that have changed since Collection 5',
      relativePronoun: 'that',
    })
  })

  it('splits "The aspects that have changed" (subject-attached relative clause)', () => {
    const result = parseRelativeClauseSuffix('The aspects that have changed')
    expect(result).toEqual({
      antecedentText: 'The aspects',
      relativeClauseText: 'that have changed',
      relativePronoun: 'that',
    })
  })

  it('splits "The method that we used" (relative-clause-with-object control, item 32)', () => {
    const result = parseRelativeClauseSuffix('The method that we used')
    expect(result).toEqual({ antecedentText: 'The method', relativeClauseText: 'that we used', relativePronoun: 'that' })
  })

  it('splits on "which" (item 33)', () => {
    const result = parseRelativeClauseSuffix('The method which we used')
    expect(result).toEqual({ antecedentText: 'The method', relativeClauseText: 'which we used', relativePronoun: 'which' })
  })
})

describe('parseRelativeClauseSuffix — content-that negative control (item 15/18/30)', () => {
  it('returns null for a grounded object span with no relative pronoun at all', () => {
    // This is exactly the shape PredicateStructure grounds for
    // "The study showed that temperature increased." — the "that" is not even part of the
    // grounded dependent text in production (see item 16 diagnosis), so there is nothing
    // for the parser to find here regardless.
    expect(parseRelativeClauseSuffix('temperature increased')).toBeNull()
  })

  it('returns null when the relative-pronoun-like word is the FIRST word (would be a bare content-clause/demonstrative shape, not "NP + relative clause")', () => {
    expect(parseRelativeClauseSuffix('that temperature increased')).toBeNull()
  })
})

describe('parseRelativeClauseSuffix — ambiguous / no-split cases (precision over recall)', () => {
  it('returns null when more than one relative-pronoun-like word appears', () => {
    expect(parseRelativeClauseSuffix('the method that the team that led it used')).toBeNull()
  })

  it('returns null for plain text with no relative pronoun', () => {
    expect(parseRelativeClauseSuffix('the Collection 6 algorithm')).toBeNull()
  })

  it('returns null when nothing meaningful follows the pronoun', () => {
    expect(parseRelativeClauseSuffix('the report that')).toBeNull()
  })
})

describe('parseRelativeClauseSuffix — raw text integrity (item 39-I)', () => {
  it('antecedent + relativeClause recombine to exactly the original text', () => {
    const text = 'those aspects that have changed since Collection 5'
    const result = parseRelativeClauseSuffix(text)
    expect(result).not.toBeNull()
    if (!result) return
    expect(`${result.antecedentText} ${result.relativeClauseText}`).toBe(text)
  })
})
