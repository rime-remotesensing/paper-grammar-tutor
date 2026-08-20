import { describe, expect, it } from 'vitest'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.6C4.2A -- Citation-Safe Colon Enumeration Repair. Fixtures are hand-
 * transcribed from real Stanza parses (see phase diagnostic) -- the failure class is
 * specifically the raw dependency pattern where ONE list item's own head simultaneously
 * roots a genuine next-item `conj` AND a citation `appos`, which only real parser output
 * reliably reproduces.
 */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

/** The exact live diagnostic control: "The landslide causal factors for LSM can be
 * classified into two categories: causative factors and trigger factors (Mandal et al.
 * 2021)." -- raw tokens transcribed verbatim from the real Stanza parse. */
function twoMemberWithTrailingCitationTokens(): { text: string; tokens: StanzaToken[] } {
  const text = 'The landslide causal factors for LSM can be classified into two categories: causative factors and trigger factors (Mandal et al. 2021).'
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
    tok({ id: 19, text: '(', upos: 'PUNCT', head: 20, deprel: 'punct', start: 114, end: 115 }),
    // "Mandal" is a SECOND, independent `appos` of the FIRST list item's own head (15) --
    // the same token "trigger factors" (18) conj's from. This is the exact structural
    // ambiguity the repair resolves: one head simultaneously roots a genuine next-item
    // `conj` and a citation `appos`.
    tok({ id: 20, text: 'Mandal', upos: 'PROPN', head: 15, deprel: 'appos', start: 115, end: 121 }),
    tok({ id: 21, text: 'et', upos: 'X', head: 22, deprel: 'cc', start: 122, end: 124 }),
    tok({ id: 22, text: 'al.', upos: 'X', head: 20, deprel: 'conj', start: 125, end: 128 }),
    tok({ id: 23, text: '2021', upos: 'NUM', head: 20, deprel: 'nmod:unmarked', start: 129, end: 133 }),
    tok({ id: 24, text: ')', upos: 'PUNCT', head: 20, deprel: 'punct', start: 133, end: 134 }),
    tok({ id: 25, text: '.', upos: 'PUNCT', head: 9, deprel: 'punct', start: 134, end: 135 }),
  ]
  return { text, tokens }
}

