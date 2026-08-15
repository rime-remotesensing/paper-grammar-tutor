import { describe, expect, it } from 'vitest'
import { applyFocusedRelativeLinks, buildCoreOnlyTree, buildHybridStructureTree } from '../../src/features/grammar/domain/structureTree'
import { groundRelativeLinkRelation } from '../../src/features/grammar/domain/relativeLinkGrounding'
import type { SentenceCore, SentencePattern, Span } from '../../src/features/grammar/schemas/grammarAnalysis.schema'
import type { HybridDependent, HybridDependentRole, HybridMergedStructure, HybridPredicate } from '../../src/features/grammar/domain/hybridPredicateMerger'
import type { StructureRole } from '../../src/features/grammar/schemas/predicateStructure.schema'

function span(text: string, start: number): Span {
  return { text, start, end: start + text.length }
}

function core(pattern: SentencePattern, overrides: Partial<SentenceCore> = {}): SentenceCore {
  return {
    subject: span('S', 0),
    subjectHead: span('S', 0),
    verb: span('V', 10),
    indirectObject: null,
    object: null,
    complement: null,
    pattern,
    ...overrides,
  }
}

function leaf(text: string, start: number, role: HybridDependentRole = 'other') {
  return { text, start, end: start + text.length, role }
}

/** subjectModifiers/sentenceModifiers on HybridMergedStructure are ResolvedLeaf[] (the
 * structure analyzer's own StructureRole space, never "indirectObject" — that role only
 * ever appears on a predicate's dependents, injected by the merger from sentenceCore). */
function modifierLeaf(text: string, start: number, role: StructureRole = 'other') {
  return { text, start, end: start + text.length, role }
}

function dependent(text: string, start: number, role: HybridDependentRole = 'other', children: ReturnType<typeof leaf>[] = []): HybridDependent {
  return { text, start, end: start + text.length, role, children }
}

function predicate(
  text: string,
  start: number,
  relation: 'main' | 'coordinated' = 'main',
  dependents: HybridDependent[] = [],
): HybridPredicate {
  return { text, start, end: start + text.length, relation, dependents, isCoreAnchor: relation === 'main' }
}

function hybrid(overrides: Partial<HybridMergedStructure> = {}): HybridMergedStructure {
  return {
    subject: null,
    subjectModifiers: [],
    predicates: [],
    sentenceModifiers: [],
    dropped: [],
    suppressedCoreDependents: [],
    anchorInjected: false,
    ...overrides,
  }
}

describe('buildCoreOnlyTree — mechanical core pattern -> spine mapping (Prototype 2.3C item 22 fallback)', () => {
  it('SV: S -> V', () => {
    const tree = buildCoreOnlyTree(core('SV'))
    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ text: 'S', role: 'subject' })
    expect(tree[0].children).toHaveLength(1)
    expect(tree[0].children[0]).toMatchObject({ text: 'V', role: 'predicate' })
    expect(tree[0].children[0].children).toHaveLength(0)
  })

  it('SVC: S -> V -> C', () => {
    const tree = buildCoreOnlyTree(core('SVC', { complement: span('C', 20) }))
    const v = tree[0].children[0]
    expect(v.children).toHaveLength(1)
    expect(v.children[0]).toMatchObject({ text: 'C', role: 'complement' })
  })

  it('SVO: S -> V -> O', () => {
    const tree = buildCoreOnlyTree(core('SVO', { object: span('O', 20) }))
    const v = tree[0].children[0]
    expect(v.children).toHaveLength(1)
    expect(v.children[0]).toMatchObject({ text: 'O', role: 'object' })
  })

  it('SVOO: S -> V -> {IO, O} as siblings', () => {
    const tree = buildCoreOnlyTree(core('SVOO', { indirectObject: span('IO', 20), object: span('O', 30) }))
    const v = tree[0].children[0]
    expect(v.children.map((c) => c.role)).toEqual(['indirectObject', 'object'])
    expect(v.children.map((c) => c.text)).toEqual(['IO', 'O'])
  })

  it('SVOC: S -> V -> O -> C', () => {
    const tree = buildCoreOnlyTree(core('SVOC', { object: span('O', 20), complement: span('C', 30) }))
    const v = tree[0].children[0]
    expect(v.children).toHaveLength(1)
    const o = v.children[0]
    expect(o).toMatchObject({ text: 'O', role: 'object' })
    expect(o.children).toHaveLength(1)
    expect(o.children[0]).toMatchObject({ text: 'C', role: 'complement' })
  })

  it('returns an empty forest when subject or verb is missing (defensive)', () => {
    expect(buildCoreOnlyTree(core('SV', { subject: null }))).toEqual([])
    expect(buildCoreOnlyTree(core('SV', { verb: null }))).toEqual([])
  })
})

