import { describe, expect, it } from 'vitest'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Single ownership of a nested subordinate clause, and no marker-only wrapper for a subjectless
 * marked clause inside a postmodifier.
 *
 * Live-traced: "..., offering improved accuracy by combining multiple models." -- the
 * subjectless-modifier pass built "offering ..." as a modifier whose own advcl ("by combining
 * ...") became a leaf postmodifier without its ClauseFrame being claimed, so the deep-nesting
 * rescue rebuilt the same clause a second time as a top-level "[clause] by" sibling. Where the
 * clause WAS absorbed into the postmodifier, it came back as a marker-only wrapper:
 * [postmodifier] (empty) -> [clause] "by" -> [predicate] "combining" -> [object]. The marker now
 * folds into the postmodifier's presentation ("by combining") with the predicate's structure as
 * its children; a clause with its own subject ("because the data were limited") keeps its
 * marker wrapper.
 *
 * Token fixtures are real Stanza 1.14.0 (package `default`) parses of the normalized analysis
 * text, captured from the local syntax service and embedded inline.
 */

type Row = [id: number, text: string, upos: string, head: number, deprel: string, start: number, end: number]

function parsed(text: string, rows: Row[]): { text: string; tokens: StanzaToken[] } {
  return { text, tokens: rows.map(([id, t, upos, head, deprel, start, end]) => ({ id, text: t, lemma: null, upos, head, deprel, start, end })) }
}

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

function tree(c: { text: string; tokens: StanzaToken[] }): StructureTreeNode[] {
  return buildStanzaHierarchicalTree(c.text, c.tokens)
}

/** Nodes whose own text spans the given clause text (the clause shown as one unit), plus any
 * predicate node for its verb -- a clause rendered twice shows up as 2+ here. */
function occurrences(nodes: StructureTreeNode[], clauseText: string, verb: string): number {
  const all = flatten(nodes)
  return all.filter((n) => n.text === clauseText).length + all.filter((n) => n.role === 'predicate' && n.text === verb).length
}

const BY_COMBINING = parsed(
  'Ensemble learning has become one of the most prominent techniques in the field, offering improved accuracy by combining multiple models.',
  [
    [1, 'Ensemble', 'NOUN', 2, 'compound', 0, 8],
    [2, 'learning', 'NOUN', 4, 'nsubj', 9, 17],
    [3, 'has', 'AUX', 4, 'aux', 18, 21],
    [4, 'become', 'VERB', 0, 'root', 22, 28],
    [5, 'one', 'NUM', 4, 'xcomp', 29, 32],
    [6, 'of', 'ADP', 10, 'case', 33, 35],
    [7, 'the', 'DET', 10, 'det', 36, 39],
    [8, 'most', 'ADV', 9, 'advmod', 40, 44],
    [9, 'prominent', 'ADJ', 10, 'amod', 45, 54],
    [10, 'techniques', 'NOUN', 5, 'nmod', 55, 65],
    [11, 'in', 'ADP', 13, 'case', 66, 68],
    [12, 'the', 'DET', 13, 'det', 69, 72],
    [13, 'field', 'NOUN', 10, 'nmod', 73, 78],
    [14, ',', 'PUNCT', 15, 'punct', 78, 79],
    [15, 'offering', 'VERB', 4, 'advcl', 80, 88],
    [16, 'improved', 'VERB', 17, 'amod', 89, 97],
    [17, 'accuracy', 'NOUN', 15, 'obj', 98, 106],
    [18, 'by', 'SCONJ', 19, 'mark', 107, 109],
    [19, 'combining', 'VERB', 15, 'advcl', 110, 119],
    [20, 'multiple', 'ADJ', 21, 'amod', 120, 128],
    [21, 'models', 'NOUN', 19, 'obj', 129, 135],
    [22, '.', 'PUNCT', 4, 'punct', 135, 136],
  ],
)

const BY_USING = parsed(
  'The framework provides a new tool, enabling rapid mapping by using satellite data.',
  [
    [1, 'The', 'DET', 2, 'det', 0, 3],
    [2, 'framework', 'NOUN', 3, 'nsubj', 4, 13],
    [3, 'provides', 'VERB', 0, 'root', 14, 22],
    [4, 'a', 'DET', 6, 'det', 23, 24],
    [5, 'new', 'ADJ', 6, 'amod', 25, 28],
    [6, 'tool', 'NOUN', 3, 'obj', 29, 33],
    [7, ',', 'PUNCT', 8, 'punct', 33, 34],
    [8, 'enabling', 'VERB', 3, 'advcl', 35, 43],
    [9, 'rapid', 'ADJ', 10, 'amod', 44, 49],
    [10, 'mapping', 'NOUN', 8, 'obj', 50, 57],
    [11, 'by', 'SCONJ', 12, 'mark', 58, 60],
    [12, 'using', 'VERB', 8, 'advcl', 61, 66],
    [13, 'satellite', 'NOUN', 14, 'compound', 67, 76],
    [14, 'data', 'NOUN', 12, 'obj', 77, 81],
    [15, '.', 'PUNCT', 3, 'punct', 81, 82],
  ],
)

const BY_APPLYING = parsed(
  'This study proposes a workflow, improving precision by applying the proposed method.',
  [
    [1, 'This', 'DET', 2, 'det', 0, 4],
    [2, 'study', 'NOUN', 3, 'nsubj', 5, 10],
    [3, 'proposes', 'VERB', 0, 'root', 11, 19],
    [4, 'a', 'DET', 5, 'det', 20, 21],
    [5, 'workflow', 'NOUN', 3, 'obj', 22, 30],
    [6, ',', 'PUNCT', 7, 'punct', 30, 31],
    [7, 'improving', 'VERB', 3, 'advcl', 32, 41],
    [8, 'precision', 'NOUN', 7, 'obj', 42, 51],
    [9, 'by', 'SCONJ', 10, 'mark', 52, 54],
    [10, 'applying', 'VERB', 7, 'advcl', 55, 63],
    [11, 'the', 'DET', 13, 'det', 64, 67],
    [12, 'proposed', 'VERB', 13, 'amod', 68, 76],
    [13, 'method', 'NOUN', 10, 'obj', 77, 83],
    [14, '.', 'PUNCT', 3, 'punct', 83, 84],
  ],
)

const BY_DIRECT = parsed(
  'The method improved accuracy by combining multiple models.',
  [
    [1, 'The', 'DET', 2, 'det', 0, 3],
    [2, 'method', 'NOUN', 3, 'nsubj', 4, 10],
    [3, 'improved', 'VERB', 0, 'root', 11, 19],
    [4, 'accuracy', 'NOUN', 3, 'obj', 20, 28],
    [5, 'by', 'SCONJ', 6, 'mark', 29, 31],
    [6, 'combining', 'VERB', 3, 'advcl', 32, 41],
    [7, 'multiple', 'ADJ', 8, 'amod', 42, 50],
    [8, 'models', 'NOUN', 6, 'obj', 51, 57],
    [9, '.', 'PUNCT', 3, 'punct', 57, 58],
  ],
)

const TARGET = parsed(
  'In recent years, ensemble learning has become one of the most prominent techniques in the field of Machine Learning (ML), offering improved accuracy, robustness, and generalization by combining multiple models.',
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
    [25, 'offering', 'VERB', 9, 'acl', 122, 130],
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
    [37, '.', 'PUNCT', 8, 'punct', 209, 210],
  ],
)

