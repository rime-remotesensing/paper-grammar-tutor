import { describe, expect, it } from 'vitest'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

/**
 * mergeAdjacentSiblingIntoLastMember() false-positive negative control
 * (fix/pp-coordination-member-text-ownership follow-up).
 *
 * Deliberately mirrors the VIIRS positive case's dependency SHAPE as closely as possible --
 * same relation category (`obl`), same adjacency (only whitespace between the coordination's
 * last member and the candidate), same "candidate has no internal structure of its own" --
 * while differing ONLY in a structural fact that has nothing to do with any specific word:
 * the coordination's own last member here already has a genuine NOUN head of its own
 * ("river"), unlike the VIIRS case where the last member's head token is a bare NUM ("1:30")
 * with no head noun. "Tuesday" is a same-category (`obl`), source-adjacent sibling of the
 * SAME enclosing head ("tested") that is semantically an unrelated time adjunct of "tested"
 * itself, not part of "by the river" -- it must never be swallowed into that member's own
 * span merely because it satisfies the shape-level (category + adjacency + no-internal-
 * structure) conditions the VIIRS fix relies on.
 *
 * "The device, which was tested near the old bridge and by the river Tuesday, worked well."
 */
const NEGATIVE_CONTROL_SENTENCE = 'The device, which was tested near the old bridge and by the river Tuesday, worked well.'

const NEGATIVE_CONTROL_TOKENS: StanzaToken[] = [
  tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
  tok({ id: 2, text: 'device', upos: 'NOUN', head: 17, deprel: 'nsubj', start: 4, end: 10 }),
  tok({ id: 3, text: ',', upos: 'PUNCT', head: 6, deprel: 'punct', start: 10, end: 11 }),
  tok({ id: 4, text: 'which', upos: 'PRON', head: 6, deprel: 'nsubj:pass', start: 12, end: 17 }),
  tok({ id: 5, text: 'was', upos: 'AUX', head: 6, deprel: 'aux:pass', start: 18, end: 21 }),
  tok({ id: 6, text: 'tested', upos: 'VERB', head: 2, deprel: 'acl:relcl', start: 22, end: 28 }),
  tok({ id: 7, text: 'near', upos: 'ADP', head: 10, deprel: 'case', start: 29, end: 33 }),
  tok({ id: 8, text: 'the', upos: 'DET', head: 10, deprel: 'det', start: 34, end: 37 }),
  tok({ id: 9, text: 'old', upos: 'ADJ', head: 10, deprel: 'amod', start: 38, end: 41 }),
  tok({ id: 10, text: 'bridge', upos: 'NOUN', head: 6, deprel: 'obl', start: 42, end: 48 }),
  tok({ id: 11, text: 'and', upos: 'CCONJ', head: 14, deprel: 'cc', start: 49, end: 52 }),
  tok({ id: 12, text: 'by', upos: 'ADP', head: 14, deprel: 'case', start: 53, end: 55 }),
  tok({ id: 13, text: 'the', upos: 'DET', head: 14, deprel: 'det', start: 56, end: 59 }),
  tok({ id: 14, text: 'river', upos: 'NOUN', head: 10, deprel: 'conj', start: 60, end: 65 }),
  // Not part of the "bridge ... and ... river" coordination at all: a same-category (`obl`),
  // source-adjacent, structurally simple (no children) sibling of "tested" -- structurally
  // indistinguishable from "times" in the VIIRS fixture at the shape level this merge checks,
  // but semantically a separate time adjunct of "tested", not a continuation of "by the river".
  tok({ id: 15, text: 'Tuesday', upos: 'PROPN', head: 6, deprel: 'obl', start: 66, end: 73 }),
  tok({ id: 16, text: ',', upos: 'PUNCT', head: 17, deprel: 'punct', start: 73, end: 74 }),
  tok({ id: 17, text: 'worked', upos: 'VERB', head: 0, deprel: 'root', start: 75, end: 81 }),
  tok({ id: 18, text: 'well', upos: 'ADV', head: 17, deprel: 'advmod', start: 82, end: 86 }),
  tok({ id: 19, text: '.', upos: 'PUNCT', head: 17, deprel: 'punct', start: 86, end: 87 }),
]

