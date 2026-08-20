import { describe, expect, it } from 'vitest'
import { classifyMathToken, containsRelationalOperator, detectMathRuns } from '../../src/features/grammar/domain/mathRunDetection.ts'

/**
 * Prototype 2.6G2.8M2 -- mirrors services/pymupdf_layout/tests/test_math_run_detection.py's
 * own case matrix exactly (item 13/14's mandatory real + synthetic cases), since this file
 * is a TypeScript twin of that Python detector and the two must never drift apart silently.
 */

function runsText(text: string): string[] {
  return detectMathRuns(text).map((r) => r.text)
}

describe('classifyMathToken', () => {
  it('classifies operators as EVIDENCE', () => {
    for (const tok of ['=', '<', '>', '≤', '≥', '≠', '≈', '±', '×', '·', '°']) {
      expect(classifyMathToken(tok)).toBe('EVIDENCE')
    }
  })

  it('classifies Greek letters as EVIDENCE', () => {
    expect(classifyMathToken('α')).toBe('EVIDENCE')
    expect(classifyMathToken('β')).toBe('EVIDENCE')
    expect(classifyMathToken('θ')).toBe('EVIDENCE')
    expect(classifyMathToken('Δ')).toBe('EVIDENCE')
  })

  it('classifies a superscript digit as EVIDENCE', () => {
    expect(classifyMathToken('m²')).toBe('EVIDENCE')
    expect(classifyMathToken('²')).toBe('EVIDENCE')
  })

  it('classifies subscript underscore notation as EVIDENCE', () => {
    expect(classifyMathToken('x_i')).toBe('EVIDENCE')
    expect(classifyMathToken('x_i²')).toBe('EVIDENCE')
  })

  it('classifies numeric tokens', () => {
    expect(classifyMathToken('200,000')).toBe('NUMERIC')
    expect(classifyMathToken('0.5')).toBe('NUMERIC')
    expect(classifyMathToken('0.3,')).toBe('NUMERIC')
    expect(classifyMathToken('10.')).toBe('NUMERIC')
  })

  it('classifies a bare symbol', () => {
    expect(classifyMathToken('+')).toBe('SYMBOL')
  })

  it('classifies a single letter', () => {
    expect(classifyMathToken('k')).toBe('SINGLE_LETTER')
    expect(classifyMathToken('R')).toBe('SINGLE_LETTER')
  })

  it('classifies an all-caps identifier', () => {
    expect(classifyMathToken('NDVI')).toBe('ALLCAPS_IDENTIFIER')
    expect(classifyMathToken('SUM')).toBe('ALLCAPS_IDENTIFIER')
  })

  it('classifies ordinary prose words as PROSE', () => {
    for (const tok of ['The', 'value', 'cos', 'sin', 'and', 'et', 'al.']) {
      expect(classifyMathToken(tok)).toBe('PROSE')
    }
  })

  it('classifies a citation bracket as PROSE, never evidence', () => {
    expect(classifyMathToken('[9]')).toBe('PROSE')
  })
})

describe('detectMathRuns -- real corpus (item 13)', () => {
  it('does not detect a bare k in ordinary prose', () => {
    expect(runsText('In the case of lower k values, the denominator is increased.')).toEqual([])
  })

  it('detects a degree symbol', () => {
    expect(runsText('the incidence angle approaches 90°.')).toEqual(['90°'])
  })

  it('does not detect cos i from bare text', () => {
    expect(runsText('radiance independent of cos i.')).toEqual([])
  })

  it('splits the parameter sentence at the prose conjunction "and"', () => {
    const text = 't = 200,000 m², a = 5,000 m², c = 0.3, and r = 10.'
    expect(runsText(text)).toEqual(['t = 200,000 m², a = 5,000 m², c = 0.3,', 'r = 10'])
  })

  it('covers each of the four assignments independently', () => {
    const text = 't = 200,000 m², a = 5,000 m², c = 0.3, and r = 10.'
    const combined = runsText(text).join(' ')
    for (const fragment of ['t = 200,000 m²', 'a = 5,000 m²', 'c = 0.3', 'r = 10']) {
      expect(combined).toContain(fragment)
    }
  })
})

