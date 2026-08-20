import { describe, expect, it } from 'vitest'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import { layoutSiblingsWithCoordinationGroups } from '../../src/features/grammar/domain/coordinationGroupPresentation.ts'
import { buildSentenceCoreSetFromStanzaTokens } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.6C4.3 -- Recover Canonically-Excluded Non-Core NMOD Supplements.
 *
 * C3's canonical authority (`collectConstituentTokens`'s `RESTRICTIVE_GATED` set,
 * stanzaSyntaxAuthority.ts, frozen) correctly excludes a comma-set-off `nmod` supplement
 * (e.g. "Relevant data, INCLUDING a digital elevation model, ..., were collected") from
 * SentenceCoreSet -- confirmed correct, canonical S stays exactly "Relevant data". But the
 * Tree builder shares that SAME authority helper for its own constituent grounding
 * (`collectConstituentTokens` inside `buildDecomposedConstituentNode`), so the excluded
 * supplement was previously invisible to the Tree entirely -- not just excluded from the
 * canonical slot, but never reachable by any Tree presentation logic at all.
 *
 * The repair re-derives the EXACT SAME structural exclusion criterion authority uses
 * (`dep === 'nmod'` + `hasCommaBetween`, both already-exported authority helpers -- zero
 * independent reinvention of "what counts as non-restrictive"), then recovers the excluded
 * nmod subtree as an ADDITIVE, Tree-only 'supplement' child of the canonical constituent,
 * reusing the EXISTING enumeration-item-grounding machinery (`buildOneEnumerationItem`,
 * factored out of `buildEnumerationChildren`) for its own member discovery -- zero duplicated
 * parsing logic. The canonical constituent's own authority text/start/end are never touched.
 *
 * Fixtures use the exact raw-Stanza dependency shape confirmed by live diagnostic.
 */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

function seq(text: string) {
  let cursor = 0
  return (word: string) => {
    const start = text.indexOf(word, cursor)
    if (start === -1) throw new Error(`"${word}" not found from position ${cursor} in "${text}"`)
    cursor = start + word.length
    return { start, end: cursor }
  }
}

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

/** Appends a "Name et al. Year" citation subtree as an `appos` child of `attachTo`. */
function pushCitation(tokens: StanzaToken[], next: ReturnType<typeof seq>, attachTo: number, nextId: number, name: string, year: string): number {
  const pName = next(name)
  const pEt = next('et')
  const pAl = next('al.')
  const pYear = next(year)
  tokens.push(
    tok({ id: nextId, text: name, upos: 'PROPN', head: attachTo, deprel: 'appos', ...pName }),
    tok({ id: nextId + 1, text: 'et', upos: 'X', head: nextId + 2, deprel: 'cc', ...pEt }),
    tok({ id: nextId + 2, text: 'al.', upos: 'X', head: nextId, deprel: 'conj', ...pAl }),
    tok({ id: nextId + 3, text: year, upos: 'NUM', head: nextId, deprel: 'nmod:unmarked', ...pYear }),
  )
  return nextId + 4
}

/** Builds "Data, including A[, B[, and C]], were collected." matching the exact live-
 * confirmed topology: item1 ("A") is the nmod head itself (case-marked by "including"),
 * subsequent items are its own `conj` chain, with an optional citation on any item. */