const WHILE_NESTED = parsed(
  'The approach offers a simple design, reducing costs while maintaining accuracy.',
  [
    [1, 'The', 'DET', 2, 'det', 0, 3],
    [2, 'approach', 'NOUN', 3, 'nsubj', 4, 12],
    [3, 'offers', 'VERB', 0, 'root', 13, 19],
    [4, 'a', 'DET', 6, 'det', 20, 21],
    [5, 'simple', 'ADJ', 6, 'amod', 22, 28],
    [6, 'design', 'NOUN', 3, 'obj', 29, 35],
    [7, ',', 'PUNCT', 8, 'punct', 35, 36],
    [8, 'reducing', 'VERB', 3, 'advcl', 37, 45],
    [9, 'costs', 'NOUN', 8, 'obj', 46, 51],
    [10, 'while', 'SCONJ', 11, 'mark', 52, 57],
    [11, 'maintaining', 'VERB', 8, 'advcl', 58, 69],
    [12, 'accuracy', 'NOUN', 11, 'obj', 70, 78],
    [13, '.', 'PUNCT', 3, 'punct', 78, 79],
  ],
)

const BECAUSE = parsed(
  'The model failed because the data were limited.',
  [
    [1, 'The', 'DET', 2, 'det', 0, 3],
    [2, 'model', 'NOUN', 3, 'nsubj', 4, 9],
    [3, 'failed', 'VERB', 0, 'root', 10, 16],
    [4, 'because', 'SCONJ', 8, 'mark', 17, 24],
    [5, 'the', 'DET', 6, 'det', 25, 28],
    [6, 'data', 'NOUN', 8, 'nsubj:pass', 29, 33],
    [7, 'were', 'AUX', 8, 'aux:pass', 34, 38],
    [8, 'limited', 'VERB', 3, 'advcl', 39, 46],
    [9, '.', 'PUNCT', 3, 'punct', 46, 47],
  ],
)