describe('buildHybridStructureTree — single main predicate with dependents (Primary Reno shape)', () => {
  it('attaches predicate dependents (with nested children) under the single main predicate', () => {
    const result = hybrid({
      predicates: [
        predicate('was recorded', 5, 'main', [
          dependent('every 1 nm', 18, 'condition', [leaf('in the 0.4 to 0.8 μm region', 29, 'range')]),
          dependent('every 4 nm', 65, 'condition', [leaf('from 0.8 to 2.5 μm', 76, 'range')]),
        ]),
      ],
    })
    const tree = buildHybridStructureTree(core('SV', { subject: span('Data', 0), verb: span('was recorded', 5) }), result)
    expect(tree).toHaveLength(1)
    const [subjectNode] = tree
    expect(subjectNode.children.map((c) => c.text)).toEqual(['was recorded'])
    const predicateNode = subjectNode.children[0]
    expect(predicateNode.role).toBe('predicate')
    expect(predicateNode.children.map((c) => c.text)).toEqual(['every 1 nm', 'every 4 nm'])
    expect(predicateNode.children[0].children[0].text).toBe('in the 0.4 to 0.8 μm region')
    expect(predicateNode.children[1].children[0].text).toBe('from 0.8 to 2.5 μm')
  })
})

describe('buildHybridStructureTree — coordinated predicates as siblings of subject (Prototype 2.3B/2.3C)', () => {
  it('main + coordinated predicates both attach as siblings under subject, in source order', () => {
    const result = hybrid({
      predicates: [
        predicate('collected', 10, 'main', [dependent('data', 20, 'object')]),
        predicate('analyzed', 30, 'coordinated', [dependent('the results', 40, 'object')]),
      ],
    })
    const tree = buildHybridStructureTree(core('SV', { subject: span('The sensor', 0), verb: span('collected', 10) }), result)
    expect(tree[0].children.map((c) => c.text)).toEqual(['collected', 'analyzed'])
    expect(tree[0].children.map((c) => c.role)).toEqual(['predicate', 'coordinatedPredicate'])
    expect(tree[0].children[0].children[0].text).toBe('data')
    expect(tree[0].children[1].children[0].text).toBe('the results')
  })

  it('THREE coordinated predicates (triple predicate case) all attach as siblings', () => {
    const result = hybrid({
      predicates: [
        predicate('were dried', 12, 'coordinated'),
        predicate('weighed', 24, 'coordinated'),
        predicate('stored', 37, 'main', [dependent('at room temperature', 44, 'condition')]),
      ],
    })
    const tree = buildHybridStructureTree(core('SV', { subject: span('The samples', 0), verb: span('stored', 37) }), result)
    expect(tree[0].children.map((c) => c.text)).toEqual(['were dried', 'weighed', 'stored'])
    const stored = tree[0].children.find((c) => c.text === 'stored')
    expect(stored?.role).toBe('predicate')
    expect(stored?.children[0].text).toBe('at room temperature')
  })
})

