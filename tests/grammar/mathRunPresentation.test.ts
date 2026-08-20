import { describe, expect, it } from 'vitest'
import { isFullySyntheticRange, restoreMathRunsInStructureTree } from '../../src/features/grammar/domain/mathRunPresentation.ts'
import { shieldRelationalMathRuns } from '../../src/features/grammar/domain/mathRunProjection.ts'
import { projectionFromSource } from '../../src/features/grammar/domain/textProjection.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.8M2.2a Track B -- MATH_EXPR must never appear in any user-visible
 * presentation surface (item 6), while remaining the literal token Stanza sees (item 15).
 * `SyntheticRunSourceRange` (item 7) is the sole authority for restoring/excluding it --
 * never a literal `text === 'MATH_EXPR'` string check.
 */

function leaf(text: string, start: number, end: number, role: StructureTreeNode['role'] = 'other'): StructureTreeNode {
  return { text, role, start, end, children: [] }
}

describe('restoreMathRunsInStructureTree', () => {
  it('restores a node whose entire text IS the MATH_EXPR token', () => {
    const source = 'the result was k = 0.5 in this case.'
    const projection = shieldRelationalMathRuns(projectionFromSource(source), source)
    const tokenStart = projection.text.indexOf('MATH_EXPR')
    const tokenEnd = tokenStart + 'MATH_EXPR'.length
    const nodes = [leaf('MATH_EXPR', tokenStart, tokenEnd)]
    const restored = restoreMathRunsInStructureTree(nodes, projection, source)
    expect(restored[0].text).toBe('k = 0.5')
  })

  it('restores a node whose text is a larger phrase CONTAINING the MATH_EXPR token', () => {
    const source = 'The value was t = 0.5.'
    const projection = shieldRelationalMathRuns(projectionFromSource(source), source)
    // "was MATH_EXPR." -- a node spanning from "was" through the period.
    const nodeStart = projection.text.indexOf('was')
    const nodeEnd = projection.text.length
    const nodeText = projection.text.slice(nodeStart, nodeEnd)
    const nodes = [leaf(nodeText, nodeStart, nodeEnd)]
    const restored = restoreMathRunsInStructureTree(nodes, projection, source)
    expect(restored[0].text).toBe('was t = 0.5.')
    expect(restored[0].text).not.toContain('MATH_EXPR')
  })

  it('never touches a node with no synthetic content at all', () => {
    const source = 'the response is proportional to cos i.'
    const projection = shieldRelationalMathRuns(projectionFromSource(source), source) // never shielded -- simple/stable
    const nodes = [leaf('cos i', source.indexOf('cos i'), source.indexOf('cos i') + 'cos i'.length)]
    const restored = restoreMathRunsInStructureTree(nodes, projection, source)
    expect(restored[0].text).toBe('cos i')
  })

  it('restores nested children recursively', () => {
    const source = 'the result was k = 0.5 in this case.'
    const projection = shieldRelationalMathRuns(projectionFromSource(source), source)
    const tokenStart = projection.text.indexOf('MATH_EXPR')
    const tokenEnd = tokenStart + 'MATH_EXPR'.length
    const child = leaf('MATH_EXPR', tokenStart, tokenEnd)
    const parent: StructureTreeNode = { text: 'MATH_EXPR', role: 'complement', start: tokenStart, end: tokenEnd, children: [child] }
    const restored = restoreMathRunsInStructureTree([parent], projection, source)
    expect(restored[0].text).toBe('k = 0.5')
    expect(restored[0].children[0].text).toBe('k = 0.5')
  })

  it('restores presentationSpan text independently of the node own text', () => {
    const source = 'the result was k = 0.5 in this case.'
    const projection = shieldRelationalMathRuns(projectionFromSource(source), source)
    const tokenStart = projection.text.indexOf('MATH_EXPR')
    const tokenEnd = tokenStart + 'MATH_EXPR'.length
    const node: StructureTreeNode = {
      text: 'MATH_EXPR',
      role: 'complement',
      start: tokenStart,
      end: tokenEnd,
      children: [],
      presentationSpan: { text: 'MATH_EXPR', start: tokenStart, end: tokenEnd },
    }
    const restored = restoreMathRunsInStructureTree([node], projection, source)
    expect(restored[0].presentationSpan?.text).toBe('k = 0.5')
  })

  it('handles multiple math runs mapping to their own distinct source ranges, never swapped', () => {
    const source = 't = 1, a = 2, and r = 3'
    const projection = shieldRelationalMathRuns(projectionFromSource(source), source)
    const nodeText = projection.text
    const nodes = [leaf(nodeText, 0, nodeText.length)]
    const restored = restoreMathRunsInStructureTree(nodes, projection, source)
    expect(restored[0].text).toBe('t = 1, a = 2, and r = 3')
  })

  it('is a no-op when the projection has no synthetic runs at all', () => {
    const source = 'an ordinary sentence with nothing scientific.'
    const projection = projectionFromSource(source)
    const nodes = [leaf(source, 0, source.length)]
    const restored = restoreMathRunsInStructureTree(nodes, projection, source)
    expect(restored[0].text).toBe(source)
  })
})

describe('isFullySyntheticRange', () => {
  it('is true for a span exactly matching one synthetic run', () => {
    const source = 'the result was k = 0.5 in this case.'
    const projection = shieldRelationalMathRuns(projectionFromSource(source), source)
    const start = projection.text.indexOf('MATH_EXPR')
    const end = start + 'MATH_EXPR'.length
    expect(isFullySyntheticRange(start, end, projection)).toBe(true)
  })

  it('is false for a span that straddles a synthetic run boundary (only partially inside it)', () => {
    const source = 'the result was k = 0.5 in this case.'
    const projection = shieldRelationalMathRuns(projectionFromSource(source), source)
    const start = projection.text.indexOf('MATH_EXPR')
    // starts BEFORE the synthetic run and ends INSIDE it -- not fully contained.
    expect(isFullySyntheticRange(start - 2, start + 3, projection)).toBe(false)
  })

  it('is false for an ordinary, never-shielded span', () => {
    const source = 'the response is proportional to cos i.'
    const projection = shieldRelationalMathRuns(projectionFromSource(source), source)
    const start = source.indexOf('cos i')
    expect(isFullySyntheticRange(start, start + 'cos i'.length, projection)).toBe(false)
  })
})