const ALTHOUGH = parsed(
  'Although the method performed well, the errors remained high.',
  [
    [1, 'Although', 'SCONJ', 4, 'mark', 0, 8],
    [2, 'the', 'DET', 3, 'det', 9, 12],
    [3, 'method', 'NOUN', 4, 'nsubj', 13, 19],
    [4, 'performed', 'VERB', 9, 'advcl', 20, 29],
    [5, 'well', 'ADV', 4, 'advmod', 30, 34],
    [6, ',', 'PUNCT', 4, 'punct', 34, 35],
    [7, 'the', 'DET', 8, 'det', 36, 39],
    [8, 'errors', 'NOUN', 9, 'nsubj', 40, 46],
    [9, 'remained', 'VERB', 0, 'root', 47, 55],
    [10, 'high', 'ADJ', 9, 'xcomp', 56, 60],
    [11, '.', 'PUNCT', 9, 'punct', 60, 61],
  ],
)

const IF = parsed(
  'The process stops if the condition is satisfied.',
  [
    [1, 'The', 'DET', 2, 'det', 0, 3],
    [2, 'process', 'NOUN', 3, 'nsubj', 4, 11],
    [3, 'stops', 'VERB', 0, 'root', 12, 17],
    [4, 'if', 'SCONJ', 8, 'mark', 18, 20],
    [5, 'the', 'DET', 6, 'det', 21, 24],
    [6, 'condition', 'NOUN', 8, 'nsubj:pass', 25, 34],
    [7, 'is', 'AUX', 8, 'aux:pass', 35, 37],
    [8, 'satisfied', 'VERB', 3, 'advcl', 38, 47],
    [9, '.', 'PUNCT', 3, 'punct', 47, 48],
  ],
)

const WHEN = parsed(
  'The signal weakens when the temperature increases.',
  [
    [1, 'The', 'DET', 2, 'det', 0, 3],
    [2, 'signal', 'NOUN', 3, 'nsubj', 4, 10],
    [3, 'weakens', 'VERB', 0, 'root', 11, 18],
    [4, 'when', 'ADV', 7, 'advmod', 19, 23],
    [5, 'the', 'DET', 6, 'det', 24, 27],
    [6, 'temperature', 'NOUN', 7, 'nsubj', 28, 39],
    [7, 'increases', 'VERB', 3, 'advcl', 40, 49],
    [8, '.', 'PUNCT', 3, 'punct', 49, 50],
  ],
)

const WHILE_DIRECT = parsed(
  'The system reduced latency while maintaining accuracy.',
  [
    [1, 'The', 'DET', 2, 'det', 0, 3],
    [2, 'system', 'NOUN', 3, 'nsubj', 4, 10],
    [3, 'reduced', 'VERB', 0, 'root', 11, 18],
    [4, 'latency', 'NOUN', 3, 'obj', 19, 26],
    [5, 'while', 'SCONJ', 6, 'mark', 27, 32],
    [6, 'maintaining', 'VERB', 3, 'advcl', 33, 44],
    [7, 'accuracy', 'NOUN', 6, 'obj', 45, 53],
    [8, '.', 'PUNCT', 3, 'punct', 53, 54],
  ],
)

const BECAUSE_IN_RELATIVE = parsed(
  'The sensor reports errors, which helps users because the data are logged.',
  [
    [1, 'The', 'DET', 2, 'det', 0, 3],
    [2, 'sensor', 'NOUN', 3, 'nsubj', 4, 10],
    [3, 'reports', 'VERB', 0, 'root', 11, 18],
    [4, 'errors', 'NOUN', 3, 'obj', 19, 25],
    [5, ',', 'PUNCT', 7, 'punct', 25, 26],
    [6, 'which', 'PRON', 7, 'nsubj', 27, 32],
    [7, 'helps', 'VERB', 4, 'acl:relcl', 33, 38],
    [8, 'users', 'NOUN', 7, 'obj', 39, 44],
    [9, 'because', 'SCONJ', 13, 'mark', 45, 52],
    [10, 'the', 'DET', 11, 'det', 53, 56],
    [11, 'data', 'NOUN', 13, 'nsubj:pass', 57, 61],
    [12, 'are', 'AUX', 13, 'aux:pass', 62, 65],
    [13, 'logged', 'VERB', 7, 'advcl', 66, 72],
    [14, '.', 'PUNCT', 3, 'punct', 72, 73],
  ],
)

