import { describe, expect, it } from 'vitest'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.6C Problems A/B -- major-vs-internal coordination policy and enumeration
 * item internal decomposition. Section 16 tests 1-7. Fixtures are either hand-built (verified
 * offline against the real builder, positions checked byte-for-byte) or captured verbatim
 * from a real Stanza parse (tests 6/7, where reproducing genuine UD coordination-attachment
 * behavior by hand would be unreliable) -- never hand-tuned to make a specific case pass.
 */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

/** Same exact-key duplicate check used by the section 27 regression gate (never reusing the
 * Tree builder's own internal traversal/dedup logic -- purely a rendered-output audit). */
function hasVisibleDuplicate(nodes: StructureTreeNode[]): boolean {
  const keys = flatten(nodes).map((n) => `${n.role}:${n.start}:${n.end}:${n.text}`)
  return new Set(keys).size !== keys.length
}

describe('Prototype 2.6G2.6C item 1/2 -- major vs. internal coordination policy', () => {
  it('(1) internal premodifier coordination ("training and testing datasets") stays flat -- no redundant member children', () => {
    const text = 'The team collected the training and testing datasets for the LSM model.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 18 }),
      tok({ id: 4, text: 'the', upos: 'DET', head: 8, deprel: 'det', start: 19, end: 22 }),
      tok({ id: 5, text: 'training', upos: 'NOUN', head: 8, deprel: 'compound', start: 23, end: 31 }),
      tok({ id: 6, text: 'and', upos: 'CCONJ', head: 7, deprel: 'cc', start: 32, end: 35 }),
      tok({ id: 7, text: 'testing', upos: 'NOUN', head: 5, deprel: 'conj', start: 36, end: 43 }),
      tok({ id: 8, text: 'datasets', upos: 'NOUN', head: 3, deprel: 'obj', start: 44, end: 52 }),
      tok({ id: 9, text: 'for', upos: 'ADP', head: 12, deprel: 'case', start: 53, end: 56 }),
      tok({ id: 10, text: 'the', upos: 'DET', head: 12, deprel: 'det', start: 57, end: 60 }),
      tok({ id: 11, text: 'LSM', upos: 'PROPN', head: 12, deprel: 'compound', start: 61, end: 64 }),
      tok({ id: 12, text: 'model', upos: 'NOUN', head: 8, deprel: 'nmod', start: 65, end: 70 }),
      tok({ id: 13, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 70, end: 71 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    const object = flat.find((n) => n.role === 'object')!
    expect(object).toBeDefined()
    expect(object.text).toBe('the training and testing datasets for the LSM model')
    // Hard gate LOW_VALUE_INTERNAL_COORDINATION_DUPLICATION: "training"/"testing" must never
    // reappear as their own redundant child nodes once absorbed into the flat object text.
    expect(flat.some((n) => n.text === 'training')).toBe(false)
    expect(flat.some((n) => n.text === 'testing')).toBe(false)
    expect(hasVisibleDuplicate(tree)).toBe(false)
  })

  it('(2) major coordination (each member independently dominates substantial NP structure) remains decomposed into separate members', () => {
    const text = 'The processed dataset and the raw satellite archive were compared.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 3, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'processed', upos: 'VERB', head: 3, deprel: 'amod', start: 4, end: 13 }),
      tok({ id: 3, text: 'dataset', upos: 'NOUN', head: 10, deprel: 'nsubj:pass', start: 14, end: 21 }),
      tok({ id: 4, text: 'and', upos: 'CCONJ', head: 8, deprel: 'cc', start: 22, end: 25 }),
      tok({ id: 5, text: 'the', upos: 'DET', head: 8, deprel: 'det', start: 26, end: 29 }),
      tok({ id: 6, text: 'raw', upos: 'ADJ', head: 8, deprel: 'amod', start: 30, end: 33 }),
      tok({ id: 7, text: 'satellite', upos: 'NOUN', head: 8, deprel: 'compound', start: 34, end: 43 }),
      tok({ id: 8, text: 'archive', upos: 'NOUN', head: 3, deprel: 'conj', start: 44, end: 51 }),
      tok({ id: 9, text: 'were', upos: 'AUX', head: 10, deprel: 'aux:pass', start: 52, end: 56 }),
      tok({ id: 10, text: 'compared', upos: 'VERB', head: 0, deprel: 'root', start: 57, end: 65 }),
      tok({ id: 11, text: '.', upos: 'PUNCT', head: 10, deprel: 'punct', start: 65, end: 66 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    // Prototype 2.6G2.6C item B/6/7: coordination members carry the neutral
    // 'coordinationMember' role -- the canonical 'subject' label stays solely on the
    // container (asserted separately below).
    expect(flat.some((n) => n.role === 'coordinationMember' && n.text === 'The processed dataset')).toBe(true)
    expect(flat.some((n) => n.role === 'coordinationMember' && n.text === 'the raw satellite archive')).toBe(true)
    expect(flat.some((n) => n.role === 'subject' && n.text === 'The processed dataset and the raw satellite archive')).toBe(
      true,
    )
    expect(hasVisibleDuplicate(tree)).toBe(false)
  })
})

describe('Prototype 2.6G2.6C item 4/5/6 -- enumeration item internal decomposition', () => {
  const text =
    'The workflow has two phases: (1) the data is normalized using min-max scaling, and (2) the model is trained and the model is evaluated.'
  const tokens: StanzaToken[] = [
    tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
    tok({ id: 2, text: 'workflow', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 12 }),
    tok({ id: 3, text: 'has', upos: 'VERB', head: 0, deprel: 'root', start: 13, end: 16 }),
    tok({ id: 4, text: 'two', upos: 'NUM', head: 5, deprel: 'nummod', start: 17, end: 20 }),
    tok({ id: 5, text: 'phases', upos: 'NOUN', head: 3, deprel: 'obj', start: 21, end: 27 }),
    tok({ id: 6, text: ':', upos: 'PUNCT', head: 3, deprel: 'punct', start: 27, end: 28 }),
    tok({ id: 7, text: '(', upos: 'PUNCT', head: 13, deprel: 'punct', start: 29, end: 30 }),
    tok({ id: 8, text: '1', upos: 'NUM', head: 13, deprel: 'discourse', start: 30, end: 31 }),
    tok({ id: 9, text: ')', upos: 'PUNCT', head: 13, deprel: 'punct', start: 31, end: 32 }),
    tok({ id: 10, text: 'the', upos: 'DET', head: 11, deprel: 'det', start: 33, end: 36 }),
    tok({ id: 11, text: 'data', upos: 'NOUN', head: 13, deprel: 'nsubj:pass', start: 37, end: 41 }),
    tok({ id: 12, text: 'is', upos: 'AUX', head: 13, deprel: 'aux:pass', start: 42, end: 44 }),
    tok({ id: 13, text: 'normalized', upos: 'VERB', head: 3, deprel: 'parataxis', start: 45, end: 55 }),
    tok({ id: 14, text: 'using', upos: 'VERB', head: 13, deprel: 'advcl', start: 56, end: 61 }),
    tok({ id: 15, text: 'min-max', upos: 'ADJ', head: 16, deprel: 'amod', start: 62, end: 69 }),
    tok({ id: 16, text: 'scaling', upos: 'NOUN', head: 14, deprel: 'obj', start: 70, end: 77 }),
    tok({ id: 17, text: ',', upos: 'PUNCT', head: 13, deprel: 'punct', start: 77, end: 78 }),
    tok({ id: 18, text: 'and', upos: 'CCONJ', head: 25, deprel: 'cc', start: 79, end: 82 }),
    tok({ id: 19, text: '(', upos: 'PUNCT', head: 25, deprel: 'punct', start: 83, end: 84 }),
    tok({ id: 20, text: '2', upos: 'NUM', head: 25, deprel: 'discourse', start: 84, end: 85 }),
    tok({ id: 21, text: ')', upos: 'PUNCT', head: 25, deprel: 'punct', start: 85, end: 86 }),
    tok({ id: 22, text: 'the', upos: 'DET', head: 23, deprel: 'det', start: 87, end: 90 }),
    tok({ id: 23, text: 'model', upos: 'NOUN', head: 25, deprel: 'nsubj:pass', start: 91, end: 96 }),
    tok({ id: 24, text: 'is', upos: 'AUX', head: 25, deprel: 'aux:pass', start: 97, end: 99 }),
    tok({ id: 25, text: 'trained', upos: 'VERB', head: 13, deprel: 'conj', start: 100, end: 107 }),
    tok({ id: 26, text: 'and', upos: 'CCONJ', head: 30, deprel: 'cc', start: 108, end: 111 }),
    tok({ id: 27, text: 'the', upos: 'DET', head: 28, deprel: 'det', start: 112, end: 115 }),
    tok({ id: 28, text: 'model', upos: 'NOUN', head: 30, deprel: 'nsubj:pass', start: 116, end: 121 }),
    tok({ id: 29, text: 'is', upos: 'AUX', head: 30, deprel: 'aux:pass', start: 122, end: 124 }),
    tok({ id: 30, text: 'evaluated', upos: 'VERB', head: 25, deprel: 'conj', start: 125, end: 134 }),
    tok({ id: 31, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 134, end: 135 }),
  ]
  const tree = buildStanzaHierarchicalTree(text, tokens)
  const flat = flatten(tree)
  const enumeration = flat.find((n) => n.role === 'enumeration')!

  it('discovers the enumeration with exactly two items', () => {
    expect(enumeration).toBeDefined()
    expect(enumeration.children).toHaveLength(2)
  })

  it('(3) item (1) -- one finite clause -- decomposes into subject -> predicate', () => {
    const item1 = enumeration.children[0]!
    const subject = item1.children.find((c) => c.role === 'subject')!
    expect(subject).toBeDefined()
    expect(subject.text).toBe('the data')
    const predicate = subject.children.find((c) => c.role === 'predicate')!
    expect(predicate).toBeDefined()
    expect(predicate.text).toBe('is normalized')
  })

  it('(5) item (1) -- nested subjectless modifier clause ("using min-max scaling") nests under its governing predicate, not as a flat sibling', () => {
    const item1 = enumeration.children[0]!
    const subject = item1.children.find((c) => c.role === 'subject')!
    const predicate = subject.children.find((c) => c.role === 'predicate')!
    const modifier = predicate.children.find((c) => c.role === 'modifier' && c.text === 'using min-max scaling')
    expect(modifier).toBeDefined()
    // Never promoted to a flat item-level sibling.
    expect(item1.children.some((c) => c.text === 'using min-max scaling')).toBe(false)
  })

  it('(4) item (2) -- coordinated finite clauses, each with its OWN distinct subject -- both surface, connected by "and"', () => {
    const item2 = enumeration.children[1]!
    const subjects = item2.children.filter((c) => c.role === 'subject' && c.text === 'the model')
    expect(subjects).toHaveLength(2)
    expect(subjects[0]!.children.some((c) => c.text === 'is trained')).toBe(true)
    expect(subjects[1]!.children.some((c) => c.text === 'is evaluated')).toBe(true)
    expect(subjects[1]!.connector?.text).toBe('and')
  })

  it('(7) internal enumeration ownership: every predicate appears exactly once across the whole rendered tree', () => {
    expect(hasVisibleDuplicate(tree)).toBe(false)
    const predicateTexts = flatten(tree)
      .filter((n) => n.role === 'predicate' || n.role === 'coordinatedPredicate')
      .map((n) => n.text)
    expect(new Set(predicateTexts).size).toBe(predicateTexts.length)
  })
})

describe('Prototype 2.6G2.6C item 6 -- enumeration item flat fallback (no trustworthy internal clause structure)', () => {
  it('(6) items with no finite verb inside stay flat -- never manufactures structure merely because the list is numbered', () => {
    // Captured verbatim from a real Stanza parse (see phase notes) -- reproducing genuine UD
    // coordination/appositive attachment by hand for a no-verb noun-phrase list would risk
    // testing an invented shape rather than real parser behavior.
    const text = 'The dataset consists of two parts: (1) high-resolution imagery, and (2) coarse-resolution imagery.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'dataset', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 11 }),
      tok({ id: 3, text: 'consists', upos: 'VERB', head: 0, deprel: 'root', start: 12, end: 20 }),
      tok({ id: 4, text: 'of', upos: 'ADP', head: 6, deprel: 'case', start: 21, end: 23 }),
      tok({ id: 5, text: 'two', upos: 'NUM', head: 6, deprel: 'nummod', start: 24, end: 27 }),
      tok({ id: 6, text: 'parts', upos: 'NOUN', head: 3, deprel: 'obl', start: 28, end: 33 }),
      tok({ id: 7, text: ':', upos: 'PUNCT', head: 14, deprel: 'punct', start: 33, end: 34 }),
      tok({ id: 8, text: '(', upos: 'PUNCT', head: 9, deprel: 'punct', start: 35, end: 36 }),
      tok({ id: 9, text: '1', upos: 'NUM', head: 14, deprel: 'compound', start: 36, end: 37 }),
      tok({ id: 10, text: ')', upos: 'PUNCT', head: 9, deprel: 'punct', start: 37, end: 38 }),
      tok({ id: 11, text: 'high', upos: 'ADJ', head: 13, deprel: 'amod', start: 39, end: 43 }),
      tok({ id: 12, text: '-', upos: 'PUNCT', head: 11, deprel: 'punct', start: 43, end: 44 }),
      tok({ id: 13, text: 'resolution', upos: 'NOUN', head: 14, deprel: 'compound', start: 44, end: 54 }),
      tok({ id: 14, text: 'imagery', upos: 'NOUN', head: 6, deprel: 'appos', start: 55, end: 62 }),
      tok({ id: 15, text: ',', upos: 'PUNCT', head: 16, deprel: 'punct', start: 62, end: 63 }),
      tok({ id: 16, text: 'and', upos: 'CCONJ', head: 23, deprel: 'cc', start: 64, end: 67 }),
      tok({ id: 17, text: '(', upos: 'PUNCT', head: 18, deprel: 'punct', start: 68, end: 69 }),
      tok({ id: 18, text: '2', upos: 'NUM', head: 23, deprel: 'discourse', start: 69, end: 70 }),
      tok({ id: 19, text: ')', upos: 'PUNCT', head: 18, deprel: 'punct', start: 70, end: 71 }),
      tok({ id: 20, text: 'coarse', upos: 'NOUN', head: 22, deprel: 'compound', start: 72, end: 78 }),
      tok({ id: 21, text: '-', upos: 'PUNCT', head: 20, deprel: 'punct', start: 78, end: 79 }),
      tok({ id: 22, text: 'resolution', upos: 'NOUN', head: 23, deprel: 'compound', start: 79, end: 89 }),
      tok({ id: 23, text: 'imagery', upos: 'NOUN', head: 14, deprel: 'conj', start: 90, end: 97 }),
      tok({ id: 24, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 97, end: 98 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    const enumeration = flat.find((n) => n.role === 'enumeration')!
    expect(enumeration).toBeDefined()
    expect(enumeration.children).toHaveLength(2)
    for (const item of enumeration.children) {
      // Flat fallback: no manufactured subject/predicate/modifier structure.
      expect(item.children).toHaveLength(0)
    }
    expect(hasVisibleDuplicate(tree)).toBe(false)
  })
})
