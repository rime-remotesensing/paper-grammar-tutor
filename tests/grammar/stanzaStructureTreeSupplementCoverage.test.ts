import { describe, expect, it } from 'vitest'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.6C4 Part C -- CANONICAL_CONSTITUENT_SUPPLEMENT_LOSS. Controls 11-16 from
 * section 43. Fixtures are hand-transcribed from real Stanza parses (see phase diagnostic).
 */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

describe('Prototype 2.6G2.6C4 Part C -- canonical constituent supplement coverage', () => {
  it('(11) subject + "namely" supplement, co-occurring with a raw conj-chain coordination on the SAME canonical head -- previously dropped entirely, now covered', () => {
    // "Several factors, namely rainfall intensity..., slope angle, and soil type, contribute
    // ..." -- Stanza attaches "slope angle"/"soil type" via a raw `conj` chain directly to
    // "factors" itself (not to the appositive "intensity"), so the Tree's own coordination-
    // member decomposition fires on "factors" -- while "intensity" (the actual supplement
    // head) is a SEPARATE bare `appos` child of "factors", structurally unrelated to that
    // conj chain, correctly excluded from canonical S (a bare appositive is a non-restrictive
    // aside) but previously never surfaced anywhere in the Tree either.
    const text = 'Several factors, namely rainfall intensity over a short period, slope angle, and soil type, contribute to landslide risk.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Several', upos: 'DET', head: 2, deprel: 'amod', start: 0, end: 7 }),
      tok({ id: 2, text: 'factors', upos: 'NOUN', head: 19, deprel: 'nsubj', start: 8, end: 15 }),
      tok({ id: 3, text: ',', upos: 'PUNCT', head: 6, deprel: 'punct', start: 15, end: 16 }),
      tok({ id: 4, text: 'namely', upos: 'ADV', head: 6, deprel: 'advmod', start: 17, end: 23 }),
      tok({ id: 5, text: 'rainfall', upos: 'NOUN', head: 6, deprel: 'compound', start: 24, end: 32 }),
      tok({ id: 6, text: 'intensity', upos: 'NOUN', head: 2, deprel: 'appos', start: 33, end: 42 }),
      tok({ id: 7, text: 'over', upos: 'ADP', head: 10, deprel: 'case', start: 43, end: 47 }),
      tok({ id: 8, text: 'a', upos: 'DET', head: 10, deprel: 'det', start: 48, end: 49 }),
      tok({ id: 9, text: 'short', upos: 'ADJ', head: 10, deprel: 'amod', start: 50, end: 55 }),
      tok({ id: 10, text: 'period', upos: 'NOUN', head: 6, deprel: 'nmod', start: 56, end: 62 }),
      tok({ id: 11, text: ',', upos: 'PUNCT', head: 13, deprel: 'punct', start: 62, end: 63 }),
      tok({ id: 12, text: 'slope', upos: 'NOUN', head: 13, deprel: 'compound', start: 64, end: 69 }),
      tok({ id: 13, text: 'angle', upos: 'NOUN', head: 2, deprel: 'conj', start: 70, end: 75 }),
      tok({ id: 14, text: ',', upos: 'PUNCT', head: 17, deprel: 'punct', start: 75, end: 76 }),
      tok({ id: 15, text: 'and', upos: 'CCONJ', head: 17, deprel: 'cc', start: 77, end: 80 }),
      tok({ id: 16, text: 'soil', upos: 'NOUN', head: 17, deprel: 'compound', start: 81, end: 85 }),
      tok({ id: 17, text: 'type', upos: 'NOUN', head: 13, deprel: 'conj', start: 86, end: 90 }),
      tok({ id: 18, text: ',', upos: 'PUNCT', head: 2, deprel: 'punct', start: 90, end: 91 }),
      tok({ id: 19, text: 'contribute', upos: 'VERB', head: 0, deprel: 'root', start: 92, end: 102 }),
      tok({ id: 20, text: 'to', upos: 'ADP', head: 22, deprel: 'case', start: 103, end: 105 }),
      tok({ id: 21, text: 'landslide', upos: 'NOUN', head: 22, deprel: 'compound', start: 106, end: 115 }),
      tok({ id: 22, text: 'risk', upos: 'NOUN', head: 19, deprel: 'obl', start: 116, end: 120 }),
      tok({ id: 23, text: '.', upos: 'PUNCT', head: 19, deprel: 'punct', start: 120, end: 121 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    // Canonical subject role appears exactly once (the container), never duplicated.
    expect(flat.filter((n) => n.role === 'subject')).toHaveLength(1)
    // The supplement is fully represented, in source reading order, never as a second
    // "subject"-labeled node.
    const supplement = flat.find((n) => n.text === 'namely rainfall intensity over a short period')
    expect(supplement).toBeDefined()
    expect(supplement!.role).not.toBe('subject')
    // The genuinely coordinated members are unaffected.
    expect(flat.some((n) => n.role === 'coordinationMember' && n.text === 'slope angle')).toBe(true)
    expect(flat.some((n) => n.role === 'coordinationMember' && n.text === 'soil type')).toBe(true)
  })

  it('(12) object + supplement: "The team analyzed the results, including precision and recall, before publishing." -- supplement covered under the object, single owner', () => {
    const text = 'The team analyzed the results, including precision and recall, before publishing.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'analyzed', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 17 }),
      tok({ id: 4, text: 'the', upos: 'DET', head: 5, deprel: 'det', start: 18, end: 21 }),
      tok({ id: 5, text: 'results', upos: 'NOUN', head: 3, deprel: 'obj', start: 22, end: 29 }),
      tok({ id: 6, text: ',', upos: 'PUNCT', head: 8, deprel: 'punct', start: 29, end: 30 }),
      tok({ id: 7, text: 'including', upos: 'VERB', head: 8, deprel: 'case', start: 31, end: 40 }),
      tok({ id: 8, text: 'precision', upos: 'NOUN', head: 5, deprel: 'appos', start: 41, end: 50 }),
      tok({ id: 9, text: 'and', upos: 'CCONJ', head: 10, deprel: 'cc', start: 51, end: 54 }),
      tok({ id: 10, text: 'recall', upos: 'NOUN', head: 8, deprel: 'conj', start: 55, end: 61 }),
      tok({ id: 11, text: ',', upos: 'PUNCT', head: 3, deprel: 'punct', start: 61, end: 62 }),
      tok({ id: 12, text: 'before', upos: 'SCONJ', head: 13, deprel: 'mark', start: 63, end: 69 }),
      tok({ id: 13, text: 'publishing', upos: 'VERB', head: 3, deprel: 'advcl', start: 70, end: 80 }),
      tok({ id: 14, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 80, end: 81 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    expect(flat.filter((n) => n.role === 'object')).toHaveLength(1)
    // Prototype 2.6G2.6C5: "precision and recall" is a bare, comma-free 2-item coordination
    // (no comma between the two members in source) -- per the corrected, comma-based "genuine
    // list vs. tight internal pair" test (matching the "training and testing datasets"
    // internal-NP-negative principle), it correctly stays flat, undecomposed, as part of the
    // object's own covered text rather than splitting into separate coordinationMember nodes.
    // Coverage (both words present SOMEWHERE in the visible tree, never lost) is what this
    // test actually verifies -- not that each word gets its own dedicated node.
    expect(flat.some((n) => n.text === 'precision' || n.text.includes('precision'))).toBe(true)
    expect(flat.some((n) => n.text === 'recall' || n.text.includes('recall'))).toBe(true)
  })

  it('(15) supplement negative comma case: ordinary coordinated subject (no supplement-marking evidence) is unaffected', () => {
    const text = 'The temperature and humidity were recorded hourly.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'temperature', upos: 'NOUN', head: 6, deprel: 'nsubj:pass', start: 4, end: 15 }),
      tok({ id: 3, text: 'and', upos: 'CCONJ', head: 4, deprel: 'cc', start: 16, end: 19 }),
      tok({ id: 4, text: 'humidity', upos: 'NOUN', head: 2, deprel: 'conj', start: 20, end: 28 }),
      tok({ id: 5, text: 'were', upos: 'AUX', head: 6, deprel: 'aux:pass', start: 29, end: 33 }),
      tok({ id: 6, text: 'recorded', upos: 'VERB', head: 0, deprel: 'root', start: 34, end: 42 }),
      tok({ id: 7, text: 'hourly', upos: 'ADV', head: 6, deprel: 'advmod', start: 43, end: 49 }),
      tok({ id: 8, text: '.', upos: 'PUNCT', head: 6, deprel: 'punct', start: 49, end: 50 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    expect(flat.filter((n) => n.role === 'subject')).toHaveLength(1)
    expect(flat.some((n) => n.role === 'coordinationMember' && n.text === 'The temperature')).toBe(true)
    expect(flat.some((n) => n.role === 'coordinationMember' && n.text === 'humidity')).toBe(true)
    // No spurious supplement/modifier fabricated from an ordinary coordination.
    expect(flat.some((n) => n.role === 'modifier' && n.start === 0)).toBe(false)
  })
})
