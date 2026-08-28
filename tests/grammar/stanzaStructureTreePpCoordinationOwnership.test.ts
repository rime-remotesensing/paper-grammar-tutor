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

function presentation(n: StructureTreeNode): { text: string; start: number; end: number } {
  return n.presentationSpan ?? { text: n.text, start: n.start, end: n.end }
}

/**
 * Live bug repro (fix/pp-coordination-ownership): the visible "and" in
 * "...at an altitude of 829 km and with 1:30pm/1:30am equatorial crossing times" rendered
 * TWICE -- once (wrongly) inside the enclosing relativeClause's own presentationSpan, once
 * as the coordination-member connector -- and the second coordination member's own trailing
 * "equatorial crossing times" (an unrelated `obl:unmarked` sibling of the relative clause's
 * head, per the real Stanza parse below -- never actually attached to the conj chain) went
 * ownerless.
 *
 * Tokens below are the VERBATIM output of the local Stanza syntax service (POST /analyze,
 * `stanza==1.14.0`, `lang=en package=default`) for the full sentence, confirmed live during
 * this investigation -- not hand-simplified, so the fixture exercises the actual dependency
 * shape Stanza produces for this sentence (including its own attachment gap between the
 * "1:30pm/1:30am" conjunct and "times").
 */
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

describe('PP coordination ownership -- VIIRS live repro (fix/pp-coordination-ownership)', () => {
  const tree = buildStanzaHierarchicalTree(VIIRS_SENTENCE, VIIRS_TOKENS)
  const flat = flatten(tree)
  const relativeClause = flat.find((n) => n.role === 'relativeClause' && n.text.startsWith('which was placed'))!

  it('finds the relative clause and its two coordination members', () => {
    expect(relativeClause).toBeDefined()
  })

  it('parent authority text/span remains source-faithful (untouched by the presentation fix)', () => {
    expect(relativeClause.text).toBe(
      'which was placed in a sun synchronous orbit at an altitude of 829 km and with 1:30pm/1:30am equatorial crossing times',
    )
  })

  it('visible connector "and" appears exactly once across the whole subtree', () => {
    const wholeSubtreeText = [relativeClause, ...flatten(relativeClause.children)]
      .map((n) => presentation(n).text)
      .concat(relativeClause.children.map((c) => c.connector?.text).filter((t): t is string => Boolean(t)))
      .join(' | ')
    const matches = wholeSubtreeText.match(/\band\b/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('the parent presentationSpan does not overlap any child/member span', () => {
    const parentSpan = presentation(relativeClause)
    for (const child of relativeClause.children) {
      const overlaps = child.start < parentSpan.end && child.end > parentSpan.start
      expect(overlaps).toBe(false)
    }
  })

  it('the coordination members are "an altitude of 829 km" and "with 1:30pm/1:30am equatorial crossing times"', () => {
    const members = relativeClause.children.filter((c) => c.role === 'coordinationMember')
    expect(members.map((m) => m.text)).toEqual(['an altitude of 829 km', 'with 1:30pm/1:30am equatorial crossing times'])
  })

  it('the "and" connector is never duplicated onto the parent presentationSpan text', () => {
    expect(presentation(relativeClause).text).not.toContain('and')
  })

  it('the leading PP marker "at" is preserved (stays in the parent trunk, not dropped)', () => {
    expect(presentation(relativeClause).text).toContain('at')
  })

  it('the connector stays the bare conjunction "and" -- the second member\'s own "with" belongs to the member, not the connector', () => {
    const members = relativeClause.children.filter((c) => c.role === 'coordinationMember')
    expect(members[1]!.connector?.text).toBe('and')
    expect(members[1]!.text.startsWith('with ')).toBe(true)
  })

  it('"equatorial crossing times" is not ownerless -- it is part of the second coordination member, not a disconnected sibling', () => {
    const members = relativeClause.children.filter((c) => c.role === 'coordinationMember')
    expect(members[1]!.text).toContain('equatorial crossing times')
    expect(relativeClause.children.some((c) => c.role === 'modifier' && c.text.includes('equatorial'))).toBe(false)
  })

  it('no source lexical content between "which" and the final "times" is lost', () => {
    const allVisibleText = [presentation(relativeClause).text, ...relativeClause.children.map((c) => presentation(c).text), ...relativeClause.children.map((c) => c.connector?.text ?? '')].join(' ')
    for (const word of ['which', 'was', 'placed', 'orbit', 'altitude', '829', 'km', 'and', 'with', '1:30pm/1:30am', 'equatorial', 'crossing', 'times']) {
      expect(allVisibleText).toContain(word)
    }
  })
})

describe('PP coordination ownership -- existing NP/PP-internal coordination stays correct', () => {
  it('"on a mixture of alpha factors and beta conditions" -- shared preposition stays in the trunk (regression guard)', () => {
    // "The system depends on a mixture of alpha factors and beta conditions."
    const text = 'The system depends on a mixture of alpha factors and beta conditions.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'system', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: 'depends', upos: 'VERB', head: 0, deprel: 'root', start: 11, end: 18 }),
      tok({ id: 4, text: 'on', upos: 'ADP', head: 6, deprel: 'case', start: 19, end: 21 }),
      tok({ id: 5, text: 'a', upos: 'DET', head: 6, deprel: 'det', start: 22, end: 23 }),
      tok({ id: 6, text: 'mixture', upos: 'NOUN', head: 3, deprel: 'obl', start: 24, end: 31 }),
      tok({ id: 7, text: 'of', upos: 'ADP', head: 9, deprel: 'case', start: 32, end: 34 }),
      tok({ id: 8, text: 'alpha', upos: 'ADJ', head: 9, deprel: 'amod', start: 35, end: 40 }),
      tok({ id: 9, text: 'factors', upos: 'NOUN', head: 6, deprel: 'nmod', start: 41, end: 48 }),
      tok({ id: 10, text: 'and', upos: 'CCONJ', head: 12, deprel: 'cc', start: 49, end: 52 }),
      tok({ id: 11, text: 'beta', upos: 'ADJ', head: 12, deprel: 'amod', start: 53, end: 57 }),
      tok({ id: 12, text: 'conditions', upos: 'NOUN', head: 9, deprel: 'conj', start: 58, end: 68 }),
      tok({ id: 13, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 68, end: 69 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const modifier = flatten(tree).find((n) => n.role === 'modifier' && n.text.includes('mixture'))!
    expect(modifier.text).toBe('on a mixture of alpha factors and beta conditions')
    expect(modifier.presentationSpan?.text).toBe('on a mixture of')
    const members = modifier.children.filter((c) => c.role === 'coordinationMember')
    expect(members.map((m) => m.text)).toEqual(['alpha factors', 'beta conditions'])
    expect(members[1]!.connector?.text).toBe('and') // no own case-marker on this member -- connector stays bare
  })
})
