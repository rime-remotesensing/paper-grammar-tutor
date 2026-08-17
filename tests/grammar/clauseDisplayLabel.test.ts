import { describe, expect, it } from 'vitest'
import { deriveClauseDisplayLabel } from '../../src/features/grammar/domain/clauseDisplayLabel'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree'

// Prototype 2.5X — clause display-label derivation tests.

function node(text: string, start: number, role: StructureTreeNode['role'], children: StructureTreeNode[] = []): StructureTreeNode {
  return { text, start, end: start + text.length, role, children }
}

describe('deriveClauseDisplayLabel — simple where target (item 16/28)', () => {
  it('derives "where" as the concise label when children decompose the full clause text', () => {
    // "We use a model where x is the input and y is the output." -- clause starts at 15.
    const clause = node('where x is the input and y is the output', 15, 'clause', [
      node('x is the input', 21, 'clause'),
      node('y is the output', 40, 'clause'),
    ])
    expect(deriveClauseDisplayLabel(clause)).toBe('where')
  })
})

describe('deriveClauseDisplayLabel — three-child target (item 17)', () => {
  it('still derives "where" with three children', () => {
    const clause = node('where x is the input, y is the output, and z is the error', 15, 'clause', [
      node('x is the input', 21, 'clause'),
      node('y is the output', 37, 'clause'),
      node('z is the error', 58, 'clause'),
    ])
    expect(deriveClauseDisplayLabel(clause)).toBe('where')
  })
})

describe('deriveClauseDisplayLabel — exact CASE B shape (item 22/23)', () => {
  it('derives "where" and preserves the full authoritative text unchanged on the node itself', () => {
    const fullText =
      'where Ln is the normalized radiance, a and b are the y-intercept and slope of the regression line, respectively, and Lavg is the average of the measured radiance data.'
    const clause = node(fullText, 108, 'clause', [
      node('Ln is the normalized radiance', 114, 'clause'),
      node('a and b are the y-intercept and slope of the regression line, respectively', 145, 'clause'),
      node('Lavg is the average of the measured radiance data', 225, 'clause'),
    ])
    // Display resolves to the concise prefix...
    expect(deriveClauseDisplayLabel(clause)).toBe('where')
    // ...but the node's own authoritative text is completely untouched (item 10/11: never
    // mutate/shorten domain data for UI purposes).
    expect(clause.text).toBe(fullText)
    expect(clause.children.map((c) => c.text)).toEqual([
      'Ln is the normalized radiance',
      'a and b are the y-intercept and slope of the regression line, respectively',
      'Lavg is the average of the measured radiance data',
    ])
  })
})

describe('deriveClauseDisplayLabel — negative control: no children (item 15)', () => {
  it('returns the full text unchanged when there are no children at all', () => {
    const clause = node('where x is the input', 15, 'clause', [])
    expect(deriveClauseDisplayLabel(clause)).toBe('where x is the input')
  })
})

describe('deriveClauseDisplayLabel — negative control: parent text is NOT a prefix+children shape (item 15/26)', () => {
  it('returns the full text unchanged when the child is a separate, non-overlapping detail (Primary Reno "range" shape)', () => {
    // "every 1 nm" (condition) with a "range" child that narrates a SEPARATE later span, not
    // a substring extracted from within "every 1 nm" itself.
    const condition = node('every 1 nm', 18, 'condition', [node('in the 0.4 to 0.8 μm region', 32, 'range')])
    expect(deriveClauseDisplayLabel(condition)).toBe('every 1 nm')
  })

  it('returns the full text unchanged for a non-"clause" role even if it superficially has a child inside its span', () => {
    const objectNode = node('a function of the regression slope', 19, 'object', [node('the regression slope', 33, 'clause')])
    expect(deriveClauseDisplayLabel(objectNode)).toBe('a function of the regression slope')
  })
})

describe('deriveClauseDisplayLabel — ungrounded/edge child controls (item 14/27)', () => {
  it('falls back to full text when the earliest child starts AT or BEFORE the parent (no real prefix)', () => {
    const clause = node('where x is the input', 15, 'clause', [node('where x is the input', 15, 'clause')])
    expect(deriveClauseDisplayLabel(clause)).toBe('where x is the input')
  })

  it('falls back to full text when the earliest child starts at/after the parent\'s own end (outside its span)', () => {
    // Full text is deliberately longer/different from any prefix a dedup would produce, so
    // the assertion clearly distinguishes "fallback happened" from "dedup happened".
    const clause = node('a self-contained clause phrase', 15, 'clause', [node('x is the input', 60, 'clause')])
    expect(deriveClauseDisplayLabel(clause)).toBe('a self-contained clause phrase')
  })

  it('falls back to full text when the derived prefix is only whitespace/punctuation (nonsensical)', () => {
    const clause = node(', x is the input', 15, 'clause', [node('x is the input', 17, 'clause')])
    expect(deriveClauseDisplayLabel(clause)).toBe(', x is the input')
  })
})