function buildSupplementFixture(items: string[], citationOn: ReadonlySet<number> = new Set()): { text: string; tokens: StanzaToken[] } {
  const citeNames = ['Lee', 'Smith', 'Kim'] as const
  const citeYears = ['2019', '2020', '2021'] as const
  let text = 'Data, including'
  items.forEach((item, i) => {
    text += i === 0 ? ` ${item}` : i === items.length - 1 ? `, and ${item}` : `, ${item}`
    if (citationOn.has(i)) text += ` (${citeNames[i % 3]} et al. ${citeYears[i % 3]})`
  })
  text += ', were collected.'

  const next = seq(text)
  const pData = next('Data')
  const pC1 = next(',')
  const pIncluding = next('including')
  const item0Words = items[0]!.split(' ')
  const item0LastId = 4 + item0Words.length - 1
  const tokens: StanzaToken[] = [
    tok({ id: 1, text: 'Data', upos: 'NOUN', head: 0, deprel: 'nsubj:pass', ...pData }),
    tok({ id: 2, text: ',', upos: 'PUNCT', head: item0LastId, deprel: 'punct', ...pC1 }),
    tok({ id: 3, text: 'including', upos: 'VERB', head: item0LastId, deprel: 'case', ...pIncluding }),
  ]
  let nextId = 4
  let prevItemLastId = 0
  item0Words.forEach((w, i) => {
    const p = next(w)
    const isLast = i === item0Words.length - 1
    tokens.push(tok({ id: nextId, text: w, upos: isLast ? 'NOUN' : 'ADJ', head: isLast ? 1 : item0LastId, deprel: isLast ? 'nmod' : 'amod', ...p }))
    if (isLast) prevItemLastId = nextId
    nextId += 1
  })
  if (citationOn.has(0)) nextId = pushCitation(tokens, next, prevItemLastId, nextId, citeNames[0], citeYears[0])

  for (let i = 1; i < items.length; i++) {
    next(',')
    const isFinal = i === items.length - 1
    let connId: number | null = null
    if (isFinal) {
      const pConn = next('and')
      connId = nextId
      nextId += 1
      tokens.push(tok({ id: connId, text: 'and', upos: 'CCONJ', head: -1, deprel: 'cc', ...pConn })) // head patched after item's last id is known
    }
    const words = items[i]!.split(' ')
    const itemLastId = nextId + words.length - 1
    if (connId !== null) tokens[tokens.length - 1]!.head = itemLastId
    words.forEach((w, wi) => {
      const p = next(w)
      const isLast = wi === words.length - 1
      tokens.push(tok({ id: nextId, text: w, upos: isLast ? 'NOUN' : 'ADJ', head: isLast ? item0LastId : itemLastId, deprel: isLast ? 'conj' : 'amod', ...p }))
      if (isLast) prevItemLastId = nextId
      nextId += 1
    })
    if (citationOn.has(i)) nextId = pushCitation(tokens, next, prevItemLastId, nextId, citeNames[i % 3], citeYears[i % 3])
  }

  const pC2 = next(',')
  const pWere = next('were')
  const pCollected = next('collected')
  const pDot = next('.')
  const rootId = nextId + 1
  tokens.push(
    tok({ id: nextId, text: ',', upos: 'PUNCT', head: 1, deprel: 'punct', ...pC2 }),
    tok({ id: nextId + 1, text: 'were', upos: 'AUX', head: rootId, deprel: 'aux:pass', ...pWere }),
    tok({ id: rootId, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', ...pCollected }),
    tok({ id: rootId + 1, text: '.', upos: 'PUNCT', head: rootId, deprel: 'punct', ...pDot }),
  )
  tokens[0]!.head = rootId
  return { text, tokens }
}

function supplementOf(text: string, tokens: StanzaToken[]) {
  const tree = buildStanzaHierarchicalTree(text, tokens)
  const flat = flatten(tree)
  return { tree, flat, supplement: flat.find((n) => n.role === 'supplement') ?? null, subject: tree[0]! }
}

describe('Prototype 2.6G2.6C4.3 -- recover non-core nmod supplements', () => {
  it('(1) short comma-set-off nmod supplement (single member)', () => {
    const { text, tokens } = buildSupplementFixture(['elevation models'])
    const { supplement, subject } = supplementOf(text, tokens)
    expect(supplement).not.toBeNull()
    expect(supplement!.children.map((c) => c.text)).toEqual(['elevation models'])
    expect(subject.text).toBe('Data') // canonical authority untouched
  })

  it('(2) two-member supplement', () => {
    const { text, tokens } = buildSupplementFixture(['elevation models', 'road maps'])
    const { supplement } = supplementOf(text, tokens)
    expect(supplement!.children.map((c) => c.text)).toEqual(['elevation models', 'road maps'])
    expect(supplement!.children[1]!.connector?.text).toBe('and')
  })

  it('(3) three-member supplement', () => {
    const { text, tokens } = buildSupplementFixture(['elevation models', 'road maps', 'imagery'])
    const { supplement } = supplementOf(text, tokens)
    expect(supplement!.children.map((c) => c.text)).toEqual(['elevation models', 'road maps', 'imagery'])
    expect(supplement!.children[0]!.connector).toBeUndefined()
    expect(supplement!.children[1]!.connector).toBeUndefined()
    expect(supplement!.children[2]!.connector?.text).toBe('and')
  })

  it('(4) seven-member supplement -- the exact live diagnostic control', () => {
    const text =
      'Relevant data, including a digital elevation model (DEM), geological maps, road network data, hydrological network data, rainfall data (Glade et al. 2000), satellite imagery, and land use data (Glade 2003), were collected.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Relevant', upos: 'ADJ', head: 2, deprel: 'amod', start: 0, end: 8 }),
      tok({ id: 2, text: 'data', upos: 'NOUN', head: 46, deprel: 'nsubj:pass', start: 9, end: 13 }),
      tok({ id: 3, text: ',', upos: 'PUNCT', head: 8, deprel: 'punct', start: 13, end: 14 }),
      tok({ id: 4, text: 'including', upos: 'VERB', head: 8, deprel: 'case', start: 15, end: 24 }),
      tok({ id: 5, text: 'a', upos: 'DET', head: 8, deprel: 'det', start: 25, end: 26 }),
      tok({ id: 6, text: 'digital', upos: 'ADJ', head: 7, deprel: 'amod', start: 27, end: 34 }),
      tok({ id: 7, text: 'elevation', upos: 'NOUN', head: 8, deprel: 'compound', start: 35, end: 44 }),
      tok({ id: 8, text: 'model', upos: 'NOUN', head: 2, deprel: 'nmod', start: 45, end: 50 }),
      tok({ id: 9, text: '(', upos: 'PUNCT', head: 10, deprel: 'punct', start: 51, end: 52 }),
      tok({ id: 10, text: 'DEM', upos: 'PROPN', head: 8, deprel: 'appos', start: 52, end: 55 }),
      tok({ id: 11, text: ')', upos: 'PUNCT', head: 10, deprel: 'punct', start: 55, end: 56 }),
      tok({ id: 12, text: ',', upos: 'PUNCT', head: 14, deprel: 'punct', start: 56, end: 57 }),
      tok({ id: 13, text: 'geological', upos: 'ADJ', head: 14, deprel: 'amod', start: 58, end: 68 }),
      tok({ id: 14, text: 'maps', upos: 'NOUN', head: 8, deprel: 'conj', start: 69, end: 73 }),
      tok({ id: 15, text: ',', upos: 'PUNCT', head: 18, deprel: 'punct', start: 73, end: 74 }),
      tok({ id: 16, text: 'road', upos: 'NOUN', head: 17, deprel: 'compound', start: 75, end: 79 }),
      tok({ id: 17, text: 'network', upos: 'NOUN', head: 18, deprel: 'compound', start: 80, end: 87 }),
      tok({ id: 18, text: 'data', upos: 'NOUN', head: 8, deprel: 'conj', start: 88, end: 92 }),
      tok({ id: 19, text: ',', upos: 'PUNCT', head: 22, deprel: 'punct', start: 92, end: 93 }),
      tok({ id: 20, text: 'hydrological', upos: 'ADJ', head: 21, deprel: 'amod', start: 94, end: 106 }),
      tok({ id: 21, text: 'network', upos: 'NOUN', head: 22, deprel: 'compound', start: 107, end: 114 }),
      tok({ id: 22, text: 'data', upos: 'NOUN', head: 8, deprel: 'conj', start: 115, end: 119 }),
      tok({ id: 23, text: ',', upos: 'PUNCT', head: 25, deprel: 'punct', start: 119, end: 120 }),
      tok({ id: 24, text: 'rainfall', upos: 'NOUN', head: 25, deprel: 'compound', start: 121, end: 129 }),
      tok({ id: 25, text: 'data', upos: 'NOUN', head: 8, deprel: 'conj', start: 130, end: 134 }),
      tok({ id: 26, text: '(', upos: 'PUNCT', head: 27, deprel: 'punct', start: 135, end: 136 }),
      tok({ id: 27, text: 'Glade', upos: 'PROPN', head: 25, deprel: 'appos', start: 136, end: 141 }),
      tok({ id: 28, text: 'et', upos: 'X', head: 29, deprel: 'cc', start: 142, end: 144 }),
      tok({ id: 29, text: 'al.', upos: 'X', head: 27, deprel: 'conj', start: 145, end: 148 }),
      tok({ id: 30, text: '2000', upos: 'NUM', head: 27, deprel: 'nmod:unmarked', start: 149, end: 153 }),
      tok({ id: 31, text: ')', upos: 'PUNCT', head: 27, deprel: 'punct', start: 153, end: 154 }),
      tok({ id: 32, text: ',', upos: 'PUNCT', head: 34, deprel: 'punct', start: 154, end: 155 }),
      tok({ id: 33, text: 'satellite', upos: 'NOUN', head: 34, deprel: 'compound', start: 156, end: 165 }),
      tok({ id: 34, text: 'imagery', upos: 'NOUN', head: 8, deprel: 'conj', start: 166, end: 173 }),
      tok({ id: 35, text: ',', upos: 'PUNCT', head: 39, deprel: 'punct', start: 173, end: 174 }),
      tok({ id: 36, text: 'and', upos: 'CCONJ', head: 39, deprel: 'cc', start: 175, end: 178 }),
      tok({ id: 37, text: 'land', upos: 'NOUN', head: 38, deprel: 'compound', start: 179, end: 183 }),
      tok({ id: 38, text: 'use', upos: 'NOUN', head: 39, deprel: 'compound', start: 184, end: 187 }),
      tok({ id: 39, text: 'data', upos: 'NOUN', head: 8, deprel: 'conj', start: 188, end: 192 }),
      tok({ id: 40, text: '(', upos: 'PUNCT', head: 41, deprel: 'punct', start: 193, end: 194 }),
      tok({ id: 41, text: 'Glade', upos: 'PROPN', head: 39, deprel: 'appos', start: 194, end: 199 }),
      tok({ id: 42, text: '2003', upos: 'NUM', head: 41, deprel: 'nmod:unmarked', start: 200, end: 204 }),
      tok({ id: 43, text: ')', upos: 'PUNCT', head: 41, deprel: 'punct', start: 204, end: 205 }),
      tok({ id: 44, text: ',', upos: 'PUNCT', head: 2, deprel: 'punct', start: 205, end: 206 }),
      tok({ id: 45, text: 'were', upos: 'AUX', head: 46, deprel: 'aux:pass', start: 207, end: 211 }),
      tok({ id: 46, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', start: 212, end: 221 }),
      tok({ id: 47, text: '.', upos: 'PUNCT', head: 46, deprel: 'punct', start: 221, end: 222 }),
    ]
    const { supplement, subject } = supplementOf(text, tokens)
    expect(subject.text).toBe('Relevant data')
    expect(supplement).not.toBeNull()
    expect(supplement!.marker?.text).toBe('including')
    expect(supplement!.children.map((c) => c.text)).toEqual([
      'a digital elevation model (DEM)',
      'geological maps',
      'road network data',
      'hydrological network data',
      'rainfall data',
      'satellite imagery',
      'land use data',
    ])
    expect(supplement!.children.at(-1)!.connector?.text).toBe('and')
    expect(supplement!.presentationSpan!.text.includes('Glade')).toBe(false)
    expect(supplement!.children.some((c) => c.text.includes('Glade'))).toBe(false)
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('Relevant data')
    expect(coreSet.predicateCores[0]?.pattern).toBe('SV')
  })

  it('(5) case marker visible exactly once (SUPPLEMENT_CASE_MARKER_VISIBLE_ONCE = 100%)', () => {
    const { text, tokens } = buildSupplementFixture(['elevation models', 'road maps'])
    const { supplement } = supplementOf(text, tokens)
    expect(supplement!.marker?.text).toBe('including')
    // Not baked into the container's own presentation text.
    expect(supplement!.presentationSpan!.text.startsWith('including')).toBe(false)
    // Not baked into the first member's own text.
    expect(supplement!.children[0]!.text).toBe('elevation models')
    expect(supplement!.children[0]!.text.includes('including')).toBe(false)
  })

  it('(6) final structured connector rendered exactly once through the group pipeline', () => {
    const { text, tokens } = buildSupplementFixture(['elevation models', 'road maps', 'imagery'])
    const { supplement } = supplementOf(text, tokens)
    const items = layoutSiblingsWithCoordinationGroups(text, supplement!.children)
    expect(items).toHaveLength(1)
    if (items[0]!.kind === 'group') {
      expect(items[0]!.group.boundaryConnectors.filter((c) => c === 'and')).toHaveLength(1)
    }
  })

  it('(7) middle citation -- member retained, citation excluded', () => {
    const { text, tokens } = buildSupplementFixture(['elevation models', 'road maps', 'imagery'], new Set([1]))
    const { supplement } = supplementOf(text, tokens)
    expect(supplement!.children.map((c) => c.text)).toEqual(['elevation models', 'road maps', 'imagery'])
    expect(supplement!.children.some((c) => c.text.includes('Smith'))).toBe(false)
    expect(supplement!.presentationSpan!.text.includes('Smith')).toBe(false)
  })

  it('(8) final citation -- member retained, citation excluded', () => {
    const { text, tokens } = buildSupplementFixture(['elevation models', 'road maps', 'imagery'], new Set([2]))
    const { supplement } = supplementOf(text, tokens)
    expect(supplement!.children.map((c) => c.text)).toEqual(['elevation models', 'road maps', 'imagery'])
    expect(supplement!.children.some((c) => c.text.includes('Kim'))).toBe(false)
    expect(supplement!.presentationSpan!.text.includes('Kim')).toBe(false)
  })

  it('(9) multiple citations -- all members retained', () => {
    const { text, tokens } = buildSupplementFixture(['elevation models', 'road maps', 'imagery'], new Set([0, 1, 2]))
    const { supplement } = supplementOf(text, tokens)
    expect(supplement!.children.map((c) => c.text)).toEqual(['elevation models', 'road maps', 'imagery'])
    expect(supplement!.children.some((c) => c.text.includes('Lee') || c.text.includes('Smith') || c.text.includes('Kim'))).toBe(false)
    expect(supplement!.presentationSpan!.text.includes('Lee') || supplement!.presentationSpan!.text.includes('Smith') || supplement!.presentationSpan!.text.includes('Kim')).toBe(false)
  })

  it('(19) citation parity -- identical member set with/without citations', () => {
    const withoutCitation = buildSupplementFixture(['elevation models', 'road maps', 'imagery'])
    const withCitation = buildSupplementFixture(['elevation models', 'road maps', 'imagery'], new Set([1]))
    const a = supplementOf(withoutCitation.text, withoutCitation.tokens)
    const b = supplementOf(withCitation.text, withCitation.tokens)
    expect(b.supplement!.children.map((c) => c.text)).toEqual(a.supplement!.children.map((c) => c.text))
  })

  it('(10) genuine "(DEM)" apposition retained, not treated as a citation', () => {
    const { text, tokens } = buildSupplementFixture(['elevation models'])
    // Attach a non-citation appos "DEM" directly to the last word of item 1.
    const lastWordId = tokens.find((t) => t.deprel === 'nmod')!.id
    const next = seq(text.replace(', were collected.', ' (DEM), were collected.'))
    const fullText = text.replace(', were collected.', ' (DEM), were collected.')
    void next
    const openParen = fullText.indexOf('(DEM)')
    const demTokens: StanzaToken[] = [
      tok({ id: 9000, text: '(', upos: 'PUNCT', head: 9001, deprel: 'punct', start: openParen, end: openParen + 1 }),
      tok({ id: 9001, text: 'DEM', upos: 'PROPN', head: lastWordId, deprel: 'appos', start: openParen + 1, end: openParen + 4 }),
      tok({ id: 9002, text: ')', upos: 'PUNCT', head: 9001, deprel: 'punct', start: openParen + 4, end: openParen + 5 }),
    ]
    // Shift trailing tokens' offsets to account for inserted "(DEM)" text (5 extra chars).
    const shifted = tokens.map((t) => (t.start > openParen ? { ...t, start: t.start + 5, end: t.end + 5 } : t))
    const finalTokens = [...shifted, ...demTokens].sort((a, b) => a.id - b.id)
    const { supplement } = supplementOf(fullText, finalTokens)
    expect(supplement!.children[0]!.text).toBe('elevation models (DEM)')
  })

  it('(11) restrictive nmod negative -- "parameters for the algorithm"', () => {
    const text = 'The parameters for the algorithm were estimated.'
    const next = seq(text)
    const pThe1 = next('The')
    const pParameters = next('parameters')
    const pFor = next('for')
    const pThe2 = next('the')
    const pAlgorithm = next('algorithm')
    const pWere = next('were')
    const pEstimated = next('estimated')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe1 }),
      tok({ id: 2, text: 'parameters', upos: 'NOUN', head: 7, deprel: 'nsubj:pass', ...pParameters }),
      tok({ id: 3, text: 'for', upos: 'ADP', head: 5, deprel: 'case', ...pFor }),
      tok({ id: 4, text: 'the', upos: 'DET', head: 5, deprel: 'det', ...pThe2 }),
      tok({ id: 5, text: 'algorithm', upos: 'NOUN', head: 2, deprel: 'nmod', ...pAlgorithm }),
      tok({ id: 6, text: 'were', upos: 'AUX', head: 7, deprel: 'aux:pass', ...pWere }),
      tok({ id: 7, text: 'estimated', upos: 'VERB', head: 0, deprel: 'root', ...pEstimated }),
      tok({ id: 8, text: '.', upos: 'PUNCT', head: 7, deprel: 'punct', ...pDot }),
    ]
    const { supplement, subject } = supplementOf(text, tokens)
    expect(supplement).toBeNull()
    expect(subject.text).toBe('The parameters for the algorithm')
  })

  it('(12) integral PP/nmod negative -- "model in the study area"', () => {
    const text = 'The model in the study area was evaluated.'
    const next = seq(text)
    const pThe1 = next('The')
    const pModel = next('model')
    const pIn = next('in')
    const pThe2 = next('the')
    const pStudy = next('study')
    const pArea = next('area')
    const pWas = next('was')
    const pEvaluated = next('evaluated')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe1 }),
      tok({ id: 2, text: 'model', upos: 'NOUN', head: 8, deprel: 'nsubj:pass', ...pModel }),
      tok({ id: 3, text: 'in', upos: 'ADP', head: 6, deprel: 'case', ...pIn }),
      tok({ id: 4, text: 'the', upos: 'DET', head: 6, deprel: 'det', ...pThe2 }),
      tok({ id: 5, text: 'study', upos: 'NOUN', head: 6, deprel: 'compound', ...pStudy }),
      tok({ id: 6, text: 'area', upos: 'NOUN', head: 2, deprel: 'nmod', ...pArea }),
      tok({ id: 7, text: 'was', upos: 'AUX', head: 8, deprel: 'aux:pass', ...pWas }),
      tok({ id: 8, text: 'evaluated', upos: 'VERB', head: 0, deprel: 'root', ...pEvaluated }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 8, deprel: 'punct', ...pDot }),
    ]
    const { supplement } = supplementOf(text, tokens)
    expect(supplement).toBeNull()
  })

  it('(13) nonrestrictive relative clause negative', () => {
    const text = 'The framework, which integrates data, was validated.'
    const next = seq(text)
    const pThe = next('The')
    const pFramework = next('framework')
    const pC1 = next(',')
    const pWhich = next('which')
    const pIntegrates = next('integrates')
    const pData = next('data')
    const pC2 = next(',')
    const pWas = next('was')
    const pValidated = next('validated')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'framework', upos: 'NOUN', head: 9, deprel: 'nsubj:pass', ...pFramework }),
      tok({ id: 3, text: ',', upos: 'PUNCT', head: 5, deprel: 'punct', ...pC1 }),
      tok({ id: 4, text: 'which', upos: 'PRON', head: 5, deprel: 'nsubj', ...pWhich }),
      tok({ id: 5, text: 'integrates', upos: 'VERB', head: 2, deprel: 'acl:relcl', ...pIntegrates }),
      tok({ id: 6, text: 'data', upos: 'NOUN', head: 5, deprel: 'obj', ...pData }),
      tok({ id: 7, text: ',', upos: 'PUNCT', head: 2, deprel: 'punct', ...pC2 }),
      tok({ id: 8, text: 'was', upos: 'AUX', head: 9, deprel: 'aux:pass', ...pWas }),
      tok({ id: 9, text: 'validated', upos: 'VERB', head: 0, deprel: 'root', ...pValidated }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 9, deprel: 'punct', ...pDot }),
    ]
    const { supplement } = supplementOf(text, tokens)
    expect(supplement).toBeNull()
  })

  it('(14) ordinary apposition negative -- "(VIF)"', () => {
    const text = 'The variance inflation factor (VIF) was calculated.'
    const next = seq(text)
    const pThe = next('The')
    const pVariance = next('variance')
    const pInflation = next('inflation')
    const pFactor = next('factor')
    const pOpen = next('(')
    const pVIF = next('VIF')
    const pClose = next(')')
    const pWas = next('was')
    const pCalculated = next('calculated')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 4, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'variance', upos: 'NOUN', head: 3, deprel: 'compound', ...pVariance }),
      tok({ id: 3, text: 'inflation', upos: 'NOUN', head: 4, deprel: 'compound', ...pInflation }),
      tok({ id: 4, text: 'factor', upos: 'NOUN', head: 9, deprel: 'nsubj:pass', ...pFactor }),
      tok({ id: 5, text: '(', upos: 'PUNCT', head: 6, deprel: 'punct', ...pOpen }),
      tok({ id: 6, text: 'VIF', upos: 'PROPN', head: 4, deprel: 'appos', ...pVIF }),
      tok({ id: 7, text: ')', upos: 'PUNCT', head: 6, deprel: 'punct', ...pClose }),
      tok({ id: 8, text: 'was', upos: 'AUX', head: 9, deprel: 'aux:pass', ...pWas }),
      tok({ id: 9, text: 'calculated', upos: 'VERB', head: 0, deprel: 'root', ...pCalculated }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 9, deprel: 'punct', ...pDot }),
    ]
    const { supplement } = supplementOf(text, tokens)
    expect(supplement).toBeNull()
  })

  it('(15) coordinated full clause negative -- distinct from the coordinated-clause connector path', () => {
    const text = 'The team collected the data, and they analyzed the results.'
    const next = seq(text)
    const pThe1 = next('The')
    const pTeam = next('team')
    const pCollected = next('collected')
    const pThe2 = next('the')
    const pData = next('data')
    const pComma = next(',')
    const pAnd = next('and')
    const pThey = next('they')
    const pAnalyzed = next('analyzed')
    const pThe3 = next('the')
    const pResults = next('results')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe1 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', ...pTeam }),
      tok({ id: 3, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', ...pCollected }),
      tok({ id: 4, text: 'the', upos: 'DET', head: 5, deprel: 'det', ...pThe2 }),
      tok({ id: 5, text: 'data', upos: 'NOUN', head: 3, deprel: 'obj', ...pData }),
      tok({ id: 6, text: ',', upos: 'PUNCT', head: 9, deprel: 'punct', ...pComma }),
      tok({ id: 7, text: 'and', upos: 'CCONJ', head: 9, deprel: 'cc', ...pAnd }),
      tok({ id: 8, text: 'they', upos: 'PRON', head: 9, deprel: 'nsubj', ...pThey }),
      tok({ id: 9, text: 'analyzed', upos: 'VERB', head: 3, deprel: 'conj', ...pAnalyzed }),
      tok({ id: 10, text: 'the', upos: 'DET', head: 11, deprel: 'det', ...pThe3 }),
      tok({ id: 11, text: 'results', upos: 'NOUN', head: 9, deprel: 'obj', ...pResults }),
      tok({ id: 12, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', ...pDot }),
    ]
    const { flat } = supplementOf(text, tokens)
    expect(flat.filter((n) => n.role === 'supplement')).toHaveLength(0)
    const ownSubjectWrapper = flat.find((n) => n.role === 'subject' && n.text === 'they')
    expect(ownSubjectWrapper!.connector?.text).toBe('and')
  })

  it('(16) supplement single-owner (NONCORE_SUPPLEMENT_SINGLE_OWNER = 100%)', () => {
    const { text, tokens } = buildSupplementFixture(['elevation models', 'road maps'])
    const { flat } = supplementOf(text, tokens)
    expect(flat.filter((n) => n.role === 'supplement')).toHaveLength(1)
    // The subject's own authority text never absorbs the supplement's own words.
    const subjectNode = flat.find((n) => n.role === 'subject')!
    expect(subjectNode.text).toBe('Data')
  })

  it('(17)+(18) member coverage 100%, member duplication 0', () => {
    const { text, tokens } = buildSupplementFixture(['elevation models', 'road maps', 'imagery'])
    const { supplement } = supplementOf(text, tokens)
    const texts = supplement!.children.map((c) => c.text)
    expect(texts).toEqual(['elevation models', 'road maps', 'imagery'])
    expect(new Set(texts).size).toBe(texts.length)
  })

  it('(20) Tree span grounding -- authority text/start/end remain a real contiguous source slice', () => {
    const { text, tokens } = buildSupplementFixture(['elevation models', 'road maps', 'imagery'], new Set([1]))
    const { supplement } = supplementOf(text, tokens)
    expect(supplement!.text).toBe(text.slice(supplement!.start, supplement!.end))
    for (const member of supplement!.children) {
      expect(member.text).toBe(text.slice(member.start, member.end))
    }
  })

  it('(21) colon-enumeration regression', () => {
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
      tok({ id: 20, text: 'Mandal', upos: 'PROPN', head: 15, deprel: 'appos', start: 115, end: 121 }),
      tok({ id: 21, text: 'et', upos: 'X', head: 22, deprel: 'cc', start: 122, end: 124 }),
      tok({ id: 22, text: 'al.', upos: 'X', head: 20, deprel: 'conj', start: 125, end: 128 }),
      tok({ id: 23, text: '2021', upos: 'NUM', head: 20, deprel: 'nmod:unmarked', start: 129, end: 133 }),
      tok({ id: 24, text: ')', upos: 'PUNCT', head: 20, deprel: 'punct', start: 133, end: 134 }),
      tok({ id: 25, text: '.', upos: 'PUNCT', head: 9, deprel: 'punct', start: 134, end: 135 }),
    ]
    const { flat } = supplementOf(text, tokens)
    const enumContainer = flat.find((n) => n.role === 'enumeration')
    expect(enumContainer!.children.map((c) => c.text)).toEqual(['causative factors', 'trigger factors'])
    expect(enumContainer!.children[1]!.connector?.text).toBe('and')
    expect(flat.filter((n) => n.role === 'supplement')).toHaveLength(0)
  })

  it('(22) coordinated-clause connector regression', () => {
    const text = 'The team collected the data, and they analyzed the results.'
    const next = seq(text)
    const pThe1 = next('The')
    const pTeam = next('team')
    const pCollected = next('collected')
    const pThe2 = next('the')
    const pData = next('data')
    const pComma = next(',')
    const pAnd = next('and')
    const pThey = next('they')
    const pAnalyzed = next('analyzed')
    const pThe3 = next('the')
    const pResults = next('results')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe1 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', ...pTeam }),
      tok({ id: 3, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', ...pCollected }),
      tok({ id: 4, text: 'the', upos: 'DET', head: 5, deprel: 'det', ...pThe2 }),
      tok({ id: 5, text: 'data', upos: 'NOUN', head: 3, deprel: 'obj', ...pData }),
      tok({ id: 6, text: ',', upos: 'PUNCT', head: 9, deprel: 'punct', ...pComma }),
      tok({ id: 7, text: 'and', upos: 'CCONJ', head: 9, deprel: 'cc', ...pAnd }),
      tok({ id: 8, text: 'they', upos: 'PRON', head: 9, deprel: 'nsubj', ...pThey }),
      tok({ id: 9, text: 'analyzed', upos: 'VERB', head: 3, deprel: 'conj', ...pAnalyzed }),
      tok({ id: 10, text: 'the', upos: 'DET', head: 11, deprel: 'det', ...pThe3 }),
      tok({ id: 11, text: 'results', upos: 'NOUN', head: 9, deprel: 'obj', ...pResults }),
      tok({ id: 12, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', ...pDot }),
    ]
    const { tree } = supplementOf(text, tokens)
    const items = layoutSiblingsWithCoordinationGroups(text, tree[0]!.children)
    expect(items).toHaveLength(1)
    if (items[0]!.kind === 'group') expect(items[0]!.group.boundaryConnectors).toEqual([null, 'and'])
  })

  it('(23) predicate-coordination regression -- unaffected by supplement recovery', () => {
    const text = 'The observations were collected and analyzed.'
    const next = seq(text)
    const pThe = next('The')
    const pObservations = next('observations')
    const pWere = next('were')
    const pCollected = next('collected')
    const pAnd = next('and')
    const pAnalyzed = next('analyzed')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'observations', upos: 'NOUN', head: 4, deprel: 'nsubj:pass', ...pObservations }),
      tok({ id: 3, text: 'were', upos: 'AUX', head: 4, deprel: 'aux:pass', ...pWere }),
      tok({ id: 4, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', ...pCollected }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 6, deprel: 'cc', ...pAnd }),
      tok({ id: 6, text: 'analyzed', upos: 'VERB', head: 4, deprel: 'conj', ...pAnalyzed }),
      tok({ id: 7, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', ...pDot }),
    ]
    const { flat } = supplementOf(text, tokens)
    const predicateFamily = flat.filter((n) => n.role === 'predicate' || n.role === 'coordinatedPredicate')
    expect(predicateFamily.map((n) => n.text)).toEqual(['were collected', 'analyzed'])
    expect(flat.filter((n) => n.role === 'supplement')).toHaveLength(0)
  })

  it('(24) canonical owner remains exact -- subject node start/end/text untouched by supplement recovery', () => {
    const { text, tokens } = buildSupplementFixture(['elevation models', 'road maps'])
    const { subject } = supplementOf(text, tokens)
    expect(subject.role).toBe('subject')
    expect(subject.text).toBe('Data')
    expect(subject.text).toBe(text.slice(subject.start, subject.end))
  })
})

/**
 * Prototype 2.6G2.6C4.3A -- Remove Cross-Level Supplement Lexical Duplication.
 *
 * Presentation-only follow-up. The structural recovery from C4.3 is unchanged (verified above
 * -- every member/marker/connector/citation/coverage/false-positive/regression test still
 * passes). What C4.3 got wrong was the supplement CONTAINER's own displayed text
 * (`presentationSpan.text`, what `StructureTreeView`'s generic row renderer shows via
 * `deriveStructureNodePresentation`): it was set to the full joined member aggregate, so every
 * genuine member word appeared twice -- once in the container row, once again in its own child
 * row directly below. `deriveStructureNodePresentation` returns `node.presentationSpan`
 * verbatim whenever it is set (`if (node.presentationSpan) return authority`), so the
 * duplication originated entirely in `buildNonCoreNmodSupplementNode`'s own choice of
 * `presentationSpan.text`, not in `StructureTreeView.tsx`'s generic rendering (which already
 * had a "canonical-slot node fully decomposed into coordination-member children carries
 * deliberately empty presentation text" convention -- `showNodeText` -- this phase reuses that
 * SAME existing convention rather than inventing a new one).
 *
 * The fix, `supplementHasReliableMemberCoverage`, verifies structurally (by token id/position,
 * never string-occurrence counting) that every genuine token in the recovered range is
 * accounted for by the marker, a member's own accepted token set, or a deliberately-dropped
 * citation subtree -- collapsing the container's own displayed text to '' only when true, and
 * keeping the previous flat joined-aggregate presentation as an information-preserving fallback
 * otherwise.
 */
describe('Prototype 2.6G2.6C4.3A -- remove cross-level supplement lexical duplication', () => {
  it('reliable single-member supplement: container text collapses, marker + one child remain', () => {
    const { text, tokens } = buildSupplementFixture(['elevation models'])
    const { supplement } = supplementOf(text, tokens)
    expect(supplement!.presentationSpan?.text).toBe('')
    expect(supplement!.marker?.text).toBe('including')
    expect(supplement!.children.map((c) => c.text)).toEqual(['elevation models'])
  })

  it('(12) short structured control -- two-member supplement: container text collapses, no aggregate repeated', () => {
    const { text, tokens } = buildSupplementFixture(['elevation models', 'road maps'])
    const { supplement } = supplementOf(text, tokens)
    expect(supplement!.presentationSpan?.text).toBe('')
    expect(supplement!.text.includes('elevation models')).toBe(true) // authority span untouched (grounded source slice)
    expect(supplement!.children.map((c) => c.text)).toEqual(['elevation models', 'road maps'])
    expect(supplement!.children[1]!.connector?.text).toBe('and')
  })

  it('seven-member supplement (live diagnostic control): container text collapses, no A..G aggregate repetition', () => {
    const text =
      'Relevant data, including a digital elevation model (DEM), geological maps, road network data, hydrological network data, rainfall data (Glade et al. 2000), satellite imagery, and land use data (Glade 2003), were collected.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Relevant', upos: 'ADJ', head: 2, deprel: 'amod', start: 0, end: 8 }),
      tok({ id: 2, text: 'data', upos: 'NOUN', head: 46, deprel: 'nsubj:pass', start: 9, end: 13 }),
      tok({ id: 3, text: ',', upos: 'PUNCT', head: 8, deprel: 'punct', start: 13, end: 14 }),
      tok({ id: 4, text: 'including', upos: 'VERB', head: 8, deprel: 'case', start: 15, end: 24 }),
      tok({ id: 5, text: 'a', upos: 'DET', head: 8, deprel: 'det', start: 25, end: 26 }),
      tok({ id: 6, text: 'digital', upos: 'ADJ', head: 7, deprel: 'amod', start: 27, end: 34 }),
      tok({ id: 7, text: 'elevation', upos: 'NOUN', head: 8, deprel: 'compound', start: 35, end: 44 }),
      tok({ id: 8, text: 'model', upos: 'NOUN', head: 2, deprel: 'nmod', start: 45, end: 50 }),
      tok({ id: 9, text: '(', upos: 'PUNCT', head: 10, deprel: 'punct', start: 51, end: 52 }),
      tok({ id: 10, text: 'DEM', upos: 'PROPN', head: 8, deprel: 'appos', start: 52, end: 55 }),
      tok({ id: 11, text: ')', upos: 'PUNCT', head: 10, deprel: 'punct', start: 55, end: 56 }),
      tok({ id: 12, text: ',', upos: 'PUNCT', head: 14, deprel: 'punct', start: 56, end: 57 }),
      tok({ id: 13, text: 'geological', upos: 'ADJ', head: 14, deprel: 'amod', start: 58, end: 68 }),
      tok({ id: 14, text: 'maps', upos: 'NOUN', head: 8, deprel: 'conj', start: 69, end: 73 }),
      tok({ id: 15, text: ',', upos: 'PUNCT', head: 18, deprel: 'punct', start: 73, end: 74 }),
      tok({ id: 16, text: 'road', upos: 'NOUN', head: 17, deprel: 'compound', start: 75, end: 79 }),
      tok({ id: 17, text: 'network', upos: 'NOUN', head: 18, deprel: 'compound', start: 80, end: 87 }),
      tok({ id: 18, text: 'data', upos: 'NOUN', head: 8, deprel: 'conj', start: 88, end: 92 }),
      tok({ id: 19, text: ',', upos: 'PUNCT', head: 22, deprel: 'punct', start: 92, end: 93 }),
      tok({ id: 20, text: 'hydrological', upos: 'ADJ', head: 21, deprel: 'amod', start: 94, end: 106 }),
      tok({ id: 21, text: 'network', upos: 'NOUN', head: 22, deprel: 'compound', start: 107, end: 114 }),
      tok({ id: 22, text: 'data', upos: 'NOUN', head: 8, deprel: 'conj', start: 115, end: 119 }),
      tok({ id: 23, text: ',', upos: 'PUNCT', head: 25, deprel: 'punct', start: 119, end: 120 }),
      tok({ id: 24, text: 'rainfall', upos: 'NOUN', head: 25, deprel: 'compound', start: 121, end: 129 }),
      tok({ id: 25, text: 'data', upos: 'NOUN', head: 8, deprel: 'conj', start: 130, end: 134 }),
      tok({ id: 26, text: '(', upos: 'PUNCT', head: 27, deprel: 'punct', start: 135, end: 136 }),
      tok({ id: 27, text: 'Glade', upos: 'PROPN', head: 25, deprel: 'appos', start: 136, end: 141 }),
      tok({ id: 28, text: 'et', upos: 'X', head: 29, deprel: 'cc', start: 142, end: 144 }),
      tok({ id: 29, text: 'al.', upos: 'X', head: 27, deprel: 'conj', start: 145, end: 148 }),
      tok({ id: 30, text: '2000', upos: 'NUM', head: 27, deprel: 'nmod:unmarked', start: 149, end: 153 }),
      tok({ id: 31, text: ')', upos: 'PUNCT', head: 27, deprel: 'punct', start: 153, end: 154 }),
      tok({ id: 32, text: ',', upos: 'PUNCT', head: 34, deprel: 'punct', start: 154, end: 155 }),
      tok({ id: 33, text: 'satellite', upos: 'NOUN', head: 34, deprel: 'compound', start: 156, end: 165 }),
      tok({ id: 34, text: 'imagery', upos: 'NOUN', head: 8, deprel: 'conj', start: 166, end: 173 }),
      tok({ id: 35, text: ',', upos: 'PUNCT', head: 39, deprel: 'punct', start: 173, end: 174 }),
      tok({ id: 36, text: 'and', upos: 'CCONJ', head: 39, deprel: 'cc', start: 175, end: 178 }),
      tok({ id: 37, text: 'land', upos: 'NOUN', head: 38, deprel: 'compound', start: 179, end: 183 }),
      tok({ id: 38, text: 'use', upos: 'NOUN', head: 39, deprel: 'compound', start: 184, end: 187 }),
      tok({ id: 39, text: 'data', upos: 'NOUN', head: 8, deprel: 'conj', start: 188, end: 192 }),
      tok({ id: 40, text: '(', upos: 'PUNCT', head: 41, deprel: 'punct', start: 193, end: 194 }),
      tok({ id: 41, text: 'Glade', upos: 'PROPN', head: 39, deprel: 'appos', start: 194, end: 199 }),
      tok({ id: 42, text: '2003', upos: 'NUM', head: 41, deprel: 'nmod:unmarked', start: 200, end: 204 }),
      tok({ id: 43, text: ')', upos: 'PUNCT', head: 41, deprel: 'punct', start: 204, end: 205 }),
      tok({ id: 44, text: ',', upos: 'PUNCT', head: 2, deprel: 'punct', start: 205, end: 206 }),
      tok({ id: 45, text: 'were', upos: 'AUX', head: 46, deprel: 'aux:pass', start: 207, end: 211 }),
      tok({ id: 46, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', start: 212, end: 221 }),
      tok({ id: 47, text: '.', upos: 'PUNCT', head: 46, deprel: 'punct', start: 221, end: 222 }),
    ]
    const { supplement, subject } = supplementOf(text, tokens)
    expect(subject.text).toBe('Relevant data')
    expect(supplement!.presentationSpan?.text).toBe('')
    expect(supplement!.marker?.text).toBe('including')
    expect(supplement!.children.map((c) => c.text)).toEqual([
      'a digital elevation model (DEM)',
      'geological maps',
      'road network data',
      'hydrological network data',
      'rainfall data',
      'satellite imagery',
      'land use data',
    ])
    expect(supplement!.children.at(-1)!.connector?.text).toBe('and')
  })

  it('citation-bearing supplement: container text still collapses, citations remain absent, members shown once', () => {
    const { text, tokens } = buildSupplementFixture(['elevation models', 'road maps', 'imagery'], new Set([1]))
    const { supplement } = supplementOf(text, tokens)
    expect(supplement!.presentationSpan?.text).toBe('')
    expect(supplement!.children.map((c) => c.text)).toEqual(['elevation models', 'road maps', 'imagery'])
    expect(supplement!.children.some((c) => c.text.includes('Smith'))).toBe(false)
  })

  it('(DEM) apposition coverage: container text still collapses when the only extra content is a retained genuine apposition', () => {
    const { text, tokens } = buildSupplementFixture(['elevation models'])
    const lastWordId = tokens.find((t) => t.deprel === 'nmod')!.id
    const fullText = text.replace(', were collected.', ' (DEM), were collected.')
    const openParen = fullText.indexOf('(DEM)')
    const demTokens: StanzaToken[] = [
      tok({ id: 9000, text: '(', upos: 'PUNCT', head: 9001, deprel: 'punct', start: openParen, end: openParen + 1 }),
      tok({ id: 9001, text: 'DEM', upos: 'PROPN', head: lastWordId, deprel: 'appos', start: openParen + 1, end: openParen + 4 }),
      tok({ id: 9002, text: ')', upos: 'PUNCT', head: 9001, deprel: 'punct', start: openParen + 4, end: openParen + 5 }),
    ]
    const shifted = tokens.map((t) => (t.start > openParen ? { ...t, start: t.start + 5, end: t.end + 5 } : t))
    const finalTokens = [...shifted, ...demTokens].sort((a, b) => a.id - b.id)
    const { supplement } = supplementOf(fullText, finalTokens)
    expect(supplement!.children[0]!.text).toBe('elevation models (DEM)')
    expect(supplement!.presentationSpan?.text).toBe('')
  })

  it('flat fallback control -- a genuinely uncovered (drifted) token in range keeps the flat aggregate visible, no information loss', () => {
    const text = 'Data, including elevation models, also, and road maps, were collected.'
    const next = seq(text)
    const pData = next('Data')
    const pC1 = next(',')
    const pIncluding = next('including')
    const pElevation = next('elevation')
    const pModels = next('models')
    const pC2 = next(',')
    const pAlso = next('also')
    const pC3 = next(',')
    const pAnd = next('and')
    const pRoad = next('road')
    const pMaps = next('maps')
    const pC4 = next(',')
    const pWere = next('were')
    const pCollected = next('collected')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Data', upos: 'NOUN', head: 14, deprel: 'nsubj:pass', ...pData }),
      tok({ id: 2, text: ',', upos: 'PUNCT', head: 5, deprel: 'punct', ...pC1 }),
      tok({ id: 3, text: 'including', upos: 'VERB', head: 5, deprel: 'case', ...pIncluding }),
      tok({ id: 4, text: 'elevation', upos: 'ADJ', head: 5, deprel: 'amod', ...pElevation }),
      tok({ id: 5, text: 'models', upos: 'NOUN', head: 1, deprel: 'nmod', ...pModels }),
      tok({ id: 6, text: ',', upos: 'PUNCT', head: 7, deprel: 'punct', ...pC2 }),
      // Prototype 2.6G2.6C4.3A -- a genuinely drifted token: a discourse adverb attached
      // directly to the sentence's own root verb (never reachable from the nmod chain at
      // all -- not a child of "models"/"maps", not conj/cc, not a citation), yet positioned
      // textually inside the recovered supplement's own [outerStart, outerEnd) range. No
      // member walk ever visits it, so it is genuinely UNEXPLAINED -- exactly the case
      // `supplementHasReliableMemberCoverage` must catch, keeping the flat aggregate visible
      // rather than silently hiding this content behind an empty container row.
      tok({ id: 7, text: 'also', upos: 'ADV', head: 14, deprel: 'discourse', ...pAlso }),
      tok({ id: 8, text: ',', upos: 'PUNCT', head: 11, deprel: 'punct', ...pC3 }),
      tok({ id: 9, text: 'and', upos: 'CCONJ', head: 11, deprel: 'cc', ...pAnd }),
      tok({ id: 10, text: 'road', upos: 'NOUN', head: 11, deprel: 'compound', ...pRoad }),
      tok({ id: 11, text: 'maps', upos: 'NOUN', head: 5, deprel: 'conj', ...pMaps }),
      tok({ id: 12, text: ',', upos: 'PUNCT', head: 1, deprel: 'punct', ...pC4 }),
      tok({ id: 13, text: 'were', upos: 'AUX', head: 14, deprel: 'aux:pass', ...pWere }),
      tok({ id: 14, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', ...pCollected }),
      tok({ id: 15, text: '.', upos: 'PUNCT', head: 14, deprel: 'punct', ...pDot }),
    ]
    const { supplement } = supplementOf(text, tokens)
    expect(supplement).not.toBeNull()
    expect(supplement!.children.map((c) => c.text)).toEqual(['elevation models', 'road maps'])
    // Coverage is NOT reliable ("also" is genuinely unexplained) -- the flat aggregate fallback
    // must remain visible so no content is silently lost.
    expect(supplement!.presentationSpan?.text).toBe('elevation models, road maps')
  })

  it('regression -- member coverage/duplication/citation-parity/false-positive/marker/connector gates still hold', () => {
    const withoutCitation = buildSupplementFixture(['elevation models', 'road maps', 'imagery'])
    const withCitation = buildSupplementFixture(['elevation models', 'road maps', 'imagery'], new Set([1]))
    const a = supplementOf(withoutCitation.text, withoutCitation.tokens)
    const b = supplementOf(withCitation.text, withCitation.tokens)
    expect(b.supplement!.children.map((c) => c.text)).toEqual(a.supplement!.children.map((c) => c.text))
    expect(a.supplement!.marker?.text).toBe('including')
    expect(a.supplement!.children[1]!.connector).toBeUndefined()
    expect(a.supplement!.children[2]!.connector?.text).toBe('and')
  })

  it('regression -- colon-enumeration and coordinated-clause connectors unaffected by presentation-only change', () => {
    const colonText = 'The landslide causal factors for LSM can be classified into two categories: causative factors and trigger factors.'
    const colonTokens: StanzaToken[] = [
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
    const { flat: colonFlat } = supplementOf(colonText, colonTokens)
    const enumContainer = colonFlat.find((n) => n.role === 'enumeration')
    expect(enumContainer!.children.map((c) => c.text)).toEqual(['causative factors', 'trigger factors'])
    expect(enumContainer!.children[1]!.connector?.text).toBe('and')

    const coordText = 'The team collected the data, and they analyzed the results.'
    const next = seq(coordText)
    const pThe1 = next('The')
    const pTeam = next('team')
    const pCollected = next('collected')
    const pThe2 = next('the')
    const pData = next('data')
    const pComma = next(',')
    const pAnd = next('and')
    const pThey = next('they')
    const pAnalyzed = next('analyzed')
    const pThe3 = next('the')
    const pResults = next('results')
    const pDot = next('.')
    const coordTokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe1 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', ...pTeam }),
      tok({ id: 3, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', ...pCollected }),
      tok({ id: 4, text: 'the', upos: 'DET', head: 5, deprel: 'det', ...pThe2 }),
      tok({ id: 5, text: 'data', upos: 'NOUN', head: 3, deprel: 'obj', ...pData }),
      tok({ id: 6, text: ',', upos: 'PUNCT', head: 9, deprel: 'punct', ...pComma }),
      tok({ id: 7, text: 'and', upos: 'CCONJ', head: 9, deprel: 'cc', ...pAnd }),
      tok({ id: 8, text: 'they', upos: 'PRON', head: 9, deprel: 'nsubj', ...pThey }),
      tok({ id: 9, text: 'analyzed', upos: 'VERB', head: 3, deprel: 'conj', ...pAnalyzed }),
      tok({ id: 10, text: 'the', upos: 'DET', head: 11, deprel: 'det', ...pThe3 }),
      tok({ id: 11, text: 'results', upos: 'NOUN', head: 9, deprel: 'obj', ...pResults }),
      tok({ id: 12, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', ...pDot }),
    ]
    const { tree: coordTree } = supplementOf(coordText, coordTokens)
    const items = layoutSiblingsWithCoordinationGroups(coordText, coordTree[0]!.children)
    expect(items).toHaveLength(1)
    if (items[0]!.kind === 'group') expect(items[0]!.group.boundaryConnectors).toEqual([null, 'and'])
  })
})
