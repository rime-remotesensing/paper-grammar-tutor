import { describe, expect, it } from 'vitest'
import { joinFragmentTexts } from '../../src/features/pdf/domain/fragmentJoin'

// Prototype 2.4A item 41 — join normalization tests.

describe('joinFragmentTexts', () => {
  it('joins two ordinary fragments with a single space', () => {
    expect(joinFragmentTexts(['using several', 'independent datasets'])).toBe('using several independent datasets')
  })

  it('trims and collapses whitespace at the boundary', () => {
    expect(joinFragmentTexts(['using several   ', '   independent datasets'])).toBe('using several independent datasets')
  })

  it('does not insert a space before leading punctuation', () => {
    expect(joinFragmentTexts(['the sensor', ', which measured temperature'])).toBe('the sensor, which measured temperature')
    expect(joinFragmentTexts(['the result', '.'])).toBe('the result.')
    expect(joinFragmentTexts(['the list', ')'])).toBe('the list)')
  })

  it('strips a trailing soft hyphen and joins solid', () => {
    expect(joinFragmentTexts(['charac­teristics'])).toBe('charac­teristics') // single fragment: unchanged
    expect(joinFragmentTexts(['charac­', 'teristics'])).toBe('characteristics')
  })

  it('preserves a visible ASCII hyphen and does not insert a boundary space', () => {
    expect(joinFragmentTexts(['high-', 'resolution imaging'])).toBe('high-resolution imaging')
    expect(joinFragmentTexts(['charac-', 'teristics'])).toBe('charac-teristics') // never dictionary-guessed into "characteristics"
  })

  it('filters out empty fragments', () => {
    expect(joinFragmentTexts(['using several', '', '  ', 'independent datasets'])).toBe('using several independent datasets')
  })

  it('joins three or more fragments in order', () => {
    expect(joinFragmentTexts(['The proposed method', 'was evaluated using', 'several independent datasets.'])).toBe(
      'The proposed method was evaluated using several independent datasets.',
    )
  })

  it('returns an empty string for an all-empty input', () => {
    expect(joinFragmentTexts(['', '  '])).toBe('')
  })

  it('returns the single fragment unchanged when only one is given', () => {
    expect(joinFragmentTexts(['  a single fragment  '])).toBe('a single fragment')
  })
})
