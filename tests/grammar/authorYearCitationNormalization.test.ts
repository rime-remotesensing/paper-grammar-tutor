import { describe, expect, it } from 'vitest'
import { removeCitationMarkersForAnalysis } from '../../src/features/grammar/domain/citationNormalization.ts'
import { normalizeSentenceForGrammarAnalysis, projectSentenceForGrammarAnalysis } from '../../src/features/grammar/domain/grammarInputNormalization.ts'
import { buildSentenceCoreSetFromStanzaTokens, type StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Parenthetical author-year citations ("(Smith et al., 2020; Jones, 2021)") are removed from
 * the grammar-analysis input, like numeric "[9]" citations already are. Left in, Stanza parsed
 * the authors as real syntax (dep/conj of the preceding noun) and the Structure Tree surfaced
 * every surname as a coordination member ("multiple models" -> Dietterich / Ganaie / al. /
 * Zhou). Removal goes through the Projection pipeline, so every surviving analysis character
 * still maps to its exact source index.
 *
 * Token fixtures are real Stanza 1.14.0 (package `default`) parses of the NORMALIZED analysis
 * text, captured from the local syntax service and embedded inline.
 */

type Row = [id: number, text: string, upos: string, head: number, deprel: string, start: number, end: number]

function parsed(text: string, rows: Row[]): { text: string; tokens: StanzaToken[] } {
  return { text, tokens: rows.map(([id, t, upos, head, deprel, start, end]) => ({ id, text: t, lemma: null, upos, head, deprel, start, end })) }
}

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

const TARGET_SOURCE =
  'In recent years, ensemble learning has become one of the most prominent techniques in the field of Machine Learning (ML), offering improved accuracy, robustness, and generalization by combining multiple models (Dietterich, 2000; Ganaie et al., 2022; Zhou, 2012).'
const AUTHOR_NODE = /Dietterich|Ganaie|Zhou|Smith|Jones|^al\.$/

const TARGET_ANALYSIS = parsed(
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

const SIMPLE_ANALYSIS = parsed(
  'The ensemble improves accuracy by combining multiple models.',
  [
    [1, 'The', 'DET', 2, 'det', 0, 3],
    [2, 'ensemble', 'NOUN', 3, 'nsubj', 4, 12],
    [3, 'improves', 'VERB', 0, 'root', 13, 21],
    [4, 'accuracy', 'NOUN', 3, 'obj', 22, 30],
    [5, 'by', 'SCONJ', 6, 'mark', 31, 33],
    [6, 'combining', 'VERB', 3, 'advcl', 34, 43],
    [7, 'multiple', 'ADJ', 8, 'amod', 44, 52],
    [8, 'models', 'NOUN', 6, 'obj', 53, 59],
    [9, '.', 'PUNCT', 3, 'punct', 59, 60],
  ],
)

describe('removeCitationMarkersForAnalysis -- parenthetical author-year citations', () => {
  it.each([
    '(Smith, 2020)',
    '(Smith et al., 2020)',
    '(Smith et al. 2020)',
    '(Smith, 2020; Jones, 2021)',
    '(Smith et al., 2020; Jones & Brown, 2021)',
    '(Jones and Brown, 2021)',
    '(Smith, 2019, 2020)',
    '(Li, 2021a)',
    '(Dietterich, 2000; Ganaie et al., 2022; Zhou, 2012)',
  ])('removes %s together with its leading space', (citation) => {
    expect(removeCitationMarkersForAnalysis(`The models ${citation} were used.`)).toBe('The models were used.')
  })

  it.each(['(van der Meer, 2019)', "(O'Connor, 2018)", '(García et al., 2022)', '(de la Cruz et al., 2020)'])(
    'handles surname shape %s (particles, apostrophes, non-ASCII letters)',
    (citation) => {
      expect(removeCitationMarkersForAnalysis(`The models ${citation} were used.`)).toBe('The models were used.')
    },
  )

  it.each(['(2000)', '(n = 2000)', '(ML)', '(Fig. 2)', '(Table 3)', '(A and B)', '(Smith)', '(2020–2022)', '(Machine Learning, 2020)'])(
    'never removes the ordinary parenthetical %s',
    (parenthetical) => {
      const text = `The models ${parenthetical} were used.`
      expect(removeCitationMarkersForAnalysis(text)).toBe(text)
    },
  )

  it('keeps ordinary year expressions and narrative citations', () => {
    expect(removeCitationMarkersForAnalysis('Data from 2020 to 2022 were used in 2020.')).toBe('Data from 2020 to 2022 were used in 2020.')
    expect(removeCitationMarkersForAnalysis('Smith et al. (2020) showed this.')).toBe('Smith et al. (2020) showed this.')
  })

  it('leaves no stray space before following punctuation and handles a sentence-initial citation', () => {
    expect(removeCitationMarkersForAnalysis('models (Smith, 2020), which work.')).toBe('models, which work.')
    expect(removeCitationMarkersForAnalysis('(Smith, 2020) This opens the sentence.')).toBe('This opens the sentence.')
  })

  it('combines with numeric citation removal in the same sentence', () => {
    expect(removeCitationMarkersForAnalysis('This was studied [9] (Smith, 2020).')).toBe('This was studied.')
  })
})

describe('projectSentenceForGrammarAnalysis -- author-year citation removal keeps the source mapping exact', () => {
  it('produces the same text as the string pipeline and maps every surviving character to its own source character', () => {
    const projection = projectSentenceForGrammarAnalysis(TARGET_SOURCE)
    expect(projection.text).toBe(normalizeSentenceForGrammarAnalysis(TARGET_SOURCE))
    expect(projection.text).toBe(TARGET_ANALYSIS.text)
    expect(projection.sourceIndexOf).toHaveLength(projection.text.length)
    for (let i = 0; i < projection.text.length; i++) {
      const sourceIndex = projection.sourceIndexOf[i]
      expect(sourceIndex).not.toBeNull()
      expect(TARGET_SOURCE[sourceIndex!]).toBe(projection.text[i])
    }
  })

  it('maps "multiple models" and the closing period across the removed citation', () => {
    const projection = projectSentenceForGrammarAnalysis(TARGET_SOURCE)
    const at = projection.text.indexOf('multiple models')
    const sourceStart = projection.sourceIndexOf[at]!
    expect(TARGET_SOURCE.slice(sourceStart, sourceStart + 'multiple models'.length)).toBe('multiple models')
    expect(projection.sourceIndexOf[projection.text.length - 1]).toBe(TARGET_SOURCE.length - 1)
  })
})

describe('author-year citations never reach Basic Skeleton or Structure Tree', () => {
  it.each(['(Smith, 2020)', '(Smith et al., 2020)', '(Smith, 2020; Jones, 2021)'])(
    '%s: analysis text, core and Tree carry no citation; "multiple models" survives',
    (citation) => {
      const analysis = projectSentenceForGrammarAnalysis(`The ensemble improves accuracy by combining multiple models ${citation}.`).text
      expect(analysis).toBe(SIMPLE_ANALYSIS.text)
      const { coreSet } = buildSentenceCoreSetFromStanzaTokens(SIMPLE_ANALYSIS.text, SIMPLE_ANALYSIS.tokens)
      const core = coreSet.predicateCores[0]!
      for (const span of [coreSet.subject, core.verb, core.object, core.complement]) expect(span?.text ?? '').not.toMatch(/Smith|Jones|\d{4}/)
      const nodes = flatten(buildStanzaHierarchicalTree(SIMPLE_ANALYSIS.text, SIMPLE_ANALYSIS.tokens))
      expect(nodes.filter((n) => AUTHOR_NODE.test(n.text))).toEqual([])
      expect(nodes.some((n) => n.text.includes('multiple models'))).toBe(true)
    },
  )

  it('target sentence: SVC core is unchanged and carries no citation text', () => {
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(TARGET_ANALYSIS.text, TARGET_ANALYSIS.tokens)
    const core = coreSet.predicateCores[0]!
    expect({ subject: coreSet.subject?.text, verb: core.verb?.text, complement: core.complement?.text, pattern: core.pattern }).toEqual({
      subject: 'ensemble learning',
      verb: 'has become',
      complement: 'one of the most prominent techniques in the field of Machine Learning (ML)',
      pattern: 'SVC',
    })
  })

  it('target sentence: "multiple models" is an object node with no author coordination members', () => {
    const nodes = flatten(buildStanzaHierarchicalTree(TARGET_ANALYSIS.text, TARGET_ANALYSIS.tokens))
    expect(nodes.filter((n) => AUTHOR_NODE.test(n.text))).toEqual([])
    const object = nodes.find((n) => n.role === 'object' && n.text === 'multiple models')
    expect(object).toBeDefined()
    expect(object!.children).toEqual([])
  })
})
