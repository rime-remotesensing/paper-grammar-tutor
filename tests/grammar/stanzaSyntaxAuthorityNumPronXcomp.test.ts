import { describe, expect, it } from 'vitest'
import { buildSentenceCoreSetFromStanzaTokens, type StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * A nominal xcomp complement headed by a NUMERAL or PRONOUN ("has become ONE of the most
 * prominent techniques", "became SOMETHING unexpected") must map to C exactly like an
 * ADJ/NOUN/PROPN head. UD tags those heads NUM/PRON, and the converter used to drop them
 * (C=null, pattern SV), which also removed the Tree's complement node together with every
 * postmodifier nested under it. A verbal xcomp ("began to run") stays unmapped.
 *
 * Token fixtures are real Stanza 1.14.0 (package `default`) parses captured from the local
 * syntax service, embedded inline so this suite never depends on a gitignored artifact.
 */

type Row = [id: number, text: string, upos: string, head: number, deprel: string, start: number, end: number]

function parsed(text: string, rows: Row[]): { text: string; tokens: StanzaToken[] } {
  return { text, tokens: rows.map(([id, t, upos, head, deprel, start, end]) => ({ id, text: t, lemma: null, upos, head, deprel, start, end })) }
}

function primary(c: { text: string; tokens: StanzaToken[] }) {
  const { coreSet } = buildSentenceCoreSetFromStanzaTokens(c.text, c.tokens)
  const core = coreSet.predicateCores[0]!
  return {
    subject: coreSet.subject?.text ?? null,
    verb: core.verb?.text ?? null,
    object: core.object?.text ?? null,
    complement: core.complement?.text ?? null,
    pattern: core.pattern,
  }
}

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

const TARGET = parsed(
  'In recent years, ensemble learning has become one of the most prominent techniques in the field of Machine Learning (ML), offering improved accuracy, robustness, and generalization by combining multiple models (Dietterich, 2000; Ganaie et al., 2022; Zhou, 2012).',
  [
    [1, 'In', 'ADP', 3, 'case', 0, 2],
    [2, 'recent', 'ADJ', 3, 'amod', 3, 9],
    [3, 'years', 'NOUN', 8, 'obl', 10, 15],
    [4, ',', 'PUNCT', 3, 'punct', 15, 16],
    [5, 'ensemble', 'NOUN', 6, 'compound', 17, 25],
    [6, 'learning', 'NOUN', 8, 'nsubj', 26, 34],
    [7, 'has', 'AUX', 8, 'aux', 35, 38],
    [8, 'become', 'VERB', 0, 'root', 39, 45],
    [9, 'one', 'NUM', 8, 'xcomp', 46, 49],
    [10, 'of', 'ADP', 14, 'case', 50, 52],
    [11, 'the', 'DET', 14, 'det', 53, 56],
    [12, 'most', 'ADV', 13, 'advmod', 57, 61],
    [13, 'prominent', 'ADJ', 14, 'amod', 62, 71],
    [14, 'techniques', 'NOUN', 9, 'nmod', 72, 82],
    [15, 'in', 'ADP', 17, 'case', 83, 85],
    [16, 'the', 'DET', 17, 'det', 86, 89],
    [17, 'field', 'NOUN', 14, 'nmod', 90, 95],
    [18, 'of', 'ADP', 20, 'case', 96, 98],
    [19, 'Machine', 'NOUN', 20, 'compound', 99, 106],
    [20, 'Learning', 'NOUN', 17, 'nmod', 107, 115],
    [21, '(', 'PUNCT', 22, 'punct', 116, 117],
    [22, 'ML', 'NOUN', 20, 'appos', 117, 119],
    [23, ')', 'PUNCT', 22, 'punct', 119, 120],
    [24, ',', 'PUNCT', 25, 'punct', 120, 121],
    [25, 'offering', 'VERB', 14, 'acl', 122, 130],
    [26, 'improved', 'VERB', 27, 'amod', 131, 139],
    [27, 'accuracy', 'NOUN', 25, 'obj', 140, 148],
    [28, ',', 'PUNCT', 29, 'punct', 148, 149],
    [29, 'robustness', 'NOUN', 27, 'conj', 150, 160],
    [30, ',', 'PUNCT', 32, 'punct', 160, 161],
    [31, 'and', 'CCONJ', 32, 'cc', 162, 165],
    [32, 'generalization', 'NOUN', 27, 'conj', 166, 180],
    [33, 'by', 'SCONJ', 34, 'mark', 181, 183],
    [34, 'combining', 'VERB', 25, 'advcl', 184, 193],
    [35, 'multiple', 'ADJ', 36, 'amod', 194, 202],
    [36, 'models', 'NOUN', 34, 'obj', 203, 209],
    [37, '(', 'PUNCT', 38, 'punct', 210, 211],
    [38, 'Dietterich', 'PROPN', 36, 'dep', 211, 221],
    [39, ',', 'PUNCT', 40, 'punct', 221, 222],
    [40, '2000', 'NUM', 38, 'nmod:unmarked', 223, 227],
    [41, ';', 'PUNCT', 42, 'punct', 227, 228],
    [42, 'Ganaie', 'PROPN', 38, 'conj', 229, 235],
    [43, 'et', 'X', 44, 'cc', 236, 238],
    [44, 'al.', 'X', 42, 'conj', 239, 242],
    [45, ',', 'PUNCT', 46, 'punct', 242, 243],
    [46, '2022', 'NUM', 38, 'nmod:unmarked', 244, 248],
    [47, ';', 'PUNCT', 48, 'punct', 248, 249],
    [48, 'Zhou', 'PROPN', 38, 'conj', 250, 254],
    [49, ',', 'PUNCT', 50, 'punct', 254, 255],
    [50, '2012', 'NUM', 48, 'nmod:unmarked', 256, 260],
    [51, ')', 'PUNCT', 38, 'punct', 260, 261],
    [52, '.', 'PUNCT', 8, 'punct', 261, 262],
  ],
)

const REMAINS_NUM = parsed(
  'This method remains one of the best options for small datasets.',
  [
    [1, 'This', 'DET', 2, 'det', 0, 4],
    [2, 'method', 'NOUN', 3, 'nsubj', 5, 11],
    [3, 'remains', 'VERB', 0, 'root', 12, 19],
    [4, 'one', 'NUM', 3, 'xcomp', 20, 23],
    [5, 'of', 'ADP', 8, 'case', 24, 26],
    [6, 'the', 'DET', 8, 'det', 27, 30],
    [7, 'best', 'ADJ', 8, 'amod', 31, 35],
    [8, 'options', 'NOUN', 4, 'nmod', 36, 43],
    [9, 'for', 'ADP', 11, 'case', 44, 47],
    [10, 'small', 'ADJ', 11, 'amod', 48, 53],
    [11, 'datasets', 'NOUN', 8, 'nmod', 54, 62],
    [12, '.', 'PUNCT', 3, 'punct', 62, 63],
  ],
)

const BECOME_NUM_ADJ_HEAD = parsed(
  'Over the decade, the region has become one of the driest in the country.',
  [
    [1, 'Over', 'ADP', 3, 'case', 0, 4],
    [2, 'the', 'DET', 3, 'det', 5, 8],
    [3, 'decade', 'NOUN', 8, 'obl', 9, 15],
    [4, ',', 'PUNCT', 3, 'punct', 15, 16],
    [5, 'the', 'DET', 6, 'det', 17, 20],
    [6, 'region', 'NOUN', 8, 'nsubj', 21, 27],
    [7, 'has', 'AUX', 8, 'aux', 28, 31],
    [8, 'become', 'VERB', 0, 'root', 32, 38],
    [9, 'one', 'NUM', 8, 'xcomp', 39, 42],
    [10, 'of', 'ADP', 12, 'case', 43, 45],
    [11, 'the', 'DET', 12, 'det', 46, 49],
    [12, 'driest', 'ADJ', 9, 'nmod', 50, 56],
    [13, 'in', 'ADP', 15, 'case', 57, 59],
    [14, 'the', 'DET', 15, 'det', 60, 63],
    [15, 'country', 'NOUN', 12, 'obl', 64, 71],
    [16, '.', 'PUNCT', 8, 'punct', 71, 72],
  ],
)

const BECAME_PRON = parsed(
  'The final result became something entirely unexpected.',
  [
    [1, 'The', 'DET', 3, 'det', 0, 3],
    [2, 'final', 'ADJ', 3, 'amod', 4, 9],
    [3, 'result', 'NOUN', 4, 'nsubj', 10, 16],
    [4, 'became', 'VERB', 0, 'root', 17, 23],
    [5, 'something', 'PRON', 4, 'xcomp', 24, 33],
    [6, 'entirely', 'ADV', 7, 'advmod', 34, 42],
    [7, 'unexpected', 'ADJ', 5, 'amod', 43, 53],
    [8, '.', 'PUNCT', 4, 'punct', 53, 54],
  ],
)

const MADE_OBJ_NUM = parsed(
  'The board made him one of the directors.',
  [
    [1, 'The', 'DET', 2, 'det', 0, 3],
    [2, 'board', 'NOUN', 3, 'nsubj', 4, 9],
    [3, 'made', 'VERB', 0, 'root', 10, 14],
    [4, 'him', 'PRON', 3, 'obj', 15, 18],
    [5, 'one', 'NUM', 3, 'xcomp', 19, 22],
    [6, 'of', 'ADP', 8, 'case', 23, 25],
    [7, 'the', 'DET', 8, 'det', 26, 29],
    [8, 'directors', 'NOUN', 5, 'nmod', 30, 39],
    [9, '.', 'PUNCT', 3, 'punct', 39, 40],
  ],
)

const CONSIDER_OBJ_PRON = parsed(
  'We consider it something worth testing.',
  [
    [1, 'We', 'PRON', 2, 'nsubj', 0, 2],
    [2, 'consider', 'VERB', 0, 'root', 3, 11],
    [3, 'it', 'PRON', 2, 'obj', 12, 14],
    [4, 'something', 'PRON', 2, 'xcomp', 15, 24],
    [5, 'worth', 'ADJ', 6, 'amod', 25, 30],
    [6, 'testing', 'NOUN', 4, 'nmod', 31, 38],
    [7, '.', 'PUNCT', 2, 'punct', 38, 39],
  ],
)

const BEGAN_TO_RUN = parsed(
  'The model began to run more quickly after tuning.',
  [
    [1, 'The', 'DET', 2, 'det', 0, 3],
    [2, 'model', 'NOUN', 3, 'nsubj', 4, 9],
    [3, 'began', 'VERB', 0, 'root', 10, 15],
    [4, 'to', 'PART', 5, 'mark', 16, 18],
    [5, 'run', 'VERB', 3, 'xcomp', 19, 22],
    [6, 'more', 'ADV', 7, 'advmod', 23, 27],
    [7, 'quickly', 'ADV', 5, 'advmod', 28, 35],
    [8, 'after', 'ADP', 9, 'case', 36, 41],
    [9, 'tuning', 'NOUN', 5, 'obl', 42, 48],
    [10, '.', 'PUNCT', 3, 'punct', 48, 49],
  ],
)

const WANT_TO_IMPROVE = parsed(
  'We want to improve the classification accuracy.',
  [
    [1, 'We', 'PRON', 2, 'nsubj', 0, 2],
    [2, 'want', 'VERB', 0, 'root', 3, 7],
    [3, 'to', 'PART', 4, 'mark', 8, 10],
    [4, 'improve', 'VERB', 2, 'xcomp', 11, 18],
    [5, 'the', 'DET', 7, 'det', 19, 22],
    [6, 'classification', 'NOUN', 7, 'compound', 23, 37],
    [7, 'accuracy', 'NOUN', 4, 'obj', 38, 46],
    [8, '.', 'PUNCT', 2, 'punct', 46, 47],
  ],
)

const EXPECT_OBJ_TO = parsed(
  'They expect the results to improve next year.',
  [
    [1, 'They', 'PRON', 2, 'nsubj', 0, 4],
    [2, 'expect', 'VERB', 0, 'root', 5, 11],
    [3, 'the', 'DET', 4, 'det', 12, 15],
    [4, 'results', 'NOUN', 2, 'obj', 16, 23],
    [5, 'to', 'PART', 6, 'mark', 24, 26],
    [6, 'improve', 'VERB', 2, 'xcomp', 27, 34],
    [7, 'next', 'ADJ', 8, 'amod', 35, 39],
    [8, 'year', 'NOUN', 6, 'obl:unmarked', 40, 44],
    [9, '.', 'PUNCT', 2, 'punct', 44, 45],
  ],
)

const FOUND_OBJ_ADJ = parsed(
  'The reviewers found the method easy to use.',
  [
    [1, 'The', 'DET', 2, 'det', 0, 3],
    [2, 'reviewers', 'NOUN', 3, 'nsubj', 4, 13],
    [3, 'found', 'VERB', 0, 'root', 14, 19],
    [4, 'the', 'DET', 5, 'det', 20, 23],
    [5, 'method', 'NOUN', 3, 'obj', 24, 30],
    [6, 'easy', 'ADJ', 5, 'amod', 31, 35],
    [7, 'to', 'PART', 8, 'mark', 36, 38],
    [8, 'use', 'VERB', 6, 'xcomp', 39, 42],
    [9, '.', 'PUNCT', 3, 'punct', 42, 43],
  ],
)

describe('NUM/PRON-headed nominal xcomp -> complement', () => {
  it('target sentence: has become + NUM-headed complement is SVC with the exact complement span', () => {
    expect(primary(TARGET)).toEqual({
      subject: 'ensemble learning',
      verb: 'has become',
      object: null,
      complement: 'one of the most prominent techniques in the field of Machine Learning (ML)',
      pattern: 'SVC',
    })
  })

  it('target sentence: the Tree complement node and the offering postmodifier nested under it are restored', () => {
    const nodes = flatten(buildStanzaHierarchicalTree(TARGET.text, TARGET.tokens))
    const complement = nodes.find((n) => n.role === 'complement')
    expect(complement?.text).toBe('one of the most prominent techniques in the field of Machine Learning (ML)')
    const offering = flatten(complement!.children).find((n) => n.role === 'postmodifier' && n.text.startsWith('offering'))
    expect(offering?.text).toBe('offering improved accuracy, robustness, and generalization')
    expect(flatten(offering!.children).filter((n) => n.role === 'coordinationMember').map((n) => n.text)).toEqual(
      expect.arrayContaining(['improved accuracy', 'robustness', 'generalization']),
    )
  })

  it('remain + NUM-headed complement is SVC', () => {
    expect(primary(REMAINS_NUM)).toMatchObject({ verb: 'remains', object: null, complement: 'one of the best options for small datasets', pattern: 'SVC' })
  })

  it('become + NUM-headed complement over an elided superlative head is SVC', () => {
    expect(primary(BECOME_NUM_ADJ_HEAD)).toMatchObject({ verb: 'has become', object: null, complement: 'one of the driest in the country', pattern: 'SVC' })
  })

  it('become + PRON-headed complement is SVC', () => {
    // C is the pronoun head only: the postnominal adjective is cut by collectConstituentTokens'
    // existing postnominal-amod rule -- the same truncation a NOUN head already gets
    // ("became a thing entirely unexpected" -> C = "a thing"), not something this rule adds.
    expect(primary(BECAME_PRON)).toMatchObject({ verb: 'became', object: null, complement: 'something', pattern: 'SVC' })
  })

  it('object + NUM-headed xcomp is SVOC', () => {
    expect(primary(MADE_OBJ_NUM)).toMatchObject({ verb: 'made', object: 'him', complement: 'one of the directors', pattern: 'SVOC' })
  })

  it('object + PRON-headed xcomp is SVOC', () => {
    expect(primary(CONSIDER_OBJ_PRON)).toMatchObject({ verb: 'consider', object: 'it', complement: 'something worth testing', pattern: 'SVOC' })
  })
})

describe('verbal xcomp stays unmapped (negative controls)', () => {
  it('began to run: the verbal xcomp is never C', () => {
    expect(primary(BEGAN_TO_RUN)).toMatchObject({ verb: 'began', complement: null, pattern: 'SV' })
  })

  it('want to improve: the verbal xcomp is never C', () => {
    expect(primary(WANT_TO_IMPROVE)).toMatchObject({ verb: 'want', complement: null, pattern: 'SV' })
  })

  it('object + verbal xcomp stays SVO', () => {
    expect(primary(EXPECT_OBJ_TO)).toMatchObject({ verb: 'expect', object: 'the results', complement: null, pattern: 'SVO' })
  })

  it('existing object + ADJ xcomp SVOC is unchanged', () => {
    expect(primary(FOUND_OBJ_ADJ)).toMatchObject({ verb: 'found', object: 'the method', complement: 'easy to use', pattern: 'SVOC' })
  })
})