describe('buildHybridStructureTree — subjectModifiers and sentenceModifiers', () => {
  it('attaches subjectModifiers as siblings of the predicate(s) under subject', () => {
    const result = hybrid({
      subjectModifiers: [modifierLeaf('of California buckwheat, white peppermint and sycamore', 17, 'modifier')],
      predicates: [predicate('were available', 91, 'main', [dependent('locally', 106, 'modifier')])],
    })
    const tree = buildHybridStructureTree(
      core('SV', { subject: span('The green leaves', 0), verb: span('were available', 91) }),
      result,
    )
    expect(tree[0].text).toBe('The green leaves')
    expect(tree[0].children.map((c) => c.text)).toEqual([
      'of California buckwheat, white peppermint and sycamore',
      'were available',
    ])
  })

  it('renders sentenceModifiers as top-level siblings of the subject node, not nested under it', () => {
    const result = hybrid({
      predicates: [predicate('remained', 34, 'main', [dependent('stable', 43, 'complement')])],
      sentenceModifiers: [modifierLeaf('Although temperatures increased', 0, 'clause')],
    })
    const tree = buildHybridStructureTree(core('SV', { subject: span('the sensor', 25), verb: span('remained', 34) }), result)
    expect(tree).toHaveLength(2)
    expect(tree[0].role).toBe('subject')
    expect(tree[1]).toMatchObject({ text: 'Although temperatures increased', role: 'clause' })
  })

  it('relabels a sentenceModifier that starts with a relative pronoun as relativeClause instead of its raw role (live diagnosis: "that have changed..." sometimes grounds as a detached sentenceModifier rather than nested under its antecedent)', () => {
    const result = hybrid({
      predicates: [predicate('emphasizing', 45, 'coordinated', [dependent('those aspects', 57, 'object')])],
      sentenceModifiers: [modifierLeaf('that have changed since Collection 5', 71, 'condition')],
    })
    const c = core('SVO', { subject: span('we', 0), verb: span('describe', 3), object: span('the Collection 6 algorithm', 12) })
    const verifiedSpan = span('emphasizing those aspects that have changed since Collection 5', 45)
    const tree = buildHybridStructureTree(c, result, verifiedSpan)
    const modifierNode = tree.find((n) => n.text === 'that have changed since Collection 5')!
    expect(modifierNode.role).toBe('relativeClause')
    expect(modifierNode.role).not.toBe('condition')
  })
})

describe('buildHybridStructureTree — empty/defensive cases', () => {
  it('returns an empty forest when subject or verb is missing', () => {
    expect(buildHybridStructureTree(core('SV', { subject: null }), hybrid())).toEqual([])
    expect(buildHybridStructureTree(core('SV', { verb: null }), hybrid())).toEqual([])
  })

  it('produces a subject-only forest when there are no predicates at all (defensive)', () => {
    const tree = buildHybridStructureTree(core('SV'), hybrid())
    expect(tree).toHaveLength(1)
    expect(tree[0].children).toEqual([])
  })
})