describe('detectMathRuns -- synthetic coverage matrix (item 14)', () => {
  it('k = 0.5', () => expect(runsText('k = 0.5')).toEqual(['k = 0.5']))
  it('k < 0.5', () => expect(runsText('k < 0.5')).toEqual(['k < 0.5']))
  it('k > 0.5', () => expect(runsText('k > 0.5')).toEqual(['k > 0.5']))
  it('k ≤ 0.5', () => expect(runsText('k ≤ 0.5')).toEqual(['k ≤ 0.5']))
  it('k ≥ 0.5', () => expect(runsText('k ≥ 0.5')).toEqual(['k ≥ 0.5']))
  it('0 < k < 1', () => expect(runsText('0 < k < 1')).toEqual(['0 < k < 1']))
  it('0 ≤ NDVI ≤ 1 bridges the all-caps identifier', () => expect(runsText('0 ≤ NDVI ≤ 1')).toEqual(['0 ≤ NDVI ≤ 1']))
  it('R² ≥ 0.8', () => expect(runsText('R² ≥ 0.8')).toEqual(['R² ≥ 0.8']))
  it('T = 300 ± 2 K', () => expect(runsText('T = 300 ± 2 K')).toEqual(['T = 300 ± 2 K']))
  it('α + β bridges the bare symbol', () => expect(runsText('α + β')).toEqual(['α + β']))
  it('sin θ only detects the symbol, not the function name (honest limitation)', () => expect(runsText('sin θ')).toEqual(['θ']))
  it('cos i synthetic matches real-corpus non-detection', () => expect(runsText('cos i')).toEqual([]))
  it('x²', () => expect(runsText('x²')).toEqual(['x²']))
  it('x³', () => expect(runsText('x³')).toEqual(['x³']))
  it('x_i', () => expect(runsText('x_i')).toEqual(['x_i']))
  it('x_i²', () => expect(runsText('x_i²')).toEqual(['x_i²']))
})

describe('detectMathRuns -- negative prose controls (item 3)', () => {
  it('et al.', () => expect(runsText('as shown by Smith et al. in the prior study.')).toEqual([]))
  it('italic species name (no font info at this text-only layer)', () =>
    expect(runsText('the species Homo sapiens was observed.')).toEqual([]))
  it('ordinary emphasis text', () => expect(runsText('this result is important for the analysis.')).toEqual([]))
  it('section heading fragment', () => expect(runsText('Materials and Methods')).toEqual([]))
  it('citation marker', () => expect(runsText('as shown previously [9] in related work.')).toEqual([]))
  it('ordinary sentence with a trailing number and period', () => expect(runsText('the sample size was 10.')).toEqual([]))
})

describe('detectMathRuns -- sentence-final period trimming', () => {
  it('trims a period before a capitalized next sentence', () => {
    const runs = runsText('and r = 10. Eventually, the slope unit map was produced.')
    expect(runs).toEqual(['r = 10'])
  })

  it('trims a period at the end of the text', () => {
    expect(runsText('the result was k = 5.')).toEqual(['k = 5'])
  })

  it('never trims a decimal period', () => {
    expect(runsText('k = 0.5 was used.')).toEqual(['k = 0.5'])
  })
})

describe('containsRelationalOperator', () => {
  it('detects each relational/assignment operator', () => {
    for (const op of ['=', '<', '>', '≤', '≥', '≠', '≈']) {
      expect(containsRelationalOperator(`k ${op} 0.5`)).toBe(true)
    }
  })

  it('is false for a simple/stable run with no relational operator', () => {
    expect(containsRelationalOperator('cos i')).toBe(false)
    expect(containsRelationalOperator('R²')).toBe(false)
    expect(containsRelationalOperator('90°')).toBe(false)
  })
})
