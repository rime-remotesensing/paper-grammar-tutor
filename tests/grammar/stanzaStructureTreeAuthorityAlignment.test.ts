import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StructureTreeView } from '../../src/features/grammar/components/StructureTreeView.tsx'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import { buildSentenceCoreSetFromStanzaTokens, type StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.6 -- Single-owner Tree Presentation.
 *
 * Root cause: the Tree layer's own constituent-span construction
 * (`buildDecomposedConstituentNode` in stanzaStructureTree.ts) grounds canonical-slot nodes
 * (subject/object/indirectObject/complement) via a bare `collectConstituentTokens` +
 * contiguous min/max `spanFromTokens` slice -- the exact "sparse selected tokens ->
 * contiguous span -> excluded material reinserted" bug class 2.6G2.5C/C2 already fixed for
 * CANONICAL authority grounding (`stanzaSyntaxAuthority.ts`'s `groundConstituentSpan`), just
 * never ported to the Tree's own SEPARATE implementation. Two live-diagnosed symptoms:
 *
 * 1. A copular complement's own root-token head also carries a sentence-opening `obl`
 *    adjunct (or, for a coordinated predicate, the connector+copula of a PRECEDING
 *    coordinate member) as a direct child -- the Tree's complement node silently widened to
 *    include it, CONTRADICTING the already-correct canonical SentenceCoreSet complement
 *    (authority drift).
 * 2. A subject's own head can carry a token spuriously `conj`-attached PAST an excluded
 *    non-restrictive relative clause (a Stanza UD coordination-attachment-drift artifact,
 *    diagnosed live in `d34-long-80`) -- the Tree's own coordination-decomposition logic
 *    (unaware the chain member was never really coordinate with the subject) built it as a
 *    WRONG sibling coordination member, both widening the subject's own authority text past
 *    canonical AND presenting drift-attached content under the wrong owner.
 *
 * Fix (both Tree-layer-local, mirroring but NOT importing the authority-layer fix, since this
 * phase is scoped to Tree-presentation files only): a locally-duplicated
 * `contiguousIslandContaining` restricts every canonical-slot node's own token selection to
 * the contiguous island containing its head; the coordination-chain-detection block filters
 * chain members against that same island-restricted set, so a drifted member is silently
 * dropped from the coordination decomposition instead of becoming a wrong sibling (any
 * enumeration content it belongs to is still found and shown via the existing, unrelated
 * dependency-based enumeration-recovery mechanism, just nested under its actual raw-graph
 * parent rather than masquerading as coordinate with it).
 *
 * Synthetic fixtures reproducing the same STRUCTURAL SHAPES as the live-diagnosed KNN-GCN and
 * d15/d34 corpus cases, different wording -- no literal live-PDF/dataset sentence committed.
 */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

function offsets(text: string, words: string[]): Record<string, { start: number; end: number }> {
  let cursor = 0
  const pos: Record<string, { start: number; end: number }> = {}
  for (const w of words) {
    const start = text.indexOf(w, cursor)
    if (start === -1) throw new Error(`word "${w}" not found starting at ${cursor}`)
    pos[w] = { start, end: start + w.length }
    cursor = start + w.length
  }
  return pos
}

describe('Prototype 2.6G2.6 item 1 -- Tree complement never contradicts (widens past) canonical C', () => {
  it('opening modifier + copular complement: Tree complement matches canonical exactly (the KNN-GCN shape)', () => {
    const text = 'In this study, the model is a robust approach for LSM.'
    const words = ['In', 'this', 'study', 'the', 'model', 'is', 'a', 'robust', 'approach', 'for', 'LSM']
    const pos = offsets(text, words)
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'In', upos: 'ADP', head: 3, deprel: 'case', ...pos['In']! }),
      tok({ id: 2, text: 'this', upos: 'DET', head: 3, deprel: 'det', ...pos['this']! }),
      tok({ id: 3, text: 'study', upos: 'NOUN', head: 9, deprel: 'obl', ...pos['study']! }),
      tok({ id: 4, text: 'the', upos: 'DET', head: 5, deprel: 'det', ...pos['the']! }),
      tok({ id: 5, text: 'model', upos: 'NOUN', head: 9, deprel: 'nsubj', ...pos['model']! }),
      tok({ id: 6, text: 'is', upos: 'AUX', head: 9, deprel: 'cop', ...pos['is']! }),
      tok({ id: 7, text: 'a', upos: 'DET', head: 9, deprel: 'det', ...pos['a']! }),
      tok({ id: 8, text: 'robust', upos: 'ADJ', head: 9, deprel: 'amod', ...pos['robust']! }),
      tok({ id: 9, text: 'approach', upos: 'NOUN', head: 0, deprel: 'root', ...pos['approach']! }),
      tok({ id: 10, text: 'for', upos: 'ADP', head: 11, deprel: 'case', ...pos['for']! }),
      tok({ id: 11, text: 'LSM', upos: 'PROPN', head: 9, deprel: 'nmod', ...pos['LSM']! }),
      tok({ id: 12, text: '.', upos: 'PUNCT', head: 9, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const treeComplement = flatten(tree).find((n) => n.role === 'complement')!
    expect(treeComplement).toBeDefined()
    expect(treeComplement.text).toBe(coreSet.predicateCores[0]!.complement!.text)
    expect(treeComplement.start).toBe(coreSet.predicateCores[0]!.complement!.start)
    expect(treeComplement.end).toBe(coreSet.predicateCores[0]!.complement!.end)
    expect(treeComplement.text).toBe('a robust approach for LSM')
    expect(treeComplement.text).not.toContain('study')
    expect(treeComplement.text).not.toContain('model')
    expect(treeComplement.text).not.toContain('is')
  })

  it('coordinated copular predicates: the second complement never absorbs the connector+copula (the d15 shape)', () => {
    const text = 'The surface is stable and is durable.'
    const words = ['The', 'surface', 'is', 'stable', 'and', 'durable']
    const pos = offsets(text, words)
    const isPositions = [...text.matchAll(/\bis\b/g)].map((m) => ({ start: m.index!, end: m.index! + 2 }))
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pos['The']! }),
      tok({ id: 2, text: 'surface', upos: 'NOUN', head: 4, deprel: 'nsubj', ...pos['surface']! }),
      tok({ id: 3, text: 'is', upos: 'AUX', head: 4, deprel: 'cop', ...isPositions[0]! }),
      tok({ id: 4, text: 'stable', upos: 'ADJ', head: 0, deprel: 'root', ...pos['stable']! }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 7, deprel: 'cc', ...pos['and']! }),
      tok({ id: 6, text: 'is', upos: 'AUX', head: 7, deprel: 'cop', ...isPositions[1]! }),
      tok({ id: 7, text: 'durable', upos: 'ADJ', head: 4, deprel: 'conj', ...pos['durable']! }),
      tok({ id: 8, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const complements = flatten(tree).filter((n) => n.role === 'complement')
    expect(complements).toHaveLength(2)
    expect(complements[0]!.text).toBe(coreSet.predicateCores[0]!.complement!.text)
    expect(complements[1]!.text).toBe(coreSet.predicateCores[1]!.complement!.text)
    expect(complements[1]!.text).toBe('durable')
    expect(complements[1]!.text).not.toContain('and')
    expect(complements[1]!.text).not.toContain('is')

    const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes: tree, sentence: text, structuredSyntax: true }))
    expect(countOccurrences(html, '>and<')).toBe(1)
  })
})