describe('buildHybridStructureTree — Prototype 2.3M: opening modifier / supplement / relative clause (item 39 A-J)', () => {
  // Target-sentence-shaped fixture: "In Section 3, we describe the Collection 6
  // algorithm, emphasizing those aspects that have changed since Collection 5."
  const SUBJECT_START = 14 // "we" starts after "In Section 3, "
  const targetCore = core('SVO', {
    subject: span('we', SUBJECT_START),
    subjectHead: span('we', SUBJECT_START),
    verb: span('describe', 17),
    object: span('the Collection 6 algorithm', 26),
    complement: null, // effectiveCore already has complement nulled (2.3I authority)
  })
  const targetHybrid = hybrid({
    subjectModifiers: [modifierLeaf('In Section 3', 0, 'clause')], // ends well before SUBJECT_START -> opening
    predicates: [
      predicate('describe', 17, 'main', [dependent('the Collection 6 algorithm', 26, 'object')]),
      predicate('emphasizing', 55, 'coordinated', [
        dependent('those aspects', 67, 'object', [leaf('that have changed since Collection 5', 81, 'condition')]),
      ]),
    ],
  })
  // The 2.3I Focused Complement Verifier's rawCore.complement span — the FULL candidate
  // complement text, overlapping the "emphasizing" predicate's own (shorter) span.
  const verifiedSupplementSpan = span('emphasizing those aspects that have changed since Collection 5', 55)

  it('A/B: opening modifier appears top-level, NOT nested under subject', () => {
    const tree = buildHybridStructureTree(targetCore, targetHybrid, verifiedSupplementSpan)
    const opening = tree.find((n) => n.role === 'openingModifier')
    expect(opening).toMatchObject({ text: 'In Section 3', role: 'openingModifier' })
    const subjectNode = tree.find((n) => n.role === 'subject')
    expect(subjectNode?.children.some((c) => c.text === 'In Section 3')).toBe(false)
  })

  it('C/D: the verified supplementary-ing predicate is never rendered as complement or coordinated main predicate', () => {
    const tree = buildHybridStructureTree(targetCore, targetHybrid, verifiedSupplementSpan)
    const subjectNode = tree.find((n) => n.role === 'subject')!
    // "describe" is the ONLY predicate left under subject.
    expect(subjectNode.children.filter((c) => c.role === 'predicate' || c.role === 'coordinatedPredicate')).toHaveLength(1)
    expect(subjectNode.children.some((c) => c.text === 'emphasizing')).toBe(false)
    // It is rendered as its own top-level 'supplement' block instead.
    const supplement = tree.find((n) => n.role === 'supplement')
    expect(supplement?.text).toBe('emphasizing')
  })

  it('main clause looks complete on its own: subject -> describe -> the Collection 6 algorithm', () => {
    const tree = buildHybridStructureTree(targetCore, targetHybrid, verifiedSupplementSpan)
    const subjectNode = tree.find((n) => n.role === 'subject')!
    const describeNode = subjectNode.children.find((c) => c.text === 'describe')!
    expect(describeNode.role).toBe('predicate')
    expect(describeNode.children.map((c) => c.text)).toEqual(['the Collection 6 algorithm'])
  })

  it('E: the relative clause span keeps "that" intact', () => {
    const tree = buildHybridStructureTree(targetCore, targetHybrid, verifiedSupplementSpan)
    const supplement = tree.find((n) => n.role === 'supplement')!
    const thoseAspects = supplement.children.find((c) => c.text === 'those aspects')!
    const relativeNode = thoseAspects.children.find((c) => c.role === 'relativeClause')
    expect(relativeNode?.text).toBe('that have changed since Collection 5')
    expect(relativeNode?.text.startsWith('that')).toBe(true)
  })

  it('F: the antecedent ("those aspects") is identifiable via its relativeClause child', () => {
    const tree = buildHybridStructureTree(targetCore, targetHybrid, verifiedSupplementSpan)
    const supplement = tree.find((n) => n.role === 'supplement')!
    const thoseAspects = supplement.children.find((c) => c.text === 'those aspects')!
    expect(thoseAspects.children.some((c) => c.role === 'relativeClause')).toBe(true)
  })

  it('H: "have changed since Collection 5" is labeled relativeClause, never "condition"', () => {
    const tree = buildHybridStructureTree(targetCore, targetHybrid, verifiedSupplementSpan)
    const supplement = tree.find((n) => n.role === 'supplement')!
    const thoseAspects = supplement.children.find((c) => c.text === 'those aspects')!
    const relativeNode = thoseAspects.children.find((c) => /have changed/.test(c.text))
    expect(relativeNode?.role).toBe('relativeClause')
    expect(relativeNode?.role).not.toBe('condition')
  })

  it('J: effectiveCore stays SVO (no C row) — core-level regression guard', () => {
    expect(targetCore.pattern).toBe('SVO')
    expect(targetCore.complement).toBeNull()
  })

  it('does not treat "emphasizing" as a supplement when verification never confirmed it (verifiedSupplementSpan=null)', () => {
    const tree = buildHybridStructureTree(targetCore, targetHybrid, null)
    const subjectNode = tree.find((n) => n.role === 'subject')!
    // Without verified authority, the raw hybrid predicate list is used as-is (unchanged
    // from Prototype 2.3C/D behavior) -- "emphasizing" stays a coordinatedPredicate under
    // subject rather than being pulled out as a supplement.
    expect(subjectNode.children.some((c) => c.text === 'emphasizing' && c.role === 'coordinatedPredicate')).toBe(true)
    expect(tree.some((n) => n.role === 'supplement')).toBe(false)
  })
})

