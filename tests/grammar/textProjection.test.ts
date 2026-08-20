import { describe, expect, it } from 'vitest'
import {
  appendSynthetic,
  collapseInternalSpaces,
  projectionFromSource,
  removeMatches,
  replaceMatchesWithSynthetic,
  replaceRangeWithSynthetic,
  trimProjection,
  truncateProjection,
} from '../../src/features/grammar/domain/textProjection.ts'

describe('Prototype 2.6G2.8E -- textProjection primitives (LEVEL 1)', () => {
  it('projectionFromSource is the identity mapping', () => {
    const p = projectionFromSource('hello')
    expect(p.text).toBe('hello')
    expect(p.sourceIndexOf).toEqual([0, 1, 2, 3, 4])
  })

  it('removeMatches drops both text and mapping for the matched range', () => {
    const p = projectionFromSource('a moderator [9] for the equation')
    const result = removeMatches(p, /\s*\[9\]/g)
    expect(result.text).toBe('a moderator for the equation')
    // The surviving text still maps to its ORIGINAL source positions -- "for" starts right
    // after "[9] " in the source, at source index 16.
    const forIndex = result.text.indexOf('for')
    expect(result.sourceIndexOf[forIndex]).toBe(p.text.indexOf('for'))
  })

  it('removeMatches on multiple non-adjacent matches keeps mapping correct on both sides', () => {
    const p = projectionFromSource('X [1] Y [2] Z')
    const result = removeMatches(p, /\s*\[\d\]/g)
    expect(result.text).toBe('X Y Z')
    expect(result.sourceIndexOf[result.text.indexOf('X')]).toBe(p.text.indexOf('X'))
    expect(result.sourceIndexOf[result.text.indexOf('Y')]).toBe(p.text.indexOf('Y'))
    expect(result.sourceIndexOf[result.text.indexOf('Z')]).toBe(p.text.indexOf('Z'))
  })

  it('replaceMatchesWithSynthetic marks every replacement character as synthetic (null)', () => {
    const p = projectionFromSource('as [EQUATION_5]')
    const result = replaceMatchesWithSynthetic(p, /\[EQUATION(?:_\d+)?\]/g, 'the formula')
    expect(result.text).toBe('as the formula')
    const surrogateStart = result.text.indexOf('the formula')
    for (let i = surrogateStart; i < surrogateStart + 'the formula'.length; i++) {
      expect(result.sourceIndexOf[i]).toBeNull()
    }
    // Text before the replacement keeps its real source mapping.
    expect(result.sourceIndexOf[0]).toBe(0)
  })

  it('truncateProjection keeps only the mapping for the retained prefix', () => {
    const p = projectionFromSource('keep this, drop this')
    const result = truncateProjection(p, 9)
    expect(result.text).toBe('keep this')
    expect(result.sourceIndexOf).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('appendSynthetic marks the appended text as having no source origin', () => {
    const p = projectionFromSource('angle approaches 90')
    const result = appendSynthetic(p, '.')
    expect(result.text).toBe('angle approaches 90.')
    expect(result.sourceIndexOf[result.sourceIndexOf.length - 1]).toBeNull()
  })

  it('trimProjection removes leading/trailing whitespace and its mapping entries', () => {
    const p = projectionFromSource('  hello  ')
    const result = trimProjection(p)
    expect(result.text).toBe('hello')
    expect(result.sourceIndexOf).toEqual([2, 3, 4, 5, 6])
  })

  it('trimProjection on an all-whitespace string returns empty', () => {
    const result = trimProjection(projectionFromSource('   '))
    expect(result.text).toBe('')
    expect(result.sourceIndexOf).toEqual([])
  })

  it('collapseInternalSpaces collapses a double space to one, keeping the first source index', () => {
    const p = projectionFromSource('a  b')
    const result = collapseInternalSpaces(p)
    expect(result.text).toBe('a b')
    expect(result.sourceIndexOf).toEqual([0, 1, 3])
  })

  it('a full composed pipeline (citation removal + synthetic replacement) preserves exact short-variable mapping', () => {
    // Mirrors the real live shape: "a and b are the y-intercept..." with an unrelated "be"
    // earlier in the sentence -- the exact case the old text-search mapping got wrong.
    const source = 'This can be rotated using the equation [9] where a and b are the slope.'
    let p = projectionFromSource(source)
    p = removeMatches(p, /\s*\[9\]/g)
    const bIndexInAnalysis = p.text.indexOf('b are')
    // The "b" in "a and b" must map back to the source's SECOND "b" (in "b are"), never the
    // "b" inside "be rotated" near the start.
    expect(p.sourceIndexOf[bIndexInAnalysis]).toBe(source.indexOf('b are'))
    expect(p.sourceIndexOf[bIndexInAnalysis]).not.toBe(source.indexOf('be rotated') + 1)
  })
})

describe('Prototype 2.6G2.8M2 -- replaceRangeWithSynthetic', () => {
  it('replaces the exact source range with the synthetic replacement', () => {
    const source = 'the result was k = 0.5 in this case.'
    const p = projectionFromSource(source)
    const start = source.indexOf('k = 0.5')
    const end = start + 'k = 0.5'.length
    const result = replaceRangeWithSynthetic(p, start, end, 'MATH_EXPR')
    expect(result.text).toBe('the result was MATH_EXPR in this case.')
  })

  it('marks every character of the replacement as synthetic', () => {
    const source = 'k = 0.5'
    const result = replaceRangeWithSynthetic(projectionFromSource(source), 0, source.length, 'MATH_EXPR')
    for (const idx of result.sourceIndexOf) expect(idx).toBeNull()
  })

  it('records a SyntheticRunSourceRange mapping the replacement back to the original range', () => {
    const source = 'the result was k = 0.5 in this case.'
    const start = source.indexOf('k = 0.5')
    const end = start + 'k = 0.5'.length
    const result = replaceRangeWithSynthetic(projectionFromSource(source), start, end, 'MATH_EXPR')
    expect(result.syntheticRunSourceRanges).toEqual([
      { analysisStart: start, analysisEnd: start + 'MATH_EXPR'.length, sourceStart: start, sourceEnd: end },
    ])
  })

  it('works correctly against a projection that already went through an earlier transform', () => {
    const source = 'as shown [9], k = 0.5 was used.'
    let p = projectionFromSource(source)
    p = removeMatches(p, /\s*\[9\]/g)
    const start = source.indexOf('k = 0.5')
    const end = start + 'k = 0.5'.length
    const result = replaceRangeWithSynthetic(p, start, end, 'MATH_EXPR')
    expect(result.text).toBe('as shown, MATH_EXPR was used.')
  })

  it('appends to an existing syntheticRunSourceRanges list rather than replacing it', () => {
    const source = 'k = 0.5 and t = 10 were used.'
    let p = projectionFromSource(source)
    const firstStart = source.indexOf('k = 0.5')
    const firstEnd = firstStart + 'k = 0.5'.length
    p = replaceRangeWithSynthetic(p, firstStart, firstEnd, 'MATH_EXPR')
    const secondStart = source.indexOf('t = 10')
    const secondEnd = secondStart + 't = 10'.length
    p = replaceRangeWithSynthetic(p, secondStart, secondEnd, 'MATH_EXPR')
    expect(p.syntheticRunSourceRanges).toHaveLength(2)
  })

  it('abstains (returns input unchanged) when the source range is not intact', () => {
    const source = 'k = 0.5 was used.'
    let p = projectionFromSource(source)
    p = removeMatches(p, /=/g) // corrupts the range so it's no longer contiguous/intact
    const start = source.indexOf('k = 0.5')
    const end = start + 'k = 0.5'.length
    const result = replaceRangeWithSynthetic(p, start, end, 'MATH_EXPR')
    expect(result).toBe(p) // unchanged reference, never a guess
  })
})