describe('Prototype 2.6G2.6 item 2 -- Tree subject never contradicts canonical S, and a drift-attached token never becomes a wrong sibling', () => {
  it('a token spuriously conj-attached past an excluded non-restrictive relative clause is dropped from subject coordination, not shown as a wrong sibling (the d34 shape)', () => {
    // "morphology" and "transitions" form a genuine 2-item drift enumeration (matching the
    // real d34-long-80 shape exactly: an enumeration item belonging to the excluded relative
    // clause's own object spuriously attaches its `conj` chain directly to the subject head)
    // -- a LONE stray item would legitimately stay excluded as an ordinary appositive (no
    // different from "a lone appositive stays excluded" elsewhere in this codebase), so two
    // items are needed to exercise the actual enumeration-recovery mechanism this test checks.
    const text = 'The framework, which integrates estimates, morphology, transitions, performs well.'
    const words = ['The', 'framework', 'which', 'integrates', 'estimates', 'morphology', 'transitions', 'performs', 'well']
    const pos = offsets(text, words)
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pos['The']! }),
      tok({ id: 2, text: 'framework', upos: 'NOUN', head: 12, deprel: 'nsubj', ...pos['framework']! }),
      tok({ id: 3, text: ',', upos: 'PUNCT', head: 4, deprel: 'punct', start: pos['framework']!.end, end: pos['framework']!.end + 1 }),
      tok({ id: 4, text: 'which', upos: 'PRON', head: 5, deprel: 'nsubj', ...pos['which']! }),
      tok({ id: 5, text: 'integrates', upos: 'VERB', head: 2, deprel: 'acl:relcl', ...pos['integrates']! }),
      tok({ id: 6, text: 'estimates', upos: 'NOUN', head: 5, deprel: 'obj', ...pos['estimates']! }),
      tok({ id: 7, text: ',', upos: 'PUNCT', head: 8, deprel: 'punct', start: pos['estimates']!.end, end: pos['estimates']!.end + 1 }),
      // Spurious drift: "morphology"/"transitions" attach to the SUBJECT head (2), not to
      // "estimates" (6) -- the same UD coordination-attachment-drift class as d34.
      tok({ id: 8, text: 'morphology', upos: 'NOUN', head: 2, deprel: 'conj', ...pos['morphology']! }),
      tok({ id: 9, text: ',', upos: 'PUNCT', head: 10, deprel: 'punct', start: pos['morphology']!.end, end: pos['morphology']!.end + 1 }),
      tok({ id: 10, text: 'transitions', upos: 'NOUN', head: 8, deprel: 'conj', ...pos['transitions']! }),
      tok({ id: 11, text: ',', upos: 'PUNCT', head: 2, deprel: 'punct', start: pos['transitions']!.end, end: pos['transitions']!.end + 1 }),
      tok({ id: 12, text: 'performs', upos: 'VERB', head: 0, deprel: 'root', ...pos['performs']! }),
      tok({ id: 13, text: 'well', upos: 'ADV', head: 12, deprel: 'advmod', ...pos['well']! }),
      tok({ id: 14, text: '.', upos: 'PUNCT', head: 12, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    const subjectNodes = flat.filter((n) => n.role === 'subject')

    // Single owner: exactly one subject node, matching canonical exactly -- no second
    // "morphology" subject-coordination-member sibling.
    expect(subjectNodes).toHaveLength(1)
    expect(subjectNodes[0]!.text).toBe(coreSet.subject!.text)
    expect(subjectNodes[0]!.text).toBe('The framework')
    expect(subjectNodes[0]!.text).not.toContain('morphology')

    // "morphology" is never silently lost -- the pre-existing, unrelated dependency-based
    // enumeration-recovery mechanism still finds and shows it (nested under its actual
    // raw-graph parent, as an 'enumeration' wrapper + its own leaf items), just never as a
    // wrong subject-coordination sibling. It is never a *second* independent owner: it
    // appears once as the enumeration's own leaf item (the 'enumeration' wrapper node's own
    // combined text naturally also contains the substring, matching the same established
    // wrapper+leaf pattern used everywhere else in this codebase -- not a visible duplicate,
    // since StructureTreeView splices an enumeration's children into place and never renders
    // the wrapper's own text row).
    const morphologyLeaf = flat.filter((n) => n.role === 'enumerationMember' && n.text === 'morphology')
    expect(morphologyLeaf).toHaveLength(1)
    expect(flat.filter((n) => n.role === 'subject' && n.text.includes('morphology'))).toHaveLength(0)
  })
})