describe('mergeAdjacentSiblingIntoLastMember -- false-positive negative control', () => {
  const tree = buildStanzaHierarchicalTree(NEGATIVE_CONTROL_SENTENCE, NEGATIVE_CONTROL_TOKENS)
  const flat = flatten(tree)
  const relativeClause = flat.find((n) => n.role === 'relativeClause' && n.text.startsWith('which was tested'))!

  it('finds the relative clause', () => {
    expect(relativeClause).toBeDefined()
  })

  it('the coordination members are "the old bridge" and "by the river" -- unchanged by the unrelated sibling', () => {
    // "near" (member 0's own case marker) stays in the parent's own trunk text, not the
    // member -- the same established convention as the "on a mixture of..." regression guard
    // in stanzaStructureTreePpCoordinationOwnership.test.ts.
    const members = relativeClause.children.filter((c) => c.role === 'coordinationMember')
    expect(members.map((m) => m.text)).toEqual(['the old bridge', 'by the river'])
  })

  it('"Tuesday" is never absorbed into the last coordination member\'s own text', () => {
    const members = relativeClause.children.filter((c) => c.role === 'coordinationMember')
    for (const member of members) {
      expect(member.text).not.toContain('Tuesday')
    }
  })

  it('"Tuesday" still appears somewhere in the tree (not silently dropped either)', () => {
    const allNodeText = flatten(tree).map((n) => n.text).join(' | ')
    expect(allNodeText).toContain('Tuesday')
  })
})