describe('buildHybridStructureTree — Prototype 2.3M: subject-attached relative clause (flat text split)', () => {
  it('"The aspects that have changed" splits into subject antecedent + relativeClause child', () => {
    const c = core('SVC', { subject: span('The aspects that have changed', 0), verb: span('are', 31), complement: span('important', 35) })
    const tree = buildHybridStructureTree(c, hybrid({ predicates: [predicate('are', 31, 'main', [dependent('important', 35, 'complement')])] }))
    const subjectNode = tree.find((n) => n.role === 'subject')!
    expect(subjectNode.text).toBe('The aspects')
    const relativeChild = subjectNode.children.find((child) => child.role === 'relativeClause')
    expect(relativeChild?.text).toBe('that have changed')
    // main predicate ("are") is preserved as a sibling of the relative clause, untouched.
    expect(subjectNode.children.some((child) => child.text === 'are' && child.role === 'predicate')).toBe(true)
  })
})

describe('buildHybridStructureTree — Prototype 2.3M: content-that negative control (item G)', () => {
  it('a plain object dependent with no relative pronoun never gets a relativeClause marker', () => {
    const c = core('SVO', { subject: span('The study', 0), verb: span('showed', 10), object: span('temperature increased', 22) })
    const result = hybrid({ predicates: [predicate('showed', 10, 'main', [dependent('temperature increased', 22, 'object')])] })
    const tree = buildHybridStructureTree(c, result)
    const subjectNode = tree.find((n) => n.role === 'subject')!
    const showedNode = subjectNode.children.find((child) => child.text === 'showed')!
    const objectNode = showedNode.children.find((child) => child.text === 'temperature increased')!
    expect(objectNode.role).toBe('object')
    expect(objectNode.children).toEqual([])
  })

  it('a content-clause dependent grounded as a FLAT SIBLING (not a child) of a non-NP dependent is never relabeled relativeClause — live diagnosis regression guard', () => {
    // Real live output for "The study showed that temperature increased." occasionally
    // grounds "that temperature increased" as its own dependent of "showed", as a SIBLING
    // of "temperature increased" (duplicate/overlapping grounding), in that order. The
    // sibling-adjacency re-parenting rule must NOT fire here because the preceding sibling
    // ("that temperature increased" itself, role 'clause') is not an object/indirectObject
    // antecedent -- there is nothing safe to attach it to.
    const c = core('SVO', { subject: span('The study', 0), verb: span('showed', 10), object: span('temperature increased', 22) })
    const result = hybrid({
      predicates: [
        predicate('showed', 10, 'main', [
          dependent('that temperature increased', 17, 'clause'),
          dependent('temperature increased', 22, 'object'),
        ]),
      ],
    })
    const tree = buildHybridStructureTree(c, result)
    const subjectNode = tree.find((n) => n.role === 'subject')!
    const showedNode = subjectNode.children.find((child) => child.text === 'showed')!
    const clauseNode = showedNode.children.find((child) => child.text === 'that temperature increased')!
    expect(clauseNode.role).not.toBe('relativeClause')
    expect(clauseNode.role).toBe('clause')
  })
})

describe('buildHybridStructureTree — Prototype 2.3M: flat-sibling relative clause re-parenting (live diagnosis regression guard)', () => {
  it('re-parents a relative clause grounded as a flat SIBLING of its object antecedent, and marks the antecedent (not the parent predicate) for the underline', () => {
    // Real live output for the target sentence sometimes grounds "those aspects" and "that
    // have changed since Collection 5" as two flat sibling dependents of "emphasizing"
    // rather than nesting one inside the other.
    const c = core('SVO', { subject: span('we', 0), verb: span('describe', 3), object: span('the Collection 6 algorithm', 12) })
    const result = hybrid({
      predicates: [
        predicate('describe', 3, 'main', [dependent('the Collection 6 algorithm', 12, 'object')]),
        predicate('emphasizing', 45, 'coordinated', [
          dependent('those aspects', 57, 'object'),
          dependent('that have changed since Collection 5', 71, 'condition'),
        ]),
      ],
    })
    const verifiedSpan = span('emphasizing those aspects that have changed since Collection 5', 45)
    const tree = buildHybridStructureTree(c, result, verifiedSpan)
    const supplement = tree.find((n) => n.role === 'supplement')!
    expect(supplement.children.map((n) => n.text)).toEqual(['those aspects'])
    const thoseAspects = supplement.children[0]
    expect(thoseAspects.role).toBe('object')
    expect(thoseAspects.children).toEqual([{ text: 'that have changed since Collection 5', role: 'relativeClause', start: 71, children: [] }])
  })
})