describe('subjectless marked clause nested in a postmodifier: single owner, no marker-only wrapper', () => {
  it.each([
    [BY_COMBINING, 'by combining multiple models', 'combining', 'by combining', 'multiple models'],
    [BY_USING, 'by using satellite data', 'using', 'by using', 'satellite data'],
    [BY_APPLYING, 'by applying the proposed method', 'applying', 'by applying', 'the proposed method'],
    [WHILE_NESTED, 'while maintaining accuracy', 'maintaining', 'while maintaining', 'accuracy'],
  ])('%#: "%s" is shown once, with the marker folded into its presentation and its object kept', (c, clauseText, verb, presentation, object) => {
    const nodes = tree(c)
    expect(occurrences(nodes, clauseText, verb)).toBe(1)
    expect(nodes.some((n) => n.role === 'clause')).toBe(false) // no top-level rescue duplicate
    const owner = flatten(nodes).find((n) => n.text === clauseText)!
    expect(owner.role).toBe('postmodifier')
    expect(owner.presentationSpan?.text).toBe(presentation)
    expect(owner.children.map((n) => [n.role, n.text])).toContainEqual(['object', object])
    expect(flatten(owner.children).some((n) => n.role === 'clause')).toBe(false) // no marker-only wrapper
  })

  it('target sentence: by combining multiple models sits once under offering, with no citation or wrapper nodes', () => {
    const nodes = tree(TARGET)
    expect(occurrences(nodes, 'by combining multiple models', 'combining')).toBe(1)
    expect(nodes.map((n) => n.role)).toEqual(['openingModifier', 'subject'])
    const all = flatten(nodes)
    const offering = all.find((n) => n.role === 'postmodifier' && n.text === 'offering improved accuracy, robustness, and generalization')!
    expect(offering.children.map((n) => n.text)).toEqual(['improved accuracy', 'robustness', 'generalization', 'by combining multiple models'])
    const byClause = offering.children.at(-1)!
    expect(byClause.presentationSpan?.text).toBe('by combining')
    expect(byClause.children.map((n) => [n.role, n.text])).toEqual([['object', 'multiple models']])
    expect(all.filter((n) => /Dietterich|Ganaie|Zhou|^al\.$/.test(n.text))).toEqual([])
    expect(all.some((n) => n.role === 'clause')).toBe(false)
  })

  it('a by-clause attached directly to the main verb stays one modifier', () => {
    const nodes = tree(BY_DIRECT)
    expect(occurrences(nodes, 'by combining multiple models', 'combining')).toBe(1)
    expect(flatten(nodes).find((n) => n.text === 'by combining multiple models')?.role).toBe('modifier')
  })
})

describe('marked clauses that must keep their existing presentation', () => {
  it('because + own subject, attached to the main verb, stays one modifier', () => {
    const nodes = tree(BECAUSE)
    expect(flatten(nodes).filter((n) => n.text === 'because the data were limited').map((n) => n.role)).toEqual(['modifier'])
  })

  it('preposed although-clause keeps its marker wrapper with its own subject and predicate', () => {
    const [first] = tree(ALTHOUGH)
    expect(first!.role).toBe('clause')
    expect(first!.marker?.text).toBe('Although')
    expect(first!.children.map((n) => [n.role, n.text])).toEqual([['subject', 'the method']])
    expect(first!.children[0]!.children.map((n) => [n.role, n.text])).toEqual([['predicate', 'performed']])
  })

  it('if-clause stays one modifier', () => {
    expect(flatten(tree(IF)).filter((n) => n.text === 'if the condition is satisfied').map((n) => n.role)).toEqual(['modifier'])
  })

  it('when-clause keeps its existing subject/predicate presentation', () => {
    const nodes = tree(WHEN)
    expect(nodes.map((n) => [n.role, n.text])).toEqual([
      ['subject', 'The signal'],
      ['subject', 'the temperature'],
    ])
    expect(nodes[1]!.children.map((n) => n.text)).toEqual(['when', 'increases'])
  })

  it('subjectless while-clause attached to the main verb stays one modifier', () => {
    const nodes = tree(WHILE_DIRECT)
    expect(occurrences(nodes, 'while maintaining accuracy', 'maintaining')).toBe(1)
    expect(flatten(nodes).find((n) => n.text === 'while maintaining accuracy')?.role).toBe('modifier')
  })

  it('a because-clause with its own subject inside a relative clause keeps its marker wrapper', () => {
    const all = flatten(tree(BECAUSE_IN_RELATIVE))
    const owner = all.find((n) => n.role === 'postmodifier' && n.text === 'because the data are logged')!
    expect(owner.presentationSpan?.text).toBe('')
    expect(owner.children).toHaveLength(1)
    const wrapper = owner.children[0]!
    expect([wrapper.role, wrapper.text, wrapper.marker?.text]).toEqual(['clause', 'because', 'because'])
    expect(wrapper.children.map((n) => [n.role, n.text])).toEqual([['subject', 'the data']])
  })
})