describe('VIIRS positive case still passes (fix/pp-coordination-ownership + follow-up)', () => {
  const VIIRS_SENTENCE =
    'The VIIRS instrument was first launched on 28 October 2011 onboard the Suomi National Polar-orbiting Partnership (S-NPP), which was placed in a sun synchronous orbit at an altitude of 829 km and with 1:30pm/1:30am equatorial crossing times.'

  const VIIRS_TOKENS: StanzaToken[] = [
    tok({ id: 1, text: 'The', upos: 'DET', head: 3, deprel: 'det', start: 0, end: 3 }),
    tok({ id: 2, text: 'VIIRS', upos: 'PROPN', head: 3, deprel: 'compound', start: 4, end: 9 }),
    tok({ id: 3, text: 'instrument', upos: 'NOUN', head: 6, deprel: 'nsubj:pass', start: 10, end: 20 }),
    tok({ id: 4, text: 'was', upos: 'AUX', head: 6, deprel: 'aux:pass', start: 21, end: 24 }),
    tok({ id: 5, text: 'first', upos: 'ADV', head: 6, deprel: 'advmod', start: 25, end: 30 }),
    tok({ id: 6, text: 'launched', upos: 'VERB', head: 0, deprel: 'root', start: 31, end: 39 }),
    tok({ id: 7, text: 'on', upos: 'ADP', head: 8, deprel: 'case', start: 40, end: 42 }),
    tok({ id: 8, text: '28', upos: 'NUM', head: 6, deprel: 'obl', start: 43, end: 45 }),
    tok({ id: 9, text: 'October', upos: 'PROPN', head: 8, deprel: 'nmod:unmarked', start: 46, end: 53 }),
    tok({ id: 10, text: '2011', upos: 'NUM', head: 8, deprel: 'nmod:unmarked', start: 54, end: 58 }),
    tok({ id: 11, text: 'onboard', upos: 'ADP', head: 18, deprel: 'case', start: 59, end: 66 }),
    tok({ id: 12, text: 'the', upos: 'DET', head: 18, deprel: 'det', start: 67, end: 70 }),
    tok({ id: 13, text: 'Suomi', upos: 'PROPN', head: 18, deprel: 'compound', start: 71, end: 76 }),
    tok({ id: 14, text: 'National', upos: 'ADJ', head: 18, deprel: 'amod', start: 77, end: 85 }),
    tok({ id: 15, text: 'Polar', upos: 'ADJ', head: 17, deprel: 'amod', start: 86, end: 91 }),
    tok({ id: 16, text: '-', upos: 'PUNCT', head: 15, deprel: 'punct', start: 91, end: 92 }),
    tok({ id: 17, text: 'orbiting', upos: 'PROPN', head: 18, deprel: 'compound', start: 92, end: 100 }),
    tok({ id: 18, text: 'Partnership', upos: 'PROPN', head: 6, deprel: 'obl', start: 101, end: 112 }),
    tok({ id: 19, text: '(', upos: 'PUNCT', head: 22, deprel: 'punct', start: 113, end: 114 }),
    tok({ id: 20, text: 'S', upos: 'PROPN', head: 18, deprel: 'appos', start: 114, end: 115 }),
    tok({ id: 21, text: '-', upos: 'PUNCT', head: 20, deprel: 'punct', start: 115, end: 116 }),
    tok({ id: 22, text: 'NPP', upos: 'PROPN', head: 20, deprel: 'flat', start: 116, end: 119 }),
    tok({ id: 23, text: ')', upos: 'PUNCT', head: 22, deprel: 'punct', start: 119, end: 120 }),
    tok({ id: 24, text: ',', upos: 'PUNCT', head: 27, deprel: 'punct', start: 120, end: 121 }),
    tok({ id: 25, text: 'which', upos: 'PRON', head: 27, deprel: 'nsubj:pass', start: 122, end: 127 }),
    tok({ id: 26, text: 'was', upos: 'AUX', head: 27, deprel: 'aux:pass', start: 128, end: 131 }),
    tok({ id: 27, text: 'placed', upos: 'VERB', head: 18, deprel: 'acl:relcl', start: 132, end: 138 }),
    tok({ id: 28, text: 'in', upos: 'ADP', head: 32, deprel: 'case', start: 139, end: 141 }),
    tok({ id: 29, text: 'a', upos: 'DET', head: 32, deprel: 'det', start: 142, end: 143 }),
    tok({ id: 30, text: 'sun', upos: 'NOUN', head: 31, deprel: 'compound', start: 144, end: 147 }),
    tok({ id: 31, text: 'synchronous', upos: 'ADJ', head: 32, deprel: 'amod', start: 148, end: 159 }),
    tok({ id: 32, text: 'orbit', upos: 'NOUN', head: 27, deprel: 'obl', start: 160, end: 165 }),
    tok({ id: 33, text: 'at', upos: 'ADP', head: 35, deprel: 'case', start: 166, end: 168 }),
    tok({ id: 34, text: 'an', upos: 'DET', head: 35, deprel: 'det', start: 169, end: 171 }),
    tok({ id: 35, text: 'altitude', upos: 'NOUN', head: 27, deprel: 'obl', start: 172, end: 180 }),
    tok({ id: 36, text: 'of', upos: 'ADP', head: 38, deprel: 'case', start: 181, end: 183 }),
    tok({ id: 37, text: '829', upos: 'NUM', head: 38, deprel: 'nummod', start: 184, end: 187 }),
    tok({ id: 38, text: 'km', upos: 'NOUN', head: 35, deprel: 'nmod', start: 188, end: 190 }),
    tok({ id: 39, text: 'and', upos: 'CCONJ', head: 41, deprel: 'cc', start: 191, end: 194 }),
    tok({ id: 40, text: 'with', upos: 'ADP', head: 41, deprel: 'case', start: 195, end: 199 }),
    tok({ id: 41, text: '1:30', upos: 'NUM', head: 35, deprel: 'conj', start: 200, end: 204 }),
    tok({ id: 42, text: 'pm', upos: 'NOUN', head: 41, deprel: 'nmod:unmarked', start: 204, end: 206 }),
    tok({ id: 43, text: '/', upos: 'SYM', head: 44, deprel: 'case', start: 206, end: 207 }),
    tok({ id: 44, text: '1:30', upos: 'NUM', head: 41, deprel: 'nmod', start: 207, end: 211 }),
    tok({ id: 45, text: 'am', upos: 'NOUN', head: 44, deprel: 'nmod:unmarked', start: 211, end: 213 }),
    tok({ id: 46, text: 'equatorial', upos: 'ADJ', head: 48, deprel: 'amod', start: 214, end: 224 }),
    tok({ id: 47, text: 'crossing', upos: 'NOUN', head: 48, deprel: 'compound', start: 225, end: 233 }),
    tok({ id: 48, text: 'times', upos: 'NOUN', head: 27, deprel: 'obl:unmarked', start: 234, end: 239 }),
    tok({ id: 49, text: '.', upos: 'PUNCT', head: 6, deprel: 'punct', start: 239, end: 240 }),
  ]

  it('the coordination members are "an altitude of 829 km" and "with 1:30pm/1:30am equatorial crossing times"', () => {
    const tree = buildStanzaHierarchicalTree(VIIRS_SENTENCE, VIIRS_TOKENS)
    const relativeClause = flatten(tree).find((n) => n.role === 'relativeClause' && n.text.startsWith('which was placed'))!
    const members = relativeClause.children.filter((c) => c.role === 'coordinationMember')
    expect(members.map((m) => m.text)).toEqual(['an altitude of 829 km', 'with 1:30pm/1:30am equatorial crossing times'])
    expect(members[1]!.connector?.text).toBe('and')
  })
})