describe('Prototype 2.6G2.6C4.2A -- citation-safe colon enumeration (live control + generalized fixtures)', () => {
  it('LIVE CONTROL: two-member list + trailing citation on the SAME head that roots the next-item conj -- both genuine members recovered, no bogus citation-fragment member', () => {
    const { text, tokens } = twoMemberWithTrailingCitationTokens()
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    const enumeration = flat.find((n) => n.role === 'enumeration')
    expect(enumeration).toBeDefined()
    expect(enumeration!.children.map((c) => c.text)).toEqual(['causative factors', 'trigger factors'])
    // No fragment of the citation ever becomes its own list member.
    expect(flat.some((n) => n.text === 'al.' || n.text.includes('Mandal'))).toBe(false)
    // Single owner: exactly one enumeration, exactly two members, no duplicate outer clause.
    expect(flat.filter((n) => n.role === 'enumeration')).toHaveLength(1)
  })

  it('three-member list + trailing citation on the final member\'s own head', () => {
    const text =
      'The factors can be classified into three categories: geological factors, hydrological factors, and anthropogenic factors (Smith et al. 2019).'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'factors', upos: 'NOUN', head: 5, deprel: 'nsubj:pass', start: 4, end: 11 }),
      tok({ id: 3, text: 'can', upos: 'AUX', head: 5, deprel: 'aux', start: 12, end: 15 }),
      tok({ id: 4, text: 'be', upos: 'AUX', head: 5, deprel: 'aux:pass', start: 16, end: 18 }),
      tok({ id: 5, text: 'classified', upos: 'VERB', head: 0, deprel: 'root', start: 19, end: 29 }),
      tok({ id: 6, text: 'into', upos: 'ADP', head: 8, deprel: 'case', start: 30, end: 34 }),
      tok({ id: 7, text: 'three', upos: 'NUM', head: 8, deprel: 'nummod', start: 35, end: 40 }),
      tok({ id: 8, text: 'categories', upos: 'NOUN', head: 5, deprel: 'obl', start: 41, end: 51 }),
      tok({ id: 9, text: ':', upos: 'PUNCT', head: 11, deprel: 'punct', start: 51, end: 52 }),
      tok({ id: 10, text: 'geological', upos: 'ADJ', head: 11, deprel: 'amod', start: 53, end: 63 }),
      tok({ id: 11, text: 'factors', upos: 'NOUN', head: 8, deprel: 'appos', start: 64, end: 71 }),
      tok({ id: 12, text: ',', upos: 'PUNCT', head: 14, deprel: 'punct', start: 71, end: 72 }),
      tok({ id: 13, text: 'hydrological', upos: 'ADJ', head: 14, deprel: 'amod', start: 73, end: 85 }),
      tok({ id: 14, text: 'factors', upos: 'NOUN', head: 11, deprel: 'conj', start: 86, end: 93 }),
      tok({ id: 15, text: ',', upos: 'PUNCT', head: 18, deprel: 'punct', start: 93, end: 94 }),
      tok({ id: 16, text: 'and', upos: 'CCONJ', head: 18, deprel: 'cc', start: 95, end: 98 }),
      tok({ id: 17, text: 'anthropogenic', upos: 'ADJ', head: 18, deprel: 'amod', start: 99, end: 112 }),
      // "factors" (item 3) is `conj` of "factors" (item 2's own head, 14) -- and item 3's own
      // head simultaneously roots the trailing citation appositive below, mirroring the live
      // control's exact ambiguity but on the LAST member instead of the first.
      tok({ id: 18, text: 'factors', upos: 'NOUN', head: 14, deprel: 'conj', start: 113, end: 120 }),
      tok({ id: 19, text: '(', upos: 'PUNCT', head: 20, deprel: 'punct', start: 121, end: 122 }),
      tok({ id: 20, text: 'Smith', upos: 'PROPN', head: 18, deprel: 'appos', start: 122, end: 127 }),
      tok({ id: 21, text: 'et', upos: 'X', head: 22, deprel: 'cc', start: 128, end: 130 }),
      tok({ id: 22, text: 'al.', upos: 'X', head: 20, deprel: 'conj', start: 131, end: 134 }),
      tok({ id: 23, text: '2019', upos: 'NUM', head: 20, deprel: 'nmod:unmarked', start: 135, end: 139 }),
      tok({ id: 24, text: ')', upos: 'PUNCT', head: 20, deprel: 'punct', start: 139, end: 140 }),
      tok({ id: 25, text: '.', upos: 'PUNCT', head: 5, deprel: 'punct', start: 140, end: 141 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    const enumeration = flat.find((n) => n.role === 'enumeration')
    expect(enumeration).toBeDefined()
    expect(enumeration!.children.map((c) => c.text)).toEqual(['geological factors', 'hydrological factors', 'anthropogenic factors'])
    expect(flat.some((n) => n.text === 'al.' || n.text.includes('Smith'))).toBe(false)
  })

  it('first item with genuine non-citation apposition (a defining parenthetical abbreviation) is preserved, never mistaken for a citation', () => {
    const text = 'The dataset can be divided into two categories: the digital elevation model (DEM) and the land cover map.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'dataset', upos: 'NOUN', head: 5, deprel: 'nsubj:pass', start: 4, end: 11 }),
      tok({ id: 3, text: 'can', upos: 'AUX', head: 5, deprel: 'aux', start: 12, end: 15 }),
      tok({ id: 4, text: 'be', upos: 'AUX', head: 5, deprel: 'aux:pass', start: 16, end: 18 }),
      tok({ id: 5, text: 'divided', upos: 'VERB', head: 0, deprel: 'root', start: 19, end: 26 }),
      tok({ id: 6, text: 'into', upos: 'ADP', head: 8, deprel: 'case', start: 27, end: 31 }),
      tok({ id: 7, text: 'two', upos: 'NUM', head: 8, deprel: 'nummod', start: 32, end: 35 }),
      tok({ id: 8, text: 'categories', upos: 'NOUN', head: 5, deprel: 'obl', start: 36, end: 46 }),
      tok({ id: 9, text: ':', upos: 'PUNCT', head: 13, deprel: 'punct', start: 46, end: 47 }),
      tok({ id: 10, text: 'the', upos: 'DET', head: 13, deprel: 'det', start: 48, end: 51 }),
      tok({ id: 11, text: 'digital', upos: 'ADJ', head: 12, deprel: 'amod', start: 52, end: 59 }),
      tok({ id: 12, text: 'elevation', upos: 'NOUN', head: 13, deprel: 'compound', start: 60, end: 69 }),
      tok({ id: 13, text: 'model', upos: 'NOUN', head: 8, deprel: 'appos', start: 70, end: 75 }),
      tok({ id: 14, text: '(', upos: 'PUNCT', head: 15, deprel: 'punct', start: 76, end: 77 }),
      tok({ id: 15, text: 'DEM', upos: 'PROPN', head: 13, deprel: 'appos', start: 77, end: 80 }),
      tok({ id: 16, text: ')', upos: 'PUNCT', head: 15, deprel: 'punct', start: 80, end: 81 }),
      tok({ id: 17, text: 'and', upos: 'CCONJ', head: 21, deprel: 'cc', start: 82, end: 85 }),
      tok({ id: 18, text: 'the', upos: 'DET', head: 21, deprel: 'det', start: 86, end: 89 }),
      tok({ id: 19, text: 'land', upos: 'NOUN', head: 20, deprel: 'compound', start: 90, end: 94 }),
      tok({ id: 20, text: 'cover', upos: 'NOUN', head: 21, deprel: 'compound', start: 95, end: 100 }),
      tok({ id: 21, text: 'map', upos: 'NOUN', head: 13, deprel: 'conj', start: 101, end: 104 }),
      tok({ id: 22, text: '.', upos: 'PUNCT', head: 5, deprel: 'punct', start: 104, end: 105 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    const enumeration = flat.find((n) => n.role === 'enumeration')
    expect(enumeration).toBeDefined()
    expect(enumeration!.children.map((c) => c.text)).toEqual(['the digital elevation model (DEM)', 'the land cover map'])
  })

  it('nested nmod drift (regression: the previously-fixed "zone with steep slopes" class) is unaffected by removing `appos` from the loose-gateway set', () => {
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

  it('explanation-after-colon negative -- no fake enumeration', () => {
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
    expect(flatten(tree).some((n) => n.role === 'enumeration')).toBe(false)
  })

  it('single-clause-after-colon negative -- no fake enumeration', () => {
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
    expect(flatten(tree).some((n) => n.role === 'enumeration')).toBe(false)
  })

  it('ratio 7:3 negative -- one token, no fake enumeration', () => {
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
    expect(flatten(tree).some((n) => n.role === 'enumeration')).toBe(false)
  })

  it('citation parenthetical elsewhere in the sentence (not attached to any list-item head) never fabricates a bogus member', () => {
    const text = 'The model, as shown in prior work (Lee et al. 2020), can be classified into two categories: causative factors and trigger factors.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'model', upos: 'NOUN', head: 12, deprel: 'nsubj:pass', start: 4, end: 9 }),
      tok({ id: 3, text: ',', upos: 'PUNCT', head: 7, deprel: 'punct', start: 9, end: 10 }),
      tok({ id: 4, text: 'as', upos: 'SCONJ', head: 5, deprel: 'mark', start: 11, end: 13 }),
      tok({ id: 5, text: 'shown', upos: 'VERB', head: 2, deprel: 'advcl', start: 14, end: 19 }),
      tok({ id: 6, text: 'in', upos: 'ADP', head: 8, deprel: 'case', start: 20, end: 22 }),
      tok({ id: 7, text: 'prior', upos: 'ADJ', head: 8, deprel: 'amod', start: 23, end: 28 }),
      tok({ id: 8, text: 'work', upos: 'NOUN', head: 5, deprel: 'obl', start: 29, end: 33 }),
      tok({ id: 9, text: '(', upos: 'PUNCT', head: 10, deprel: 'punct', start: 34, end: 35 }),
      tok({ id: 10, text: 'Lee', upos: 'PROPN', head: 8, deprel: 'appos', start: 35, end: 38 }),
      tok({ id: 11, text: 'et', upos: 'X', head: 12, deprel: 'cc', start: 39, end: 41 }),
      tok({ id: 12, text: 'al.', upos: 'X', head: 10, deprel: 'conj', start: 42, end: 45 }),
      tok({ id: 13, text: '2020', upos: 'NUM', head: 10, deprel: 'nmod:unmarked', start: 46, end: 50 }),
      tok({ id: 14, text: ')', upos: 'PUNCT', head: 10, deprel: 'punct', start: 50, end: 51 }),
      tok({ id: 15, text: ',', upos: 'PUNCT', head: 2, deprel: 'punct', start: 51, end: 52 }),
      tok({ id: 16, text: 'can', upos: 'AUX', head: 18, deprel: 'aux', start: 53, end: 56 }),
      tok({ id: 17, text: 'be', upos: 'AUX', head: 18, deprel: 'aux:pass', start: 57, end: 59 }),
      tok({ id: 18, text: 'classified', upos: 'VERB', head: 0, deprel: 'root', start: 60, end: 70 }),
      tok({ id: 19, text: 'into', upos: 'ADP', head: 21, deprel: 'case', start: 71, end: 75 }),
      tok({ id: 20, text: 'two', upos: 'NUM', head: 21, deprel: 'nummod', start: 76, end: 79 }),
      tok({ id: 21, text: 'categories', upos: 'NOUN', head: 18, deprel: 'obl', start: 80, end: 90 }),
      tok({ id: 22, text: ':', upos: 'PUNCT', head: 24, deprel: 'punct', start: 90, end: 91 }),
      tok({ id: 23, text: 'causative', upos: 'ADJ', head: 24, deprel: 'amod', start: 92, end: 101 }),
      tok({ id: 24, text: 'factors', upos: 'NOUN', head: 21, deprel: 'appos', start: 102, end: 109 }),
      tok({ id: 25, text: 'and', upos: 'CCONJ', head: 27, deprel: 'cc', start: 110, end: 113 }),
      tok({ id: 26, text: 'trigger', upos: 'NOUN', head: 27, deprel: 'compound', start: 114, end: 121 }),
      tok({ id: 27, text: 'factors', upos: 'NOUN', head: 24, deprel: 'conj', start: 122, end: 129 }),
      tok({ id: 28, text: '.', upos: 'PUNCT', head: 18, deprel: 'punct', start: 129, end: 130 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    const enumeration = flat.find((n) => n.role === 'enumeration')
    expect(enumeration).toBeDefined()
    expect(enumeration!.children.map((c) => c.text)).toEqual(['causative factors', 'trigger factors'])
    expect(flat.some((n) => n.text.includes('Lee') || n.text === 'al.')).toBe(false)
  })
})
