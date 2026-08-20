import { describe, expect, it } from 'vitest'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'

/**
 * Prototype 2.6G2.6C3 (Conservative Relative Scope + Coordinated-Predicate Clause Scope
 * Presentation) Part B -- COORDINATED_PREDICATE_SHARED_TRAILING_MODIFIER. Controls A-E from
 * section 17. Fixtures A/B/E are hand-transcribed from real Stanza parses (see phase
 * diagnostic); C reuses the already-verified "designed and applied for Z" `obl` pattern; D is
 * a hand-built structural equivalent proving the CASE A code path treats a non-anchor-attached
 * `advcl` the same general way it already treats a non-anchor `obl` (Stanza's own real parses
 * for 2-predicate coordinations consistently anchor a subjectless advcl to the FIRST/anchor
 * predicate -- this fixture exercises the "attaches to predicate 2" code path directly, since
 * that shape did not occur naturally in the live diagnostic sentences tried).
 */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

describe('Prototype 2.6G2.6C3 Part B -- coordinated-predicate shared trailing modifier (controls A-E)', () => {
  it('(A) "The samples were collected and analyzed using standard protocols." -- ambiguous anchor-attached advcl -> group scope, never orphaned', () => {
    const text = 'The samples were collected and analyzed using standard protocols.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'samples', upos: 'NOUN', head: 4, deprel: 'nsubj:pass', start: 4, end: 11 }),
      tok({ id: 3, text: 'were', upos: 'AUX', head: 4, deprel: 'aux:pass', start: 12, end: 16 }),
      tok({ id: 4, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', start: 17, end: 26 }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 6, deprel: 'cc', start: 27, end: 30 }),
      tok({ id: 6, text: 'analyzed', upos: 'VERB', head: 4, deprel: 'conj', start: 31, end: 39 }),
      tok({ id: 7, text: 'using', upos: 'VERB', head: 4, deprel: 'advcl', start: 40, end: 45 }),
      tok({ id: 8, text: 'standard', upos: 'ADJ', head: 9, deprel: 'amod', start: 46, end: 54 }),
      tok({ id: 9, text: 'protocols', upos: 'NOUN', head: 7, deprel: 'obj', start: 55, end: 64 }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', start: 64, end: 65 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    // Not orphaned: the whole tree is a SINGLE top-level structure (the subject), never two.
    expect(tree).toHaveLength(1)
    const subject = tree[0]!
    expect(subject.role).toBe('subject')
    // "using standard protocols" is a sibling of the coordinated predicates, not nested under
    // either one specifically, and never claims the canonical 'predicate' role (which would
    // collide with the sibling-level coordination-group detection for "collected"/"analyzed").
    const usingNode = subject.children.find((c) => c.text.startsWith('using'))!
    expect(usingNode).toBeDefined()
    expect(usingNode.role).toBe('modifier')
    expect(usingNode.text).toBe('using standard protocols')
    // Reading order preserved: predicates first, modifier last.
    const order = subject.children.map((c) => c.role)
    expect(order.indexOf('predicate')).toBeLessThan(order.indexOf('modifier'))
    expect(order.indexOf('coordinatedPredicate')).toBeLessThan(order.indexOf('modifier'))
    // The "and" connector between the two genuine predicates is still rendered exactly once
    // (this is the exact regression this fix must not introduce -- see the phase's own
    // diagnostic of a `groupingKey` collision).
    const coordinated = subject.children.find((c) => c.role === 'coordinatedPredicate')!
    expect(coordinated.connector?.text).toBe('and')
  })

  it('(B) "The model was trained and evaluated while running on the cluster." -- anchor-attached subordinate -> group scope', () => {
    const text = 'The model was trained and evaluated while running on the cluster.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'model', upos: 'NOUN', head: 4, deprel: 'nsubj:pass', start: 4, end: 9 }),
      tok({ id: 3, text: 'was', upos: 'AUX', head: 4, deprel: 'aux:pass', start: 10, end: 13 }),
      tok({ id: 4, text: 'trained', upos: 'VERB', head: 0, deprel: 'root', start: 14, end: 21 }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 6, deprel: 'cc', start: 22, end: 25 }),
      tok({ id: 6, text: 'evaluated', upos: 'VERB', head: 4, deprel: 'conj', start: 26, end: 35 }),
      tok({ id: 7, text: 'while', upos: 'SCONJ', head: 8, deprel: 'mark', start: 36, end: 41 }),
      tok({ id: 8, text: 'running', upos: 'VERB', head: 4, deprel: 'advcl', start: 42, end: 49 }),
      tok({ id: 9, text: 'on', upos: 'ADP', head: 11, deprel: 'case', start: 50, end: 52 }),
      tok({ id: 10, text: 'the', upos: 'DET', head: 11, deprel: 'det', start: 53, end: 56 }),
      tok({ id: 11, text: 'cluster', upos: 'NOUN', head: 8, deprel: 'obl', start: 57, end: 64 }),
      tok({ id: 12, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', start: 64, end: 65 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    expect(tree).toHaveLength(1)
    const subject = tree[0]!
    const modifierNode = subject.children.find((c) => c.role === 'modifier' && c.text.includes('running'))
    expect(modifierNode).toBeDefined()
    expect(modifierNode!.text).toBe('while running on the cluster')
    // "while" itself is subsumed as the modifier's own leading text here (no separate
    // marker-wrapper is fabricated for a bare group-scope modifier).
    const coordinated = subject.children.find((c) => c.role === 'coordinatedPredicate')!
    expect(coordinated.connector?.text).toBe('and')
  })

  it('(C) "Most of these techniques are merely designed and applied for single modalities." -- non-anchor `obl` PP regression: stays attached to the SPECIFIC predicate, never promoted to group scope', () => {
    const text = 'Most of these techniques are merely designed and applied for single modalities.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Most', upos: 'PRON', head: 7, deprel: 'nsubj:pass', start: 0, end: 4 }),
      tok({ id: 2, text: 'of', upos: 'ADP', head: 4, deprel: 'case', start: 5, end: 7 }),
      tok({ id: 3, text: 'these', upos: 'DET', head: 4, deprel: 'det', start: 8, end: 13 }),
      tok({ id: 4, text: 'techniques', upos: 'NOUN', head: 1, deprel: 'nmod', start: 14, end: 24 }),
      tok({ id: 5, text: 'are', upos: 'AUX', head: 7, deprel: 'aux:pass', start: 25, end: 28 }),
      tok({ id: 6, text: 'merely', upos: 'ADV', head: 7, deprel: 'advmod', start: 29, end: 35 }),
      tok({ id: 7, text: 'designed', upos: 'VERB', head: 0, deprel: 'root', start: 36, end: 44 }),
      tok({ id: 8, text: 'and', upos: 'CCONJ', head: 9, deprel: 'cc', start: 45, end: 48 }),
      tok({ id: 9, text: 'applied', upos: 'VERB', head: 7, deprel: 'conj', start: 49, end: 56 }),
      tok({ id: 10, text: 'for', upos: 'ADP', head: 12, deprel: 'case', start: 57, end: 60 }),
      tok({ id: 11, text: 'single', upos: 'ADJ', head: 12, deprel: 'amod', start: 61, end: 67 }),
      tok({ id: 12, text: 'modalities', upos: 'NOUN', head: 9, deprel: 'obl', start: 68, end: 78 }),
      tok({ id: 13, text: '.', upos: 'PUNCT', head: 7, deprel: 'punct', start: 78, end: 79 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    expect(tree).toHaveLength(1)
    const subject = tree[0]!
    const designedNode = subject.children.find((c) => c.role === 'predicate')!
    const appliedNode = subject.children.find((c) => c.role === 'coordinatedPredicate')!
    expect(designedNode.children.some((c) => c.text.includes('modalities'))).toBe(false)
    expect(appliedNode.children.some((c) => c.role === 'modifier' && c.text === 'for single modalities')).toBe(true)
  })

  it('(D) predicate1 and predicate2 + subordinate attached clearly to predicate2 -> nested under that specific predicate (structural equivalent, proving the CASE A path generalizes advcl the same way as obl)', () => {
    const text = 'The team collected the samples and analyzed the results using automated software.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 18 }),
      tok({ id: 4, text: 'the', upos: 'DET', head: 5, deprel: 'det', start: 19, end: 22 }),
      tok({ id: 5, text: 'samples', upos: 'NOUN', head: 3, deprel: 'obj', start: 23, end: 30 }),
      tok({ id: 6, text: 'and', upos: 'CCONJ', head: 7, deprel: 'cc', start: 31, end: 34 }),
      tok({ id: 7, text: 'analyzed', upos: 'VERB', head: 3, deprel: 'conj', start: 35, end: 43 }),
      tok({ id: 8, text: 'the', upos: 'DET', head: 9, deprel: 'det', start: 44, end: 47 }),
      tok({ id: 9, text: 'results', upos: 'NOUN', head: 7, deprel: 'obj', start: 48, end: 55 }),
      // "using automated software" raw-attaches to "analyzed" (id 7, predicateHeadIds[1], the
      // NON-anchor predicate) -- structurally identical positive evidence to the already-
      // correct `obl` case (C above), just via `advcl` instead.
      tok({ id: 10, text: 'using', upos: 'VERB', head: 7, deprel: 'advcl', start: 56, end: 61 }),
      tok({ id: 11, text: 'automated', upos: 'ADJ', head: 12, deprel: 'amod', start: 62, end: 71 }),
      tok({ id: 12, text: 'software', upos: 'NOUN', head: 10, deprel: 'obj', start: 72, end: 80 }),
      tok({ id: 13, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 80, end: 81 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    expect(tree).toHaveLength(1)
    const subject = tree[0]!
    const collectedNode = subject.children.find((c) => c.role === 'predicate')!
    const analyzedNode = subject.children.find((c) => c.role === 'coordinatedPredicate')!
    // Never attached to the anchor predicate, never left as a bare group-scope sibling of the
    // subject -- specifically nested under "analyzed", the predicate it actually modifies.
    expect(collectedNode.children.some((c) => c.text.startsWith('using'))).toBe(false)
    expect(subject.children.some((c) => c.role === 'modifier' && c.text.startsWith('using'))).toBe(false)
    expect(analyzedNode.children.some((c) => c.role === 'modifier' && c.text === 'using automated software')).toBe(true)
  })

  it('(E) single predicate + advcl -- subjectless modifier nests under the sole predicate (Prototype 2.6G2.8: CASE C previously fell through unhandled, live-diagnosed as the general "using X" top-level-promotion defect; a subjectless subordinate clause attaching directly to a clause with only one predicate is now unambiguously nested there instead of promoted to an independent sibling)', () => {
    const text = 'The model was trained using standard protocols.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'model', upos: 'NOUN', head: 4, deprel: 'nsubj:pass', start: 4, end: 9 }),
      tok({ id: 3, text: 'was', upos: 'AUX', head: 4, deprel: 'aux:pass', start: 10, end: 13 }),
      tok({ id: 4, text: 'trained', upos: 'VERB', head: 0, deprel: 'root', start: 14, end: 21 }),
      tok({ id: 5, text: 'using', upos: 'VERB', head: 4, deprel: 'advcl', start: 22, end: 27 }),
      tok({ id: 6, text: 'standard', upos: 'ADJ', head: 7, deprel: 'amod', start: 28, end: 36 }),
      tok({ id: 7, text: 'protocols', upos: 'NOUN', head: 5, deprel: 'obj', start: 37, end: 46 }),
      tok({ id: 8, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', start: 46, end: 47 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    // Single top-level structure -- never orphaned as an independent sibling.
    expect(tree).toHaveLength(1)
    const subject = tree[0]!
    expect(subject.role).toBe('subject')
    const predicate = subject.children.find((c) => c.role === 'predicate')!
    expect(predicate).toBeDefined()
    const usingNode = predicate.children.find((c) => c.role === 'modifier' && c.text.startsWith('using'))
    expect(usingNode).toBeDefined()
    expect(usingNode!.text).toBe('using standard protocols')
  })
})
