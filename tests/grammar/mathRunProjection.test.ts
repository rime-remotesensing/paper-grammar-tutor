import { describe, expect, it } from 'vitest'
import { shieldRelationalMathRuns, shieldRelationalMathRunsForAnalysis } from '../../src/features/grammar/domain/mathRunProjection.ts'
import { projectionFromSource } from '../../src/features/grammar/domain/textProjection.ts'

/**
 * Prototype 2.6G2.8M2 -- item 8/9's own requirement: SOURCE SEGMENTATION (a run IS a
 * MathSegment) is a separate decision from GRAMMAR PROJECTION POLICY (whether Stanza sees it
 * literally or shielded). Only RELATIONAL/ASSIGNMENT-evidenced runs get shielded; every
 * other detected run stays literal.
 */

describe('shieldRelationalMathRunsForAnalysis', () => {
  it('shields a relational expression with the internal neutral token', () => {
    const result = shieldRelationalMathRunsForAnalysis('k = 0.5', 'k = 0.5')
    expect(result).toBe('MATH_EXPR')
  })

  it('leaves a simple/stable run (no relational operator) completely literal', () => {
    expect(shieldRelationalMathRunsForAnalysis('cos i', 'cos i')).toBe('cos i')
    expect(shieldRelationalMathRunsForAnalysis('R²', 'R²')).toBe('R²')
    expect(shieldRelationalMathRunsForAnalysis('90°', '90°')).toBe('90°')
  })

  it('shields only the relational run in a sentence with a simple/stable run elsewhere', () => {
    const source = 'The response is proportional to cos i when k = 0.5 is used.'
    const result = shieldRelationalMathRunsForAnalysis(source, source)
    expect(result).toBe('The response is proportional to cos i when MATH_EXPR is used.')
  })

  it('shields the parameter sentence relational runs, never touching ordinary prose', () => {
    const source = 'the parameters were determined as t = 200,000 m², a = 5,000 m², c = 0.3, and r = 10.'
    const result = shieldRelationalMathRunsForAnalysis(source, source)
    expect(result).toBe('the parameters were determined as MATH_EXPR and MATH_EXPR.')
  })

  it('detects against sourceText even when currentText already differs (citation/equation steps already ran)', () => {
    const sourceText = 'as shown [9], k = 0.5 was used.'
    const currentText = 'as shown, k = 0.5 was used.' // citation already removed
    const result = shieldRelationalMathRunsForAnalysis(sourceText, currentText)
    expect(result).toBe('as shown, MATH_EXPR was used.')
  })

  it('is a no-op when no relational run is present at all', () => {
    const source = 'This is an ordinary sentence with no scientific content.'
    expect(shieldRelationalMathRunsForAnalysis(source, source)).toBe(source)
  })
})

describe('shieldRelationalMathRuns (Projection twin)', () => {
  it('produces byte-identical .text output to the string twin', () => {
    const source = 'the parameters were determined as t = 200,000 m², a = 5,000 m², c = 0.3, and r = 10.'
    const projected = shieldRelationalMathRuns(projectionFromSource(source), source)
    const expected = shieldRelationalMathRunsForAnalysis(source, source)
    expect(projected.text).toBe(expected)
  })

  it('marks the MATH_EXPR token as fully synthetic', () => {
    const source = 'k = 0.5 was used.'
    const projected = shieldRelationalMathRuns(projectionFromSource(source), source)
    const tokenStart = projected.text.indexOf('MATH_EXPR')
    for (let i = tokenStart; i < tokenStart + 'MATH_EXPR'.length; i++) {
      expect(projected.sourceIndexOf[i]).toBeNull()
    }
  })

  it('records a syntheticRunSourceRange mapping the token back to the exact original run', () => {
    const source = 'the result was k = 0.5 in this case.'
    const projected = shieldRelationalMathRuns(projectionFromSource(source), source)
    expect(projected.syntheticRunSourceRanges).toHaveLength(1)
    const range = projected.syntheticRunSourceRanges![0]
    expect(source.slice(range.sourceStart, range.sourceEnd)).toBe('k = 0.5')
    expect(projected.text.slice(range.analysisStart, range.analysisEnd)).toBe('MATH_EXPR')
  })

  it('records independent ranges for multiple shielded runs, in source order', () => {
    const source = 'k = 0.5 and then t = 10 was measured.'
    const projected = shieldRelationalMathRuns(projectionFromSource(source), source)
    expect(projected.syntheticRunSourceRanges).toHaveLength(2)
    const [first, second] = projected.syntheticRunSourceRanges!
    expect(source.slice(first.sourceStart, first.sourceEnd)).toBe('k = 0.5')
    expect(source.slice(second.sourceStart, second.sourceEnd)).toBe('t = 10')
  })

  it('leaves a simple/stable run untouched and produces no synthetic range for it', () => {
    const source = 'the response is proportional to cos i.'
    const projected = shieldRelationalMathRuns(projectionFromSource(source), source)
    expect(projected.text).toBe(source)
    expect(projected.syntheticRunSourceRanges ?? []).toEqual([])
  })
})
