import { describe, expect, it } from 'vitest'
import { detectCoordinationGroup, layoutSiblingsWithCoordinationGroups } from '../../src/features/grammar/domain/coordinationGroupPresentation'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree'

// Prototype 2.3D item 18 — coordination-group presentation tests.

function node(text: string, start: number, role: StructureTreeNode['role'] = 'other', children: StructureTreeNode[] = []): StructureTreeNode {
  return { text, start, end: start + text.length, role, children }
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

describe('layoutSiblingsWithCoordinationGroups — Prototype 2.5S defensive guard (item 25)', () => {
  it('does NOT group two top-level role="other" equation placeholders even though the source gap between them contains "and" (CASE A regression)', () => {
    // Exact shape of the live CASE A bug: [EQUATION_8] and [EQUATION_9] are unrelated
    // equation placeholders that ended up as sibling sentenceModifiers; the literal "and"
    // in the gap actually belongs to the two PREDICATES elsewhere in the sentence, not to
    // these two equations. This must render as two independent nodes, never one group.
    const sentence =
      'The parameter C is a function of the regression slope (b) and intercept (a) [EQUATION_8] and is introduced to the cosine correction model as an additive term [EQUATION_9]'
    const items = layoutSiblingsWithCoordinationGroups(sentence, [node('[EQUATION_8]', 76, 'other'), node('[EQUATION_9]', 158, 'other')])
    expect(items).toHaveLength(2)
    expect(items.every((i) => i.kind === 'node')).toBe(true)
  })

  it('still groups two role="other" nodes via detectCoordinationGroup called directly (guard is scoped to run-building, not the detector itself)', () => {
    const sentence = 'A, B, C.'
    const group = detectCoordinationGroup(sentence, [node('A', 0, 'other'), node('B', 3, 'other'), node('C', 6, 'other')])
    expect(group).not.toBeNull()
  })

  it('does not affect legitimate coordination between typed (non-"other") roles', () => {
    const sentence = 'The sensor collected data and analyzed the results.'
    const items = layoutSiblingsWithCoordinationGroups(sentence, [node('collected', 11, 'predicate'), node('analyzed', 30, 'coordinatedPredicate')])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('group')
  })
})

describe('detectCoordinationGroup — Prototype 2.5ZA: boundaryConnectors (N-ary presentation)', () => {
  it('item 23: 2-member control ("A and B") -> [null, "and"]', () => {
    const sentence = 'The method reduces noise and improves accuracy.'
    const group = detectCoordinationGroup(sentence, [node('reduces noise', 11, 'predicate'), node('improves accuracy', 29, 'coordinatedPredicate')])
    expect(group?.boundaryConnectors).toEqual([null, 'and'])
  })

  it('item 24/28: exact CASE B 3-member shape ("Ln is..., a and b are..., and Lavg is...") -> only the FINAL boundary carries "and"', () => {
    const sentence =
      'This regression line can be rotated to the horizontal to normalize the data using the equation [EQUATION_6] where Ln is the normalized radiance, a and b are the y-intercept and slope of the regression line, respectively, and Lavg is the average of the measured radiance data.'
    const group = detectCoordinationGroup(sentence, [
      node('Ln is the normalized radiance', 114, 'clause'),
      node('a and b are the y-intercept and slope of the regression line, respectively', 145, 'clause'),
      node('Lavg is the average of the measured radiance data', 225, 'clause'),
    ])
    expect(group).not.toBeNull()
    expect(group?.members.map((m) => m.text)).toEqual([
      'Ln is the normalized radiance',
      'a and b are the y-intercept and slope of the regression line, respectively',
      'Lavg is the average of the measured radiance data',
    ])
    expect(group?.boundaryConnectors).toEqual([null, null, 'and'])
    // The old whole-group connectorText remains available too (still correct on its own
    // terms — "the group's one overall connector" — just no longer what the sibling-group
    // renderer uses for badge placement).
    expect(group?.connectorText).toBe('and')
  })

  it('item 25: 4-member control ("A, B, C, and D") -> only the final boundary carries "and", proving the logic is N-ary not hard-coded to 3', () => {
    const sentence = 'The method reduces noise, improves accuracy, lowers cost, and simplifies deployment.'
    const group = detectCoordinationGroup(sentence, [
      node('reduces noise', 11, 'predicate'),
      node('improves accuracy', 26, 'coordinatedPredicate'),
      node('lowers cost', 45, 'coordinatedPredicate'),
      node('simplifies deployment', 62, 'coordinatedPredicate'),
    ])
    expect(group?.boundaryConnectors).toEqual([null, null, null, 'and'])
  })

  it('item 26: "or" control ("A, B, or C") -> final boundary carries "or", not hard-coded to "and"', () => {
    const sentence = 'The user may save the file, discard it, or archive it.'
    const group = detectCoordinationGroup(sentence, [
      node('save the file', 13, 'predicate'),
      node('discard it', 28, 'coordinatedPredicate'),
      node('archive it', 43, 'coordinatedPredicate'),
    ])
    expect(group?.boundaryConnectors).toEqual([null, null, 'or'])
  })

  it('item 27: nested-and negative control — internal "and" occurrences INSIDE a member\'s own text never leak into a neighboring boundary', () => {
    const sentence =
      'This regression line can be rotated to the horizontal to normalize the data using the equation [EQUATION_6] where Ln is the normalized radiance, a and b are the y-intercept and slope of the regression line, respectively, and Lavg is the average of the measured radiance data.'
    const group = detectCoordinationGroup(sentence, [
      node('Ln is the normalized radiance', 114, 'clause'),
      node('a and b are the y-intercept and slope of the regression line, respectively', 145, 'clause'),
      node('Lavg is the average of the measured radiance data', 225, 'clause'),
    ])
    // Member 2's own text contains TWO literal "and" occurrences ("a AND b", "slope AND of
    // the regression line" -- actually "y-intercept and slope"). Neither one may surface as
    // the boundary-1 (member1->member2) connector -- only the literal gap text between the
    // two spans is ever inspected.
    expect(group?.boundaryConnectors[1]).toBeNull()
  })

  it('item 28: source-gap test with explicit grounded spans — gap A->B has no lexical connector, gap B->C does', () => {
    const sentence = 'A, B, and C.'
    // A: 0-1, gap ", " (1-3), B: 3-4, gap ", and " (4-10), C: 10-11
    const group = detectCoordinationGroup(sentence, [node('A', 0, 'other'), node('B', 3, 'other'), node('C', 10, 'other')])
    expect(group?.boundaryConnectors).toEqual([null, null, 'and'])
  })

  it('item 29: no-span fallback — an invalid/overlapping gap (end before start) yields null, never a guessed connector', () => {
    const sentence = 'A and B.'
    // Deliberately malformed: "member 2" starts BEFORE member 1 ends (overlapping spans).
    const group = detectCoordinationGroup(sentence, [node('A and', 0, 'other'), node('B', 2, 'other')])
    // detectCoordinationGroup itself rejects this via its own gap-ordering guard (gapEnd <
    // gapStart -> no group at all) -- confirms the defensive path never fabricates a group,
    // let alone a connector, from malformed input.
    expect(group).toBeNull()
  })

  it('item 30: duplicate-text members — connector derivation uses grounded span positions, never text.indexOf', () => {
    // Two members with IDENTICAL text ("increased") at different real positions; a naive
    // text.indexOf(member.text) approach would always find the FIRST occurrence and get the
    // gap wrong for the second pair.
    const sentence = 'Temperature increased, pressure increased, and volume increased.'
    const group = detectCoordinationGroup(sentence, [
      node('increased', 12, 'coordinatedPredicate'),
      node('increased', 32, 'coordinatedPredicate'),
      node('increased', 54, 'predicate'),
    ])
    expect(group?.boundaryConnectors).toEqual([null, null, 'and'])
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