describe('Prototype 2.6G2.6 item 3 -- rendered single-owner / no-duplication / connector-once gates', () => {
  it('the combined opener + copular-complement + relative-clause shape renders every node exactly once, with correct pedagogical ordering', () => {
    const text = 'In this study, the model is a robust approach, which works well.'
    const words = ['In', 'this', 'study', 'the', 'model', 'is', 'a', 'robust', 'approach', 'which', 'works', 'well']
    const pos = offsets(text, words)
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'In', upos: 'ADP', head: 3, deprel: 'case', ...pos['In']! }),
      tok({ id: 2, text: 'this', upos: 'DET', head: 3, deprel: 'det', ...pos['this']! }),
      tok({ id: 3, text: 'study', upos: 'NOUN', head: 9, deprel: 'obl', ...pos['study']! }),
      tok({ id: 4, text: 'the', upos: 'DET', head: 5, deprel: 'det', ...pos['the']! }),
      tok({ id: 5, text: 'model', upos: 'NOUN', head: 9, deprel: 'nsubj', ...pos['model']! }),
      tok({ id: 6, text: 'is', upos: 'AUX', head: 9, deprel: 'cop', ...pos['is']! }),
      tok({ id: 7, text: 'a', upos: 'DET', head: 9, deprel: 'det', ...pos['a']! }),
      tok({ id: 8, text: 'robust', upos: 'ADJ', head: 9, deprel: 'amod', ...pos['robust']! }),
      tok({ id: 9, text: 'approach', upos: 'NOUN', head: 0, deprel: 'root', ...pos['approach']! }),
      tok({ id: 10, text: 'which', upos: 'PRON', head: 11, deprel: 'nsubj', ...pos['which']! }),
      tok({ id: 11, text: 'works', upos: 'VERB', head: 9, deprel: 'acl:relcl', ...pos['works']! }),
      tok({ id: 12, text: 'well', upos: 'ADV', head: 11, deprel: 'advmod', ...pos['well']! }),
      tok({ id: 13, text: '.', upos: 'PUNCT', head: 9, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)

    // Single-owner: no visible duplicate (same role+span+text) anywhere in the tree.
    const keys = flat.map((n) => `${n.role}:${n.start}:${n.end}:${n.text}`)
    expect(new Set(keys).size).toBe(keys.length)

    // Ownership: the relative clause is captured exactly once, as a child of the complement
    // it modifies -- never duplicated, never promoted to the top level.
    const relativeClauses = flat.filter((n) => n.role === 'relativeClause')
    expect(relativeClauses).toHaveLength(1)
    expect(relativeClauses[0]!.text).toBe('which works well')

    // Ordering: opening modifier, then subject, then (nested) predicate, then complement,
    // then the complement's own postmodifying relative clause -- a natural pedagogical
    // top-to-bottom / outer-to-inner reading order.
    const opening = tree.find((n) => n.role === 'openingModifier')!
    const subject = tree.find((n) => n.role === 'subject')!
    expect(opening).toBeDefined()
    expect(subject).toBeDefined()
    expect(opening.start).toBeLessThan(subject.start)
    const predicate = subject.children.find((n) => n.role === 'predicate')!
    expect(predicate).toBeDefined()
    expect(predicate.start).toBeGreaterThan(subject.start)
    const complement = predicate.children.find((n) => n.role === 'complement')!
    expect(complement).toBeDefined()
    expect(complement.start).toBeGreaterThan(predicate.start)
    expect(complement.children[0]!.role).toBe('relativeClause')
  })
})
