import { describe, expect, it } from 'vitest'
import { detectCoordinationGroup, layoutSiblingsWithCoordinationGroups } from '../../src/features/grammar/domain/coordinationGroupPresentation'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree'

// Prototype 2.3D item 18 — coordination-group presentation tests.

function node(text: string, start: number, role: StructureTreeNode['role'] = 'other', children: StructureTreeNode[] = []): StructureTreeNode {
  return { text, start, role, children }
}

describe('detectCoordinationGroup — predicate coordination (item 18: A and B / A or B / A but B / triple)', () => {
  it('groups two predicates joined by "and"', () => {
    const sentence = 'The sensor collected data and analyzed the results.'
    const group = detectCoordinationGroup(sentence, [node('collected', 11, 'predicate'), node('analyzed', 30, 'coordinatedPredicate')])
    expect(group).not.toBeNull()
    expect(group?.members.map((m) => m.text)).toEqual(['collected', 'analyzed'])
    expect(group?.connectorText).toBe('and')
  })

  it('groups two predicates joined by "or"', () => {
    const sentence = 'The user saves the file or discards it.'
    const group = detectCoordinationGroup(sentence, [node('saves', 9, 'predicate'), node('discards', 26, 'coordinatedPredicate')])
    expect(group?.connectorText).toBe('or')
  })

  it('groups two predicates joined by "but"', () => {
    const sentence = 'The sensor recorded data but failed to transmit it.'
    const group = detectCoordinationGroup(sentence, [node('recorded', 11, 'predicate'), node('failed', 28, 'coordinatedPredicate')])
    expect(group?.connectorText).toBe('but')
  })

  it('groups a triple predicate chain (comma-series + final "and"), extracting only the LAST explicit conjunction (item 7)', () => {
    const sentence = 'The samples were dried, weighed, and stored at room temperature.'
    const group = detectCoordinationGroup(sentence, [
      node('were dried', 12, 'coordinatedPredicate'),
      node('weighed', 24, 'coordinatedPredicate'),
      node('stored', 37, 'predicate'),
    ])
    expect(group?.members.map((m) => m.text)).toEqual(['were dried', 'weighed', 'stored'])
    expect(group?.connectorText).toBe('and')
  })

  it('returns null (no group) when fewer than 2 candidates', () => {
    expect(detectCoordinationGroup('Data increased.', [node('increased', 5, 'predicate')])).toBeNull()
  })

  it('returns null when a gap has NO coordination evidence at all', () => {
    const sentence = 'The study showed that temperature increased.'
    const group = detectCoordinationGroup(sentence, [node('showed', 10, 'predicate'), node('increased', 33, 'coordinatedPredicate')])
    expect(group).toBeNull()
  })
})

describe('detectCoordinationGroup — Reno dependent group (two "condition" branches under one predicate)', () => {
  it('groups two same-role dependents joined by "and"', () => {
    const sentence = 'Data was recorded every 1 nm in the 0.4 to 0.8 μm region and every 4 nm from 0.8 to 2.5 μm.'
    const group = detectCoordinationGroup(sentence, [node('every 1 nm', 18, 'condition'), node('every 4 nm', 65, 'condition')])
    expect(group?.connectorText).toBe('and')
    expect(group?.members.map((m) => m.text)).toEqual(['every 1 nm', 'every 4 nm'])
  })
})

describe('layoutSiblingsWithCoordinationGroups — main use in the renderer', () => {
  it('wraps main+coordinated predicate siblings into ONE group item', () => {
    const sentence = 'The sensor collected data and analyzed the results.'
    const items = layoutSiblingsWithCoordinationGroups(sentence, [
      node('collected', 11, 'predicate'),
      node('analyzed', 30, 'coordinatedPredicate'),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('group')
  })

  it('leaves an ungrouped single predicate as a plain node (Primary Reno single-predicate shape)', () => {
    const sentence = 'Data was recorded every 1 nm.'
    const items = layoutSiblingsWithCoordinationGroups(sentence, [node('was recorded', 5, 'predicate')])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('node')
    if (items[0].kind !== 'node') return
    expect(items[0].node.text).toBe('was recorded')
  })

  it('does NOT group dependents of different roles even if adjacent (a "modifier" next to a "condition")', () => {
    const sentence = 'The sensor collected data quickly under load.'
    const items = layoutSiblingsWithCoordinationGroups(sentence, [
      node('data', 21, 'object'),
      node('quickly', 26, 'modifier'),
      node('under load', 34, 'condition'),
    ])
    expect(items.every((i) => i.kind === 'node')).toBe(true)
  })

  it('falls back to ungrouped nodes when a same-role run lacks coordination evidence between members', () => {
    // Two "modifier" dependents that just happen to be adjacent, with no and/or/but/comma
    // between them at all — must NOT be grouped (precision over recall, item 10's spirit).
    const sentence = 'The team reported results here today.'
    const items = layoutSiblingsWithCoordinationGroups(sentence, [node('here', 24, 'modifier'), node('today', 29, 'modifier')])
    expect(items.every((i) => i.kind === 'node')).toBe(true)
  })

  it('preserves nested children on grouped members (nested text remains reachable/selectable)', () => {
    const sentence = 'The sensor collected data and analyzed the results.'
    const childNode = node('data', 21, 'object')
    const items = layoutSiblingsWithCoordinationGroups(sentence, [
      node('collected', 11, 'predicate', [childNode]),
      node('analyzed', 30, 'coordinatedPredicate'),
    ])
    expect(items[0].kind).toBe('group')
    if (items[0].kind !== 'group') return
    expect(items[0].group.members[0].children).toEqual([childNode])
  })
})

describe('safety — no invented connector, no candidate-membership change', () => {
  it('connectorText is always a literal substring of the sentence between two members', () => {
    const sentence = 'The samples were dried, weighed, and stored at room temperature.'
    const group = detectCoordinationGroup(sentence, [
      node('were dried', 12, 'coordinatedPredicate'),
      node('weighed', 24, 'coordinatedPredicate'),
      node('stored', 37, 'predicate'),
    ])
    expect(group?.connectorText).not.toBeNull()
    if (!group?.connectorText) return
    expect(sentence).toContain(group.connectorText)
  })

  it('connectorText is null (never fabricated) when no explicit conjunction word exists in any gap', () => {
    // A comma-only chain with no "and"/"or"/"but" word anywhere — evidence (comma) is
    // enough to GROUP, but there is no word to safely display as a badge.
    const sentence = 'A, B, C.'
    const group = detectCoordinationGroup(sentence, [node('A', 0, 'other'), node('B', 3, 'other'), node('C', 6, 'other')])
    expect(group).not.toBeNull()
    expect(group?.connectorText).toBeNull()
  })

  it('group membership is exactly the input candidates (sorted by position), never a superset/subset', () => {
    const sentence = 'The sensor collected data and analyzed the results.'
    const a = node('analyzed', 30, 'coordinatedPredicate')
    const b = node('collected', 11, 'predicate')
    const group = detectCoordinationGroup(sentence, [a, b]) // passed out of order
    expect(group?.members.map((m) => m.text)).toEqual(['collected', 'analyzed'])
  })
})
