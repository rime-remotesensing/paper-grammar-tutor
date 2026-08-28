import { describe, expect, it } from 'vitest'
import { findGlossaryHints } from '../../src/llm/glossary/technicalTermGlossary'

describe('findGlossaryHints', () => {
  it('matches a known technical compound at word boundaries', () => {
    const sentence = 'VIIRS is a whiskbroom scanning radiometer with a swath width of 3060 km.'
    const hints = findGlossaryHints(sentence)
    expect(hints).toHaveLength(1)
    expect(sentence.slice(hints[0].start, hints[0].end)).toBe('whiskbroom scanning radiometer')
    expect(hints[0].suggestedJapanese).toBe('ウィスクブルーム走査式放射計')
  })

  it('does not match a substring that is not at a word boundary', () => {
    const sentence = 'The device uses a nonwhiskbroom scanning radiometerx for testing.'
    const hints = findGlossaryHints(sentence)
    expect(hints).toHaveLength(0)
  })

  it('matches multiple different phrases in source order', () => {
    const sentence =
      'It was placed in a sun synchronous orbit with equatorial crossing times near noon.'
    const hints = findGlossaryHints(sentence)
    expect(hints.map((h) => sentence.slice(h.start, h.end))).toEqual([
      'sun synchronous orbit',
      'equatorial crossing times',
    ])
  })

  it('returns no hints for an unrelated sentence', () => {
    const hints = findGlossaryHints('The results indicate a strong correlation between variables.')
    expect(hints).toHaveLength(0)
  })
})
