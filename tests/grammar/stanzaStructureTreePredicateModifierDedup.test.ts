import { describe, expect, it } from 'vitest'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.6C4 Part B -- PREDICATE_INTERNAL_MODIFIER_VISIBLE_DUPLICATION. Controls A-I
 * from section 17.
 */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

describe('Prototype 2.6G2.6C4 Part B -- predicate-internal modifier de-duplication', () => {
  it('(A) auxiliary + adverb + participle: "The factors were initially selected as inputs for the model." -- no duplicate "initially"', () => {
    const text = 'The factors were initially selected as inputs for the model.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'factors', upos: 'NOUN', head: 5, deprel: 'nsubj:pass', start: 4, end: 11 }),
      tok({ id: 3, text: 'were', upos: 'AUX', head: 5, deprel: 'aux:pass', start: 12, end: 16 }),
      tok({ id: 4, text: 'initially', upos: 'ADV', head: 5, deprel: 'advmod', start: 17, end: 26 }),
      tok({ id: 5, text: 'selected', upos: 'VERB', head: 0, deprel: 'root', start: 27, end: 35 }),
      tok({ id: 6, text: 'as', upos: 'ADP', head: 7, deprel: 'case', start: 36, end: 38 }),
      tok({ id: 7, text: 'inputs', upos: 'NOUN', head: 5, deprel: 'obl', start: 39, end: 45 }),
      tok({ id: 8, text: 'for', upos: 'ADP', head: 10, deprel: 'case', start: 46, end: 49 }),
      tok({ id: 9, text: 'the', upos: 'DET', head: 10, deprel: 'det', start: 50, end: 53 }),
      tok({ id: 10, text: 'model', upos: 'NOUN', head: 7, deprel: 'nmod', start: 54, end: 59 }),
      tok({ id: 11, text: '.', upos: 'PUNCT', head: 5, deprel: 'punct', start: 59, end: 60 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    const predicate = flat.find((n) => n.role === 'predicate')!
    expect(predicate.text).toBe('were initially selected') // canonical V authority unchanged
    expect(flat.filter((n) => n.text === 'initially')).toHaveLength(0) // never a separate child
    expect(predicate.children.some((c) => c.text === 'as inputs for the model')).toBe(true) // trailing PP unaffected
  })

  it('(B) copula + adverb + adjective: "Most of these techniques are merely designed." -- no duplicate "merely"', () => {
    const text = 'Most of these techniques are merely designed.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Most', upos: 'PRON', head: 6, deprel: 'nsubj:pass', start: 0, end: 4 }),
      tok({ id: 2, text: 'of', upos: 'ADP', head: 4, deprel: 'case', start: 5, end: 7 }),
      tok({ id: 3, text: 'these', upos: 'DET', head: 4, deprel: 'det', start: 8, end: 13 }),
      tok({ id: 4, text: 'techniques', upos: 'NOUN', head: 1, deprel: 'nmod', start: 14, end: 24 }),
      tok({ id: 5, text: 'are', upos: 'AUX', head: 7, deprel: 'aux:pass', start: 25, end: 28 }),
      tok({ id: 6, text: 'merely', upos: 'ADV', head: 7, deprel: 'advmod', start: 29, end: 35 }),
      tok({ id: 7, text: 'designed', upos: 'VERB', head: 0, deprel: 'root', start: 36, end: 44 }),
      tok({ id: 8, text: '.', upos: 'PUNCT', head: 7, deprel: 'punct', start: 44, end: 45 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    const predicate = flat.find((n) => n.role === 'predicate')!
    expect(predicate.text).toBe('are merely designed')
    expect(flat.filter((n) => n.text === 'merely')).toHaveLength(0)
    expect(predicate.children).toHaveLength(0)
  })

  it('(C) simple verb + adverb: "The model performs consistently." -- no duplicate "consistently"', () => {
    const text = 'The model performs consistently.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'model', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 9 }),
      tok({ id: 3, text: 'performs', upos: 'VERB', head: 0, deprel: 'root', start: 10, end: 18 }),
      tok({ id: 4, text: 'consistently', upos: 'ADV', head: 3, deprel: 'advmod', start: 19, end: 31 }),
      tok({ id: 5, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 31, end: 32 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    const predicate = flat.find((n) => n.role === 'predicate')!
    // A trailing (post-verb) advmod on a simple non-passive verb is never absorbed into
    // canonical V authority in the first place -- it was never duplicated, only ever a
    // single ordinary modifier child, exactly once.
    expect(predicate.text).toBe('performs')
    expect(flat.filter((n) => n.text === 'consistently')).toHaveLength(1)
  })

  it('(D) multiple adverbial modifiers, one inside V authority and one trailing outside it -- only the inside one is de-duplicated', () => {
    const text = 'The samples were carefully collected yesterday for this study.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'samples', upos: 'NOUN', head: 4, deprel: 'nsubj:pass', start: 4, end: 11 }),
      tok({ id: 3, text: 'were', upos: 'AUX', head: 5, deprel: 'aux:pass', start: 12, end: 16 }),
      tok({ id: 4, text: 'carefully', upos: 'ADV', head: 5, deprel: 'advmod', start: 17, end: 26 }),
      tok({ id: 5, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', start: 27, end: 36 }),
      tok({ id: 6, text: 'yesterday', upos: 'ADV', head: 5, deprel: 'advmod', start: 37, end: 46 }),
      tok({ id: 7, text: 'for', upos: 'ADP', head: 9, deprel: 'case', start: 47, end: 50 }),
      tok({ id: 8, text: 'this', upos: 'DET', head: 9, deprel: 'det', start: 51, end: 55 }),
      tok({ id: 9, text: 'study', upos: 'NOUN', head: 5, deprel: 'obl', start: 56, end: 61 }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 5, deprel: 'punct', start: 61, end: 62 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    const predicate = flat.find((n) => n.role === 'predicate')!
    expect(predicate.text).toBe('were carefully collected') // canonical V includes "carefully" only
    expect(flat.filter((n) => n.text === 'carefully')).toHaveLength(0) // de-duplicated (inside V span)
    expect(flat.filter((n) => n.text === 'yesterday')).toHaveLength(1) // kept (outside V span, never duplicated)
  })

  it('(E) modifier outside canonical V authority is completely unaffected (regression: trailing PP still renders exactly once)', () => {
    const text = 'The model performs well on the benchmark dataset.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'model', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 9 }),
      tok({ id: 3, text: 'performs', upos: 'VERB', head: 0, deprel: 'root', start: 10, end: 18 }),
      tok({ id: 4, text: 'well', upos: 'ADV', head: 3, deprel: 'advmod', start: 19, end: 23 }),
      tok({ id: 5, text: 'on', upos: 'ADP', head: 8, deprel: 'case', start: 24, end: 26 }),
      tok({ id: 6, text: 'the', upos: 'DET', head: 8, deprel: 'det', start: 27, end: 30 }),
      tok({ id: 7, text: 'benchmark', upos: 'NOUN', head: 8, deprel: 'compound', start: 31, end: 40 }),
      tok({ id: 8, text: 'dataset', upos: 'NOUN', head: 3, deprel: 'obl', start: 41, end: 48 }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 48, end: 49 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    expect(flat.filter((n) => n.text === 'on the benchmark dataset')).toHaveLength(1)
  })

  it('(F)/(G) coordinated predicates: local modifier belonging to predicate 1 and predicate 2 respectively -- neither duplicated, connector preserved', () => {
    const text = 'The samples were initially collected and carefully analyzed.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'samples', upos: 'NOUN', head: 5, deprel: 'nsubj:pass', start: 4, end: 11 }),
      tok({ id: 3, text: 'were', upos: 'AUX', head: 5, deprel: 'aux:pass', start: 12, end: 16 }),
      tok({ id: 4, text: 'initially', upos: 'ADV', head: 5, deprel: 'advmod', start: 17, end: 26 }),
      tok({ id: 5, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', start: 27, end: 36 }),
      tok({ id: 6, text: 'and', upos: 'CCONJ', head: 8, deprel: 'cc', start: 37, end: 40 }),
      tok({ id: 7, text: 'carefully', upos: 'ADV', head: 8, deprel: 'advmod', start: 41, end: 50 }),
      tok({ id: 8, text: 'analyzed', upos: 'VERB', head: 5, deprel: 'conj', start: 51, end: 59 }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 5, deprel: 'punct', start: 59, end: 60 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    const predicate1 = flat.find((n) => n.role === 'predicate')!
    const predicate2 = flat.find((n) => n.role === 'coordinatedPredicate')!
    expect(predicate1.text).toBe('were initially collected')
    // "carefully" (a coordinated-predicate-internal advmod) is never absorbed into
    // canonical V authority for the second conjunct here -- it was never duplicated, only
    // ever a single ordinary modifier child, exactly once.
    expect(predicate2.text).toBe('analyzed')
    expect(flat.filter((n) => n.text === 'initially')).toHaveLength(0)
    expect(flat.filter((n) => n.text === 'carefully')).toHaveLength(1)
    expect(predicate2.connector?.text).toBe('and')
  })

  it('(H) group-level coordinated-predicate modifier (2.6G2.6C3 group scope) is unaffected by this fix -- rendered exactly once as the group-scope modifier, never duplicated', () => {
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
    const flat = flatten(tree)
    expect(flat.filter((n) => n.text === 'using standard protocols')).toHaveLength(1)
    expect(flat.filter((n) => n.role === 'coordinatedPredicate')[0]!.connector?.text).toBe('and')
  })

  it('(I) sentence-opening adverb is never mistaken for a predicate-internal modifier -- stays a distinct openingModifier, still visible exactly once', () => {
    const text = 'Initially, the factors were selected for the model.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Initially', upos: 'ADV', head: 6, deprel: 'advmod', start: 0, end: 9 }),
      tok({ id: 2, text: ',', upos: 'PUNCT', head: 6, deprel: 'punct', start: 9, end: 10 }),
      tok({ id: 3, text: 'the', upos: 'DET', head: 4, deprel: 'det', start: 11, end: 14 }),
      tok({ id: 4, text: 'factors', upos: 'NOUN', head: 6, deprel: 'nsubj:pass', start: 15, end: 22 }),
      tok({ id: 5, text: 'were', upos: 'AUX', head: 6, deprel: 'aux:pass', start: 23, end: 27 }),
      tok({ id: 6, text: 'selected', upos: 'VERB', head: 0, deprel: 'root', start: 28, end: 36 }),
      tok({ id: 7, text: 'for', upos: 'ADP', head: 9, deprel: 'case', start: 37, end: 40 }),
      tok({ id: 8, text: 'the', upos: 'DET', head: 9, deprel: 'det', start: 41, end: 44 }),
      tok({ id: 9, text: 'model', upos: 'NOUN', head: 6, deprel: 'obl', start: 45, end: 50 }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 6, deprel: 'punct', start: 50, end: 51 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    const predicate = flat.find((n) => n.role === 'predicate')!
    expect(predicate.text).toBe('were selected') // canonical V never absorbs the preposed opener
    expect(flat.filter((n) => n.text === 'Initially')).toHaveLength(1) // visible exactly once
    expect(flat.some((n) => n.role === 'openingModifier' && n.text === 'Initially')).toBe(true)
  })
})
