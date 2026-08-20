import { describe, expect, it } from 'vitest'
import {
  deriveTreeReadingTargets,
  findTreeReadingTargetForNode,
  treeReadingTargetSignature,
} from '../../src/features/grammar/domain/treeReadingTargets'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree'

const sentence = 'Grid units and slope units are the two types of evaluation units most commonly used in LSM (Lima et al. 2022).'
const modifier: StructureTreeNode = {
  text: 'most commonly used', role: 'condition', start: 65, end: 83, children: [],
  presentationSpan: { text: 'most commonly used in LSM', start: 65, end: 90 },
}
const complement: StructureTreeNode = {
  text: 'the two types of evaluation units most commonly used in LSM', role: 'complement',
  start: 31, end: 90, children: [modifier],
}
const predicate: StructureTreeNode = { text: 'are', role: 'predicate', start: 27, end: 30, children: [complement] }
const subject: StructureTreeNode = { text: 'Grid units and slope units', role: 'subject', start: 0, end: 26, children: [predicate] }
const citation: StructureTreeNode = { text: '(Lima et al. 2022)', role: 'clause', start: 91, end: 109, children: [] }

describe('deriveTreeReadingTargets', () => {
  it('derives compact stable path IDs and skips the trivial copula', () => {
    const targets = deriveTreeReadingTargets([subject], sentence)
    expect(targets.map(({ targetId }) => targetId)).toEqual(['tree-0', 'tree-0-0-0', 'tree-0-0-0-0'])
    expect(targets.map(({ displayText }) => displayText)).not.toContain('are')
  })

  it('preserves B4 display, authority, and interaction distinctions', () => {
    const targets = deriveTreeReadingTargets([subject], sentence)
    expect(targets[1]).toMatchObject({
      displayText: 'the two types of evaluation units',
      authorityText: 'the two types of evaluation units most commonly used in LSM',
      authoritativeStart: 31, authoritativeEnd: 90, interactionStart: 31, interactionEnd: 90,
    })
    expect(targets[2]).toMatchObject({
      displayText: 'most commonly used in LSM', authorityText: 'most commonly used',
      authoritativeStart: 65, authoritativeEnd: 83, interactionStart: 65, interactionEnd: 90,
    })
  })

  it('selects the coordinated subject and postmodifier as useful targets', () => {
    const targets = deriveTreeReadingTargets([subject], sentence)
    expect(targets[0]).toMatchObject({ role: 'subject', displayText: 'Grid units and slope units' })
    expect(targets[2]).toMatchObject({ role: 'condition', parentTargetId: 'tree-0-0-0' })
  })

  it('does not create a citation reading target', () => {
    expect(deriveTreeReadingTargets([subject, citation], sentence).map(({ displayText }) => displayText)
      .some((text) => text.includes('Lima et al.'))).toBe(false)
  })

  it('looks up by exact active node identity, never fuzzy span matching', () => {
    const targets = deriveTreeReadingTargets([subject], sentence)
    expect(findTreeReadingTargetForNode(modifier, targets)?.targetId).toBe('tree-0-0-0-0')
    expect(findTreeReadingTargetForNode(predicate, targets)).toBeNull()
  })

  it('uses target content in the deterministic cache signature', () => {
    const targets = deriveTreeReadingTargets([subject], sentence)
    expect(treeReadingTargetSignature(targets)).toBe(treeReadingTargetSignature(deriveTreeReadingTargets([subject], sentence)))
    expect(treeReadingTargetSignature([{ ...targets[0], interactionEnd: 25 }]))
      .not.toBe(treeReadingTargetSignature([targets[0]]))
  })
})

describe('Prototype 2.6G2.8M2.2c -- interactionText MATH_EXPR restoration', () => {
  it('restores a MATH_EXPR token inside interactionText when projection/sourceText are supplied', async () => {
    const { shieldRelationalMathRuns } = await import('../../src/features/grammar/domain/mathRunProjection')
    const { projectionFromSource } = await import('../../src/features/grammar/domain/textProjection')
    const source = 'the result was k = 0.5 in this case.'
    const projection = shieldRelationalMathRuns(projectionFromSource(source), source)
    const node: StructureTreeNode = {
      text: 'was MATH_EXPR in this case', role: 'complement',
      start: projection.text.indexOf('was'), end: projection.text.length - 1, children: [],
    }
    const targets = deriveTreeReadingTargets([node], projection.text, projection, source)
    expect(targets[0].interactionText).not.toContain('MATH_EXPR')
    expect(targets[0].interactionText).toContain('k = 0.5')
  })

  it('leaves interactionText unchanged when projection/sourceText are omitted (backward compatible)', () => {
    const targets = deriveTreeReadingTargets([subject], sentence)
    expect(targets[0].interactionText).toBe('Grid units and slope units')
  })

  it('leaves interactionText unchanged when there is nothing synthetic to restore', async () => {
    const { shieldRelationalMathRuns } = await import('../../src/features/grammar/domain/mathRunProjection')
    const { projectionFromSource } = await import('../../src/features/grammar/domain/textProjection')
    const source = 'Grid units and slope units are the two types.'
    const projection = shieldRelationalMathRuns(projectionFromSource(source), source) // no relational math -- no-op
    const nodeEnd = source.indexOf(' are')
    const node: StructureTreeNode = { text: 'Grid units and slope units', role: 'subject', start: 0, end: nodeEnd, children: [] }
    const targets = deriveTreeReadingTargets([node], projection.text, projection, source)
    expect(targets[0].interactionText).toBe('Grid units and slope units')
  })
})
