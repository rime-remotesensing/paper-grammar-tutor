import { describe, expect, it } from 'vitest'
import { fieldMatches, guessComplementErrorKind, normalizeForComparison } from '../../benchmark/run.ts'

describe('normalizeForComparison', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeForComparison('  The   Results  ')).toBe('the results')
  })
})

describe('fieldMatches', () => {
  it('matches null gold only against null actual', () => {
    expect(fieldMatches(null, null)).toBe(true)
    expect(fieldMatches(null, 'something')).toBe(false)
  })

  it('rejects a null actual when gold expects a value', () => {
    expect(fieldMatches('The results', null)).toBe(false)
  })

  it('matches via case/whitespace-insensitive equality', () => {
    expect(fieldMatches('The Results', 'the   results')).toBe(true)
  })

  it('matches via substring containment in either direction', () => {
    expect(fieldMatches('users', 'users immediate feedback')).toBe(true)
    expect(fieldMatches('users immediate feedback', 'users')).toBe(true)
  })

  it('rejects unrelated text', () => {
    expect(fieldMatches('the students', 'the professor')).toBe(false)
  })
})

describe('guessComplementErrorKind', () => {
  it('flags a leading preposition as a possible prepositional phrase', () => {
    expect(guessComplementErrorKind('in the previous experiment')).toBe('possibly-prepositional-phrase')
  })

  it('flags a leading "to + word" as a possible infinitive phrase', () => {
    expect(guessComplementErrorKind('to improve classification accuracy')).toBe('possibly-infinitive-phrase')
  })

  it('flags a bare -ly word as a possible adverb', () => {
    expect(guessComplementErrorKind('significantly')).toBe('possibly-adverb')
  })

  it('falls back to unclassified for anything else', () => {
    expect(guessComplementErrorKind('a major challenge')).toBe('other-unclassified')
  })
})
