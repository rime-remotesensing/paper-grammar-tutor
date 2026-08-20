import { describe, expect, it } from 'vitest'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.6C4 Part A -- COLON_INTRODUCED_UNNUMBERED_ENUMERATION. Fixtures are
 * hand-transcribed from real Stanza parses (see phase diagnostic) -- this construction is
 * necessary because the underlying bug is specifically a UD coordination-attachment-drift
 * pattern (a later list member's `conj` attached several hops below the first member's own
 * head, e.g. through a nested PP modifier) that only real parser output reliably reproduces.
 */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

describe('Prototype 2.6G2.6C4 Part A -- colon-introduced unnumbered enumeration coverage', () => {
  it('(1) two-member colon list ("...into two categories: causative factors and trigger factors.") -- fully represented, single owner', () => {
    const text = 'The landslide causal factors for LSM can be classified into two categories: causative factors and trigger factors.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 4, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'landslide', upos: 'NOUN', head: 4, deprel: 'compound', start: 4, end: 13 }),
      tok({ id: 3, text: 'causal', upos: 'ADJ', head: 4, deprel: 'amod', start: 14, end: 20 }),
      tok({ id: 4, text: 'factors', upos: 'NOUN', head: 9, deprel: 'nsubj:pass', start: 21, end: 28 }),
      tok({ id: 5, text: 'for', upos: 'ADP', head: 6, deprel: 'case', start: 29, end: 32 }),
      tok({ id: 6, text: 'LSM', upos: 'PROPN', head: 4, deprel: 'nmod', start: 33, end: 36 }),
      tok({ id: 7, text: 'can', upos: 'AUX', head: 9, deprel: 'aux', start: 37, end: 40 }),
      tok({ id: 8, text: 'be', upos: 'AUX', head: 9, deprel: 'aux:pass', start: 41, end: 43 }),
      tok({ id: 9, text: 'classified', upos: 'VERB', head: 0, deprel: 'root', start: 44, end: 54 }),
      tok({ id: 10, text: 'into', upos: 'ADP', head: 12, deprel: 'case', start: 55, end: 59 }),
      tok({ id: 11, text: 'two', upos: 'NUM', head: 12, deprel: 'nummod', start: 60, end: 63 }),
      tok({ id: 12, text: 'categories', upos: 'NOUN', head: 9, deprel: 'obl', start: 64, end: 74 }),
      tok({ id: 13, text: ':', upos: 'PUNCT', head: 15, deprel: 'punct', start: 74, end: 75 }),
      tok({ id: 14, text: 'causative', upos: 'ADJ', head: 15, deprel: 'amod', start: 76, end: 85 }),
      tok({ id: 15, text: 'factors', upos: 'NOUN', head: 12, deprel: 'appos', start: 86, end: 93 }),
      tok({ id: 16, text: 'and', upos: 'CCONJ', head: 18, deprel: 'cc', start: 94, end: 97 }),
      tok({ id: 17, text: 'trigger', upos: 'NOUN', head: 18, deprel: 'compound', start: 98, end: 105 }),
      tok({ id: 18, text: 'factors', upos: 'NOUN', head: 15, deprel: 'conj', start: 106, end: 113 }),
      tok({ id: 19, text: '.', upos: 'PUNCT', head: 9, deprel: 'punct', start: 113, end: 114 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    const enumeration = flat.find((n) => n.role === 'enumeration')
    expect(enumeration).toBeDefined()
    expect(enumeration!.children.map((c) => c.text)).toEqual(['causative factors', 'trigger factors'])
    // Subject unaffected, single canonical owner.
    expect(flat.filter((n) => n.role === 'subject')).toHaveLength(1)
  })

  it('(2) three-member colon list with an internally-modified first member (UD coordination-attachment-drift, "...into two zones: the northern mountainous zone with steep slopes and the southern coastal plain with gentle terrain.") -- previously dropped entirely, now fully covered', () => {
    const text = 'The study area can be divided into two zones: the northern mountainous zone with steep slopes and the southern coastal plain with gentle terrain.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 3, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'study', upos: 'NOUN', head: 3, deprel: 'compound', start: 4, end: 9 }),
      tok({ id: 3, text: 'area', upos: 'NOUN', head: 6, deprel: 'nsubj:pass', start: 10, end: 14 }),
      tok({ id: 4, text: 'can', upos: 'AUX', head: 6, deprel: 'aux', start: 15, end: 18 }),
      tok({ id: 5, text: 'be', upos: 'AUX', head: 6, deprel: 'aux:pass', start: 19, end: 21 }),
      tok({ id: 6, text: 'divided', upos: 'VERB', head: 0, deprel: 'root', start: 22, end: 29 }),
      tok({ id: 7, text: 'into', upos: 'ADP', head: 9, deprel: 'case', start: 30, end: 34 }),
      tok({ id: 8, text: 'two', upos: 'NUM', head: 9, deprel: 'nummod', start: 35, end: 38 }),
      tok({ id: 9, text: 'zones', upos: 'NOUN', head: 6, deprel: 'obl', start: 39, end: 44 }),
      tok({ id: 10, text: ':', upos: 'PUNCT', head: 14, deprel: 'punct', start: 44, end: 45 }),
      tok({ id: 11, text: 'the', upos: 'DET', head: 14, deprel: 'det', start: 46, end: 49 }),
      tok({ id: 12, text: 'northern', upos: 'ADJ', head: 14, deprel: 'amod', start: 50, end: 58 }),
      tok({ id: 13, text: 'mountainous', upos: 'ADJ', head: 14, deprel: 'amod', start: 59, end: 70 }),
      tok({ id: 14, text: 'zone', upos: 'NOUN', head: 9, deprel: 'appos', start: 71, end: 75 }),
      tok({ id: 15, text: 'with', upos: 'ADP', head: 17, deprel: 'case', start: 76, end: 80 }),
      tok({ id: 16, text: 'steep', upos: 'ADJ', head: 17, deprel: 'amod', start: 81, end: 86 }),
      tok({ id: 17, text: 'slopes', upos: 'NOUN', head: 14, deprel: 'nmod', start: 87, end: 93 }),
      tok({ id: 18, text: 'and', upos: 'CCONJ', head: 22, deprel: 'cc', start: 94, end: 97 }),
      tok({ id: 19, text: 'the', upos: 'DET', head: 22, deprel: 'det', start: 98, end: 101 }),
      tok({ id: 20, text: 'southern', upos: 'ADJ', head: 22, deprel: 'amod', start: 102, end: 110 }),
      tok({ id: 21, text: 'coastal', upos: 'ADJ', head: 22, deprel: 'amod', start: 111, end: 118 }),
      // "plain" (item 2) is `conj` of "slopes" (a NESTED `nmod` inside item 1), never of
      // "zone" (item 1's own head) directly -- the exact drift pattern this fix generalizes.
      tok({ id: 22, text: 'plain', upos: 'NOUN', head: 17, deprel: 'conj', start: 119, end: 124 }),
      tok({ id: 23, text: 'with', upos: 'ADP', head: 25, deprel: 'case', start: 125, end: 129 }),
      tok({ id: 24, text: 'gentle', upos: 'ADJ', head: 25, deprel: 'amod', start: 130, end: 136 }),
      tok({ id: 25, text: 'terrain', upos: 'NOUN', head: 22, deprel: 'nmod', start: 137, end: 144 }),
      tok({ id: 26, text: '.', upos: 'PUNCT', head: 6, deprel: 'punct', start: 144, end: 145 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    const enumeration = flat.find((n) => n.role === 'enumeration')
    expect(enumeration).toBeDefined()
    expect(enumeration!.children).toHaveLength(2)
    expect(enumeration!.children[0]!.text).toBe('the northern mountainous zone with steep slopes')
    expect(enumeration!.children[1]!.text).toBe('the southern coastal plain with gentle terrain')
  })

  it('(3) colon explanation negative -- no fake enumeration ("The reason is simple: the observations were incomplete.")', () => {
    const text = 'The reason is simple: the observations were incomplete.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'reason', upos: 'NOUN', head: 4, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: 'is', upos: 'AUX', head: 4, deprel: 'cop', start: 11, end: 13 }),
      tok({ id: 4, text: 'simple', upos: 'ADJ', head: 0, deprel: 'root', start: 14, end: 20 }),
      tok({ id: 5, text: ':', upos: 'PUNCT', head: 9, deprel: 'punct', start: 20, end: 21 }),
      tok({ id: 6, text: 'the', upos: 'DET', head: 7, deprel: 'det', start: 22, end: 25 }),
      tok({ id: 7, text: 'observations', upos: 'NOUN', head: 9, deprel: 'nsubj', start: 26, end: 38 }),
      tok({ id: 8, text: 'were', upos: 'AUX', head: 9, deprel: 'cop', start: 39, end: 43 }),
      tok({ id: 9, text: 'incomplete', upos: 'ADJ', head: 4, deprel: 'parataxis', start: 44, end: 54 }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', start: 54, end: 55 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    expect(flat.some((n) => n.role === 'enumeration')).toBe(false)
    // Two independent clauses, both fully represented -- no content lost, no fake grouping.
    expect(tree).toHaveLength(2)
  })

  it('(4) colon single-clause negative -- no fake enumeration ("The result was unexpected: the model failed during validation.")', () => {
    const text = 'The result was unexpected: the model failed during validation.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'result', upos: 'NOUN', head: 4, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: 'was', upos: 'AUX', head: 4, deprel: 'cop', start: 11, end: 14 }),
      tok({ id: 4, text: 'unexpected', upos: 'ADJ', head: 0, deprel: 'root', start: 15, end: 25 }),
      tok({ id: 5, text: ':', upos: 'PUNCT', head: 8, deprel: 'punct', start: 25, end: 26 }),
      tok({ id: 6, text: 'the', upos: 'DET', head: 7, deprel: 'det', start: 27, end: 30 }),
      tok({ id: 7, text: 'model', upos: 'NOUN', head: 8, deprel: 'nsubj', start: 31, end: 36 }),
      tok({ id: 8, text: 'failed', upos: 'VERB', head: 4, deprel: 'parataxis', start: 37, end: 43 }),
      tok({ id: 9, text: 'during', upos: 'ADP', head: 10, deprel: 'case', start: 44, end: 50 }),
      tok({ id: 10, text: 'validation', upos: 'NOUN', head: 8, deprel: 'obl', start: 51, end: 61 }),
      tok({ id: 11, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', start: 61, end: 62 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    expect(flat.some((n) => n.role === 'enumeration')).toBe(false)
    expect(tree).toHaveLength(2)
  })

  it('(5) ratio/numeric colon negative -- tokenized as one unit, no fake enumeration ("...the split was 7:3 for this experiment.")', () => {
    const text = 'The training and testing split was 7:3 for this experiment.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 5, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'training', upos: 'NOUN', head: 5, deprel: 'compound', start: 4, end: 12 }),
      tok({ id: 3, text: 'and', upos: 'CCONJ', head: 4, deprel: 'cc', start: 13, end: 16 }),
      tok({ id: 4, text: 'testing', upos: 'NOUN', head: 2, deprel: 'conj', start: 17, end: 24 }),
      tok({ id: 5, text: 'split', upos: 'NOUN', head: 7, deprel: 'nsubj', start: 25, end: 30 }),
      tok({ id: 6, text: 'was', upos: 'AUX', head: 7, deprel: 'cop', start: 31, end: 34 }),
      tok({ id: 7, text: '7:3', upos: 'NUM', head: 0, deprel: 'root', start: 35, end: 38 }),
      tok({ id: 8, text: 'for', upos: 'ADP', head: 10, deprel: 'case', start: 39, end: 42 }),
      tok({ id: 9, text: 'this', upos: 'DET', head: 10, deprel: 'det', start: 43, end: 47 }),
      tok({ id: 10, text: 'experiment', upos: 'NOUN', head: 7, deprel: 'nmod', start: 48, end: 58 }),
      tok({ id: 11, text: '.', upos: 'PUNCT', head: 7, deprel: 'punct', start: 58, end: 59 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    // The ratio "7:3" (one token, containing a colon character) is never split into a fake
    // 2-item list -- the primary requirement this negative control exists to prove.
    expect(flat.some((n) => n.role === 'enumeration')).toBe(false)
  })
})