/** Collects every node's role, recursively, across the whole forest — used below to assert
 * "no 'condition' label anywhere" (item 29 of Prototype 2.3M / item 55 of Prototype 2.3O)
 * without having to know exactly where in the tree a stray node might otherwise land. */
function allRoles(nodes: ReturnType<typeof buildHybridStructureTree>): string[] {
  return nodes.flatMap((n) => [n.role, ...allRoles(n.children)])
}

describe('buildHybridStructureTree — Prototype 2.3O item 55: Focused Relative-Link overrides a WRONG 2.3M fallback result (live diagnosis regression)', () => {
  const sentence = 'we describe the Collection 6 algorithm, emphasizing those aspects that have changed since Collection 5.'

  it('replaces a detached, truncated ("that" missing) sentenceModifier fallback with the Focused relation\'s exact span, and removes the stray "condition" label entirely', () => {
    const c = core('SVO', { subject: span('we', 0), verb: span('describe', 3), object: span('the Collection 6 algorithm', 12) })
    const h = hybrid({
      predicates: [
        predicate('describe', 3, 'main', [dependent('the Collection 6 algorithm', 12, 'object')]),
        predicate('emphasizing', 40, 'coordinated', [dependent('those aspects', 52, 'object')]),
      ],
      // The exact live-diagnosis failure mode: PredicateStructure grounds the relative
      // clause as its own detached, "that"-truncated sentenceModifier instead of nesting it
      // under "those aspects".
      sentenceModifiers: [{ text: 'have changed since Collection 5', start: 71, end: 103, role: 'condition' }],
    })
    const verifiedSupplementSpan = span('emphasizing those aspects that have changed since Collection 5', 40)
    const relation = groundRelativeLinkRelation(sentence, {
      antecedent: 'those aspects',
      relativeWord: 'that',
      relativeClause: 'that have changed since Collection 5',
    })!
    expect(relation).not.toBeNull()

    const tree = buildHybridStructureTree(c, h, verifiedSupplementSpan, [relation])

    // "condition" must not appear anywhere in the final tree.
    expect(allRoles(tree)).not.toContain('condition')

    const supplement = tree.find((n) => n.role === 'supplement')!
    const thoseAspects = supplement.children.find((n) => n.text === 'those aspects')!
    expect(thoseAspects.children).toEqual([
      { text: 'that have changed since Collection 5', role: 'relativeClause', start: 66, children: [], relationIndex: 0 },
    ])
    expect(thoseAspects.relationIndex).toBe(0)
    // "that" is never dropped (item 12/28).
    expect(thoseAspects.children[0].text.startsWith('that')).toBe(true)
  })
})

