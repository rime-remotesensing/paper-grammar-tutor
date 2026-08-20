import { describe, expect, it } from 'vitest'
import { prepareExpressionsForDisplay } from '../../src/features/grammar/domain/expressionPresentation'
import type { Expression } from '../../src/features/grammar/schemas/readingGuide.schema'

function expr(text: string, pattern: string, meaning = 'm', func = 'f'): Expression {
  return { text, pattern, meaning, function: func, start: 0, end: text.length }
}

describe('prepareExpressionsForDisplay', () => {
  it('groups multiple occurrences of the same pattern into one card with distinct examples', () => {
    const result = prepareExpressionsForDisplay([
      expr('every 1 nm', 'every + number + unit'),
      expr('every 4 nm', 'every + number + unit'),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].pattern).toBe('every + number + unit')
    expect(result[0].examples).toEqual(['every 1 nm', 'every 4 nm'])
  })

  it('does not duplicate an example if the exact same text/pattern pair repeats', () => {
    const result = prepareExpressionsForDisplay([
      expr('every 1 nm', 'every + number + unit'),
      expr('every 1 nm', 'every + number + unit'),
    ])
    expect(result[0].examples).toEqual(['every 1 nm'])
  })

  it('filters out single-word expressions (e.g. a stray "nm")', () => {
    const result = prepareExpressionsForDisplay([
      expr('nm', 'unit of measurement'),
      expr('however', 'transition word'),
      expr('was recorded', 'be + past participle'),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].pattern).toBe('be + past participle')
  })

  it('retains "from A to B" and "be + past participle" (primary sentence expressions)', () => {
    const result = prepareExpressionsForDisplay([
      expr('was recorded', 'be + past participle'),
      expr('from 0.8 to 2.5 μm', 'from A to B'),
    ])
    expect(result.map((r) => r.pattern)).toEqual(['be + past participle', 'from A to B'])
  })

  it('caps the result at maxCount, keeping first-seen (source-order) distinct patterns', () => {
    const result = prepareExpressionsForDisplay(
      [
        expr('be + past participle example', 'pattern A'),
        expr('pattern B example', 'pattern B'),
        expr('pattern C example', 'pattern C'),
        expr('pattern D example', 'pattern D'),
        expr('pattern E example', 'pattern E'),
      ],
      4,
    )
    expect(result.map((r) => r.pattern)).toEqual(['pattern A', 'pattern B', 'pattern C', 'pattern D'])
  })

  it('defaults to a max of 4 when no maxCount is given', () => {
    const many = Array.from({ length: 8 }, (_, i) => expr(`pattern ${i} example`, `pattern ${i}`))
    expect(prepareExpressionsForDisplay(many)).toHaveLength(4)
  })

  it('returns an empty array when there are no expressions', () => {
    expect(prepareExpressionsForDisplay([])).toEqual([])
  })

  it('returns an empty array when all expressions are single-word', () => {
    expect(prepareExpressionsForDisplay([expr('nm', 'p1'), expr('however', 'p2')])).toEqual([])
  })
})

describe('Prototype 2.6G2.8M2.2a Track B -- synthetic math token exclusion (item 9)', () => {
  it('excludes an expression whose entire grounded span is a MATH_EXPR synthetic run', async () => {
    const { shieldRelationalMathRuns } = await import('../../src/features/grammar/domain/mathRunProjection')
    const { projectionFromSource } = await import('../../src/features/grammar/domain/textProjection')
    const source = 'the result was k = 0.5 in this case.'
    const projection = shieldRelationalMathRuns(projectionFromSource(source), source)
    const start = projection.text.indexOf('MATH_EXPR')
    const end = start + 'MATH_EXPR'.length
    const result = prepareExpressionsForDisplay(
      [{ text: 'MATH_EXPR', pattern: 'variable = value', meaning: 'm', function: 'f', start, end }],
      4,
      projection,
    )
    expect(result).toEqual([])
  })

  it('keeps an ordinary multi-word expression unaffected when no synthetic runs are present', () => {
    const result = prepareExpressionsForDisplay([expr('every 1 nm', 'every + number + unit')])
    expect(result).toHaveLength(1)
  })
})