describe('buildHybridStructureTree — Prototype 2.3O item 56: multiple relations attach to distinct antecedents without crossing', () => {
  it('"The method that we used produced values that agreed with the observations." -- both relations land on the correct antecedent', () => {
    const sentence = 'The method that we used produced values that agreed with the observations.'
    const c = core('SVO', { subject: span('The method that we used', 0), verb: span('produced', 25), object: span('values', 33) })
    const h = hybrid({
      predicates: [predicate('produced', 25, 'main', [dependent('values', 33, 'object')])],
    })
    const relationA = groundRelativeLinkRelation(sentence, {
      antecedent: 'The method',
      relativeWord: 'that',
      relativeClause: 'that we used',
    })!
    const relationB = groundRelativeLinkRelation(sentence, {
      antecedent: 'values',
      relativeWord: 'that',
      relativeClause: 'that agreed with the observations',
    })!
    expect(relationA).not.toBeNull()
    expect(relationB).not.toBeNull()

    const tree = buildHybridStructureTree(c, h, null, [relationA, relationB])

    const subjectNode = tree.find((n) => n.role === 'subject')!
    expect(subjectNode.text).toBe('The method')
    const subjectRelative = subjectNode.children.find((n) => n.role === 'relativeClause')!
    expect(subjectRelative.text).toBe('that we used')
    expect(subjectRelative.relationIndex).toBe(0)
    expect(subjectNode.relationIndex).toBe(0)

    const producedNode = subjectNode.children.find((n) => n.text === 'produced')!
    const valuesNode = producedNode.children.find((n) => n.text === 'values')!
    expect(valuesNode.children).toEqual([
      { text: 'that agreed with the observations', role: 'relativeClause', start: 40, children: [], relationIndex: 1 },
    ])
    expect(valuesNode.relationIndex).toBe(1)

    // The two relations never cross: relation A's clause text never appears under `values`,
    // and relation B's clause text never appears under the subject.
    expect(valuesNode.children.some((n) => n.text === 'that we used')).toBe(false)
    expect(subjectNode.children.some((n) => n.role === 'relativeClause' && n.text.includes('observations'))).toBe(false)
  })
})

describe('buildHybridStructureTree — Prototype 2.3O item 58: relative link works independently of Focused Complement Verifier status (raw-SVO target)', () => {
  it('attaches the relative clause correctly even when verifiedSupplementSpan is null (verification never fired, item 30-34)', () => {
    const sentence = 'we describe the Collection 6 algorithm, emphasizing those aspects that have changed since Collection 5.'
    const c = core('SVO', { subject: span('we', 0), verb: span('describe', 3), object: span('the Collection 6 algorithm', 12) })
    const h = hybrid({
      predicates: [
        predicate('describe', 3, 'main', [dependent('the Collection 6 algorithm', 12, 'object')]),
        predicate('emphasizing', 40, 'coordinated', [dependent('those aspects', 52, 'object')]),
      ],
    })
    const relation = groundRelativeLinkRelation(sentence, {
      antecedent: 'those aspects',
      relativeWord: 'that',
      relativeClause: 'that have changed since Collection 5',
    })!

    // No verifiedSupplementSpan (null) -- relative-link attachment must not depend on it.
    const tree = buildHybridStructureTree(c, h, null, [relation])
    const subjectNode = tree.find((n) => n.role === 'subject')!
    const emphasizingNode = subjectNode.children.find((n) => n.text === 'emphasizing')!
    const thoseAspects = emphasizingNode.children.find((n) => n.text === 'those aspects')!
    expect(thoseAspects.children[0].text).toBe('that have changed since Collection 5')
    expect(thoseAspects.children[0].role).toBe('relativeClause')
  })
})

describe('buildHybridStructureTree — Prototype 2.3O item 59: coordination-box regression (Green Leaves untouched by an empty relations array)', () => {
  it('Green Leaves\' predicate coordination structure is identical whether relations is omitted or explicitly empty', () => {
    const c = core('SV', { subject: span('The green leaves', 0), verb: span('were available', 91) })
    const h = hybrid({
      predicates: [predicate('were available', 91, 'main', [dependent('locally', 106, 'modifier')])],
    })
    const withoutRelationsArg = buildHybridStructureTree(c, h)
    const withEmptyRelations = buildHybridStructureTree(c, h, null, [])
    expect(withEmptyRelations).toEqual(withoutRelationsArg)
  })
})

describe('applyFocusedRelativeLinks — item 44: a relation whose antecedent matches no tree node is left unapplied', () => {
  it('does not invent a new floating node when the antecedent cannot be located', () => {
    const tree = [{ text: 'we', role: 'subject' as const, start: 0, children: [] }]
    const orphanRelation = groundRelativeLinkRelation('we describe things that changed.', {
      antecedent: 'nonexistent phrase',
      relativeWord: 'that',
      relativeClause: 'that changed',
    })
    expect(orphanRelation).toBeNull() // not even groundable -- antecedent isn't a literal substring
    const result = applyFocusedRelativeLinks(tree, [])
    expect(result).toEqual(tree)
  })
})
