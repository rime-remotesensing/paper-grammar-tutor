import { describe, expect, it } from 'vitest'
import {
  buildSentenceCoreSetFromStanzaTokens,
  stripCitationTokens,
  childrenByHead,
  type StanzaToken,
} from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'

/**
 * Prototype 2.6G2.5C4 -- Fine-Grained Canonical Citation Stripping.
 *
 * Root cause (diagnosed against a live nested-citation control -- see the phase report, not
 * reproduced here as a literal committed test): the old `stripCitationTokens` ground each of a
 * constituent head's DIRECT children's ENTIRE unbounded reachable subtree as one span, and
 * removed the whole thing the moment a citation appeared ANYWHERE inside it. A citation nested
 * two or more hops below a direct child (e.g. inside one member of a coordinated `nmod`
 * supplement) therefore took its entire, otherwise-genuine subtree down with it. This phase
 * replaces that with a bottom-up recursive prune: each node's own children are pruned of THEIR
 * nested citations first, and only the resulting (already citation-free) subtree's own token
 * text is tested for citation-likeness before its parent ever sees it -- so a genuine sibling
 * member several levels deep survives even though a citation sits several hops below the same
 * distant ancestor. `groundConstituentSpan`'s final text is then reconstructed by excising
 * exactly the removed citation subtrees' own character ranges from the source slice (never a
 * naive single min-to-max slice, which would silently re-absorb an interior citation's literal
 * characters through the character gap it leaves behind).
 *
 * Synthetic fixtures reproducing the same STRUCTURAL SHAPES, different wording -- no literal
 * live-PDF/dataset sentence is committed here. All citation fixtures use the established
 * "Name et al. Year" dependency shape (a generic `dep`/`appos` edge to a name, `conj`-chained
 * "et al.", `nmod:unmarked`-attached year) -- the same convention already used in
 * stanzaSyntaxAuthorityCitation.test.ts -- since `isCitationLike` requires either that pattern
 * or a literal `(...YYYY...)` parenthesis pair in the SELECTED span text, and bare punctuation
 * tokens are never selected by `collectConstituentTokens` in the first place.
 *
 * Prototype 2.6G2.5C4.2 -- updated for the restored Span contract (2.6G2.5C4.1 audit): a
 * constituent's authority `Span` is now ALWAYS fully source-grounded
 * (`span.text === source.slice(span.start, span.end)`), even when it contains an interior
 * citation. The citation-free rendering that used to overwrite `.text` directly is now exposed
 * separately as `subjectPresentationText` / `indirectObjectPresentationText` /
 * `objectPresentationText` / `complementPresentationText` -- `null` whenever nothing was
 * excised (render `.text` as-is), a citation-free string otherwise. See
 * stanzaSyntaxAuthorityCanonicalSpanContract.test.ts for the dedicated contract/gate tests.
 */

function displayText(span: { text: string } | null, presentationText: string | null | undefined): string | null {
  return presentationText ?? span?.text ?? null
}

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

/** Appends a "Name et al. Year" citation subtree as a `dep` child of `attachTo`, using the
 * next available ids, and returns the updated next-id counter. Mirrors the established
 * citation fixture shape from stanzaSyntaxAuthorityCitation.test.ts. */
function pushCitation(tokens: StanzaToken[], next: ReturnType<typeof seq>, attachTo: number, nextId: number, name: string, year: string): number {
  const pName = next(name)
  const pEt = next('et')
  const pAl = next('al.')
  const pYear = next(year)
  tokens.push(
    tok({ id: nextId, text: name, upos: 'PROPN', head: attachTo, deprel: 'dep', ...pName }),
    tok({ id: nextId + 1, text: 'et', upos: 'X', head: nextId + 2, deprel: 'cc', ...pEt }),
    tok({ id: nextId + 2, text: 'al.', upos: 'X', head: nextId, deprel: 'conj', ...pAl }),
    tok({ id: nextId + 3, text: year, upos: 'NUM', head: nextId, deprel: 'nmod:unmarked', ...pYear }),
  )
  return nextId + 4
}

describe('Prototype 2.6G2.5C4 -- fine-grained canonical citation stripping', () => {
  it('(1) direct citation child on the constituent head -- remains PASS', () => {
    const text = 'The effect of rainfall Smith et al. 2020 was significant.'
    const next = seq(text)
    const pThe = next('The')
    const pEffect = next('effect')
    const pOf = next('of')
    const pRainfall = next('rainfall')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'effect', upos: 'NOUN', head: 9, deprel: 'nsubj', ...pEffect }),
      tok({ id: 3, text: 'of', upos: 'ADP', head: 4, deprel: 'case', ...pOf }),
      tok({ id: 4, text: 'rainfall', upos: 'NOUN', head: 2, deprel: 'nmod', ...pRainfall }),
    ]
    let nextId = pushCitation(tokens, next, 2, 5, 'Smith', '2020')
    const pWas = next('was')
    const pSignificant = next('significant')
    const pDot = next('.')
    tokens.push(
      tok({ id: nextId, text: 'was', upos: 'AUX', head: nextId + 1, deprel: 'cop', ...pWas }),
      tok({ id: nextId + 1, text: 'significant', upos: 'ADJ', head: 0, deprel: 'root', ...pSignificant }),
      tok({ id: nextId + 2, text: '.', upos: 'PUNCT', head: nextId + 1, deprel: 'punct', ...pDot }),
    )
    tokens[1]!.head = nextId + 1
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The effect of rainfall')
  })

  /** Builds "The influence of environmental factors including A, B, and C was investigated."
   * with an optional "Name et al. Year" citation attached to a configurable subset of the
   * three coordinated members {0,1,2} -- the fixture family used by tests (2)-(6)/(8)/(12). */
  function buildDeepNmodFixture(citationMembers: ReadonlySet<0 | 1 | 2>): { text: string; tokens: StanzaToken[] } {
    const memberWords = ['rainfall', 'soiltype', 'landcover'] as const
    const citeNames = ['Lee', 'Smith', 'Kim'] as const
    const citeYears = ['2019', '2020', '2021'] as const
    let text = 'The influence of environmental factors including rainfall'
    if (citationMembers.has(0)) text += ` ${citeNames[0]} et al. ${citeYears[0]}`
    text += ', soil type'
    if (citationMembers.has(1)) text += ` ${citeNames[1]} et al. ${citeYears[1]}`
    text += ', and land cover'
    if (citationMembers.has(2)) text += ` ${citeNames[2]} et al. ${citeYears[2]}`
    text += ' was investigated.'
    void memberWords
    const next = seq(text)
    const pThe = next('The')
    const pInfluence = next('influence')
    const pOf = next('of')
    const pEnvironmental = next('environmental')
    const pFactors = next('factors')
    const pIncluding = next('including')
    const pRainfall = next('rainfall')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'influence', upos: 'NOUN', head: 0, deprel: 'nsubj:pass', ...pInfluence }),
      tok({ id: 3, text: 'of', upos: 'ADP', head: 5, deprel: 'case', ...pOf }),
      tok({ id: 4, text: 'environmental', upos: 'ADJ', head: 5, deprel: 'amod', ...pEnvironmental }),
      tok({ id: 5, text: 'factors', upos: 'NOUN', head: 2, deprel: 'nmod', ...pFactors }),
      tok({ id: 6, text: 'including', upos: 'VERB', head: 7, deprel: 'case', ...pIncluding }),
      tok({ id: 7, text: 'rainfall', upos: 'NOUN', head: 5, deprel: 'nmod', ...pRainfall }),
    ]
    let nextId = 8
    if (citationMembers.has(0)) nextId = pushCitation(tokens, next, 7, nextId, citeNames[0], citeYears[0])
    const pSoil = next('soil')
    const pType = next('type')
    const typeId = nextId + 1
    tokens.push(
      tok({ id: nextId, text: 'soil', upos: 'NOUN', head: typeId, deprel: 'compound', ...pSoil }),
      tok({ id: typeId, text: 'type', upos: 'NOUN', head: 7, deprel: 'conj', ...pType }),
    )
    nextId = typeId + 1
    if (citationMembers.has(1)) nextId = pushCitation(tokens, next, typeId, nextId, citeNames[1], citeYears[1])
    const pAnd = next('and')
    const pLand = next('land')
    const pCover = next('cover')
    const coverId = nextId + 2
    tokens.push(
      tok({ id: nextId, text: 'and', upos: 'CCONJ', head: coverId, deprel: 'cc', ...pAnd }),
      tok({ id: nextId + 1, text: 'land', upos: 'NOUN', head: coverId, deprel: 'compound', ...pLand }),
      tok({ id: coverId, text: 'cover', upos: 'NOUN', head: 7, deprel: 'conj', ...pCover }),
    )
    nextId = coverId + 1
    if (citationMembers.has(2)) nextId = pushCitation(tokens, next, coverId, nextId, citeNames[2], citeYears[2])
    const pWas = next('was')
    const pInvestigated = next('investigated')
    const pDot = next('.')
    const rootId = nextId + 1
    tokens.push(
      tok({ id: nextId, text: 'was', upos: 'AUX', head: rootId, deprel: 'aux:pass', ...pWas }),
      tok({ id: rootId, text: 'investigated', upos: 'VERB', head: 0, deprel: 'root', ...pInvestigated }),
      tok({ id: rootId + 1, text: '.', upos: 'PUNCT', head: rootId, deprel: 'punct', ...pDot }),
    )
    tokens[1]!.head = rootId
    return { text, tokens }
  }

  const EXPECTED_DEEP = 'The influence of environmental factors including rainfall, soil type, and land cover'

  it('(2) citation nested inside a retained nmod, two hops below the direct child', () => {
    const { text, tokens } = buildDeepNmodFixture(new Set([1]))
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject!.text).toBe(text.slice(coreSet.subject!.start, coreSet.subject!.end)) // authority stays grounded
    expect(displayText(coreSet.subject, coreSet.subjectPresentationText)).toBe(EXPECTED_DEEP)
  })

  it('(3) citation in the FIRST coordination member', () => {
    const { text, tokens } = buildDeepNmodFixture(new Set([0]))
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject!.text).toBe(text.slice(coreSet.subject!.start, coreSet.subject!.end))
    expect(displayText(coreSet.subject, coreSet.subjectPresentationText)).toBe(EXPECTED_DEEP)
  })

  it('(4) citation in the MIDDLE coordination member', () => {
    const { text, tokens } = buildDeepNmodFixture(new Set([1]))
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject!.text).toBe(text.slice(coreSet.subject!.start, coreSet.subject!.end))
    expect(displayText(coreSet.subject, coreSet.subjectPresentationText)).toBe(EXPECTED_DEEP)
  })

  it('(5) citation in the FINAL coordination member', () => {
    const { text, tokens } = buildDeepNmodFixture(new Set([2]))
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject!.text).toBe(text.slice(coreSet.subject!.start, coreSet.subject!.end))
    expect(displayText(coreSet.subject, coreSet.subjectPresentationText)).toBe(EXPECTED_DEEP)
  })

  it('(6) multiple nested citations (all three members)', () => {
    const { text, tokens } = buildDeepNmodFixture(new Set([0, 1, 2]))
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject!.text).toBe(text.slice(coreSet.subject!.start, coreSet.subject!.end))
    expect(displayText(coreSet.subject, coreSet.subjectPresentationText)).toBe(EXPECTED_DEEP)
  })

  it('(7) retained PP containing a citation -- "measurements from the sensor Chen et al. 2015"', () => {
    const text = 'The measurements from the sensor Chen et al. 2015 were retained.'
    const next = seq(text)
    const pThe1 = next('The')
    const pMeasurements = next('measurements')
    const pFrom = next('from')
    const pThe2 = next('the')
    const pSensor = next('sensor')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe1 }),
      tok({ id: 2, text: 'measurements', upos: 'NOUN', head: 0, deprel: 'nsubj:pass', ...pMeasurements }),
      tok({ id: 3, text: 'from', upos: 'ADP', head: 5, deprel: 'case', ...pFrom }),
      tok({ id: 4, text: 'the', upos: 'DET', head: 5, deprel: 'det', ...pThe2 }),
      tok({ id: 5, text: 'sensor', upos: 'NOUN', head: 2, deprel: 'nmod', ...pSensor }),
    ]
    let nextId = pushCitation(tokens, next, 5, 6, 'Chen', '2015')
    const pWere = next('were')
    const pRetained = next('retained')
    const pDot = next('.')
    const rootId = nextId + 1
    tokens.push(
      tok({ id: nextId, text: 'were', upos: 'AUX', head: rootId, deprel: 'aux:pass', ...pWere }),
      tok({ id: rootId, text: 'retained', upos: 'VERB', head: 0, deprel: 'root', ...pRetained }),
      tok({ id: rootId + 1, text: '.', upos: 'PUNCT', head: rootId, deprel: 'punct', ...pDot }),
    )
    tokens[1]!.head = rootId
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The measurements from the sensor')
  })

  it('(8) subject containing a nested citation', () => {
    const { text, tokens } = buildDeepNmodFixture(new Set([1]))
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject!.text).toBe(text.slice(coreSet.subject!.start, coreSet.subject!.end))
    expect(coreSet.subject?.text.includes('Smith')).toBe(true) // authority span still covers the citation
    expect(displayText(coreSet.subject, coreSet.subjectPresentationText)).toBe(EXPECTED_DEEP)
    expect(displayText(coreSet.subject, coreSet.subjectPresentationText)?.includes('Smith')).toBe(false) // presentation is citation-free
  })

  it('(9) object containing a nested citation', () => {
    const text = 'The team analyzed rainfall, soil type Smith et al. 2020, and land cover.'
    const next = seq(text)
    const pThe = next('The')
    const pTeam = next('team')
    const pAnalyzed = next('analyzed')
    const pRainfall = next('rainfall')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', ...pTeam }),
      tok({ id: 3, text: 'analyzed', upos: 'VERB', head: 0, deprel: 'root', ...pAnalyzed }),
      tok({ id: 4, text: 'rainfall', upos: 'NOUN', head: 3, deprel: 'obj', ...pRainfall }),
    ]
    const pSoil = next('soil')
    const pType = next('type')
    tokens.push(
      tok({ id: 5, text: 'soil', upos: 'NOUN', head: 6, deprel: 'compound', ...pSoil }),
      tok({ id: 6, text: 'type', upos: 'NOUN', head: 4, deprel: 'conj', ...pType }),
    )
    let nextId = pushCitation(tokens, next, 6, 7, 'Smith', '2020')
    const pAnd = next('and')
    const pLand = next('land')
    const pCover = next('cover')
    const pDot = next('.')
    tokens.push(
      tok({ id: nextId, text: 'and', upos: 'CCONJ', head: nextId + 2, deprel: 'cc', ...pAnd }),
      tok({ id: nextId + 1, text: 'land', upos: 'NOUN', head: nextId + 2, deprel: 'compound', ...pLand }),
      tok({ id: nextId + 2, text: 'cover', upos: 'NOUN', head: 4, deprel: 'conj', ...pCover }),
      tok({ id: nextId + 3, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', ...pDot }),
    )
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    const objectSpan = coreSet.predicateCores[0]!.object!
    expect(objectSpan.text).toBe(text.slice(objectSpan.start, objectSpan.end))
    expect(displayText(objectSpan, coreSet.predicateCores[0]!.objectPresentationText)).toBe('rainfall, soil type, and land cover')
  })

  it('(10) complement containing a nested citation', () => {
    const text = 'The method is accurate, reliable Smith et al. 2020, and fast.'
    const next = seq(text)
    const pThe = next('The')
    const pMethod = next('method')
    const pIs = next('is')
    const pAccurate = next('accurate')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'method', upos: 'NOUN', head: 4, deprel: 'nsubj', ...pMethod }),
      tok({ id: 3, text: 'is', upos: 'AUX', head: 4, deprel: 'cop', ...pIs }),
      tok({ id: 4, text: 'accurate', upos: 'ADJ', head: 0, deprel: 'root', ...pAccurate }),
    ]
    const pReliable = next('reliable')
    tokens.push(tok({ id: 5, text: 'reliable', upos: 'ADJ', head: 4, deprel: 'conj', ...pReliable }))
    let nextId = pushCitation(tokens, next, 5, 6, 'Smith', '2020')
    const pAnd = next('and')
    const pFast = next('fast')
    const pDot = next('.')
    tokens.push(
      tok({ id: nextId, text: 'and', upos: 'CCONJ', head: nextId + 1, deprel: 'cc', ...pAnd }),
      tok({ id: nextId + 1, text: 'fast', upos: 'ADJ', head: 4, deprel: 'conj', ...pFast }),
      tok({ id: nextId + 2, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', ...pDot }),
    )
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    const complementSpan = coreSet.predicateCores[0]!.complement!
    expect(complementSpan.text).toBe(text.slice(complementSpan.start, complementSpan.end))
    expect(displayText(complementSpan, coreSet.predicateCores[0]!.complementPresentationText)).toBe('accurate, reliable, and fast')
  })

  it('(11) citation-only candidate (nothing else to strip) is still correctly rejected', () => {
    const text = 'The result is Chen et al. 2015.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'result', upos: 'NOUN', head: 4, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: 'is', upos: 'AUX', head: 4, deprel: 'cop', start: 11, end: 13 }),
      tok({ id: 4, text: 'Chen', upos: 'PROPN', head: 0, deprel: 'root', start: 14, end: 18 }),
      tok({ id: 5, text: 'et', upos: 'X', head: 6, deprel: 'cc', start: 19, end: 21 }),
      tok({ id: 6, text: 'al.', upos: 'X', head: 4, deprel: 'conj', start: 22, end: 25 }),
      tok({ id: 7, text: '2015', upos: 'NUM', head: 4, deprel: 'nmod:unmarked', start: 26, end: 30 }),
      tok({ id: 8, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', start: 30, end: 31 }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.predicateCores[0]?.complement).toBeNull()
    expect(coreSet.predicateCores[0]?.pattern).toBe('SV')
  })

  it('(12) nonrestrictive nmod supplement (C3) + citation -- citation removed, supplement STILL excluded by the comma gate (not by citation stripping)', () => {
    const text = 'Data, including elevation models, road maps Smith et al. 2020, were collected.'
    const next = seq(text)
    const pData = next('Data')
    const pC1 = next(',')
    const pIncluding = next('including')
    const pElevation = next('elevation')
    const pModels = next('models')
    const pC2 = next(',')
    const pRoad = next('road')
    const pMaps = next('maps')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Data', upos: 'NOUN', head: 0, deprel: 'nsubj:pass', ...pData }),
      tok({ id: 2, text: ',', upos: 'PUNCT', head: 5, deprel: 'punct', ...pC1 }),
      tok({ id: 3, text: 'including', upos: 'VERB', head: 5, deprel: 'case', ...pIncluding }),
      tok({ id: 4, text: 'elevation', upos: 'NOUN', head: 5, deprel: 'compound', ...pElevation }),
      tok({ id: 5, text: 'models', upos: 'NOUN', head: 1, deprel: 'nmod', ...pModels }),
      tok({ id: 6, text: ',', upos: 'PUNCT', head: 8, deprel: 'punct', ...pC2 }),
      tok({ id: 7, text: 'road', upos: 'NOUN', head: 8, deprel: 'compound', ...pRoad }),
      tok({ id: 8, text: 'maps', upos: 'NOUN', head: 5, deprel: 'conj', ...pMaps }),
    ]
    let nextId = pushCitation(tokens, next, 8, 9, 'Smith', '2020')
    const pC3 = next(',')
    const pWere = next('were')
    const pCollected = next('collected')
    const pDot = next('.')
    const rootId = nextId + 2
    tokens.push(
      tok({ id: nextId, text: ',', upos: 'PUNCT', head: 1, deprel: 'punct', ...pC3 }),
      tok({ id: nextId + 1, text: 'were', upos: 'AUX', head: rootId, deprel: 'aux:pass', ...pWere }),
      tok({ id: rootId, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', ...pCollected }),
      tok({ id: rootId + 1, text: '.', upos: 'PUNCT', head: rootId, deprel: 'punct', ...pDot }),
    )
    tokens[0]!.head = rootId
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('Data')
  })

  it('(13) citation-free paired version of (12) -- identical canonical subject', () => {
    const text = 'Data, including elevation models, road maps, were collected.'
    const next = seq(text)
    const pData = next('Data')
    const pC1 = next(',')
    const pIncluding = next('including')
    const pElevation = next('elevation')
    const pModels = next('models')
    const pC2 = next(',')
    const pRoad = next('road')
    const pMaps = next('maps')
    const pC3 = next(',')
    const pWere = next('were')
    const pCollected = next('collected')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Data', upos: 'NOUN', head: 11, deprel: 'nsubj:pass', ...pData }),
      tok({ id: 2, text: ',', upos: 'PUNCT', head: 5, deprel: 'punct', ...pC1 }),
      tok({ id: 3, text: 'including', upos: 'VERB', head: 5, deprel: 'case', ...pIncluding }),
      tok({ id: 4, text: 'elevation', upos: 'NOUN', head: 5, deprel: 'compound', ...pElevation }),
      tok({ id: 5, text: 'models', upos: 'NOUN', head: 1, deprel: 'nmod', ...pModels }),
      tok({ id: 6, text: ',', upos: 'PUNCT', head: 8, deprel: 'punct', ...pC2 }),
      tok({ id: 7, text: 'road', upos: 'NOUN', head: 8, deprel: 'compound', ...pRoad }),
      tok({ id: 8, text: 'maps', upos: 'NOUN', head: 5, deprel: 'conj', ...pMaps }),
      tok({ id: 9, text: ',', upos: 'PUNCT', head: 1, deprel: 'punct', ...pC3 }),
      tok({ id: 10, text: 'were', upos: 'AUX', head: 11, deprel: 'aux:pass', ...pWere }),
      tok({ id: 11, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', ...pCollected }),
      tok({ id: 12, text: '.', upos: 'PUNCT', head: 11, deprel: 'punct', ...pDot }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('Data')
  })

  it('(14) parenthetical abbreviation negative -- "(VIF)" is not treated as a citation', () => {
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
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The variance inflation factor (VIF)')
  })

  it('(15) non-citation numeric parenthetical negative -- "digital elevation model (DEM)" is retained', () => {
    const text = 'The digital elevation model (DEM) was used.'
    const next = seq(text)
    const pThe = next('The')
    const pDigital = next('digital')
    const pElevation = next('elevation')
    const pModel = next('model')
    const pOpen = next('(')
    const pDEM = next('DEM')
    const pClose = next(')')
    const pWas = next('was')
    const pUsed = next('used')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 4, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'digital', upos: 'ADJ', head: 4, deprel: 'amod', ...pDigital }),
      tok({ id: 3, text: 'elevation', upos: 'NOUN', head: 4, deprel: 'compound', ...pElevation }),
      tok({ id: 4, text: 'model', upos: 'NOUN', head: 9, deprel: 'nsubj:pass', ...pModel }),
      tok({ id: 5, text: '(', upos: 'PUNCT', head: 6, deprel: 'punct', ...pOpen }),
      tok({ id: 6, text: 'DEM', upos: 'PROPN', head: 4, deprel: 'appos', ...pDEM }),
      tok({ id: 7, text: ')', upos: 'PUNCT', head: 6, deprel: 'punct', ...pClose }),
      tok({ id: 8, text: 'was', upos: 'AUX', head: 9, deprel: 'aux:pass', ...pWas }),
      tok({ id: 9, text: 'used', upos: 'VERB', head: 0, deprel: 'root', ...pUsed }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 9, deprel: 'punct', ...pDot }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The digital elevation model (DEM)')
  })

  // --------------------------------------------------------------------------------------
  // Hard gates. Both gates independently re-derive expected retained/removed token IDs from
  // the raw fixture (never by re-calling `buildSentenceCoreSetFromStanzaTokens` and asserting
  // its own output against itself), then compare production's actual span against that
  // independent expectation -- per section 16 of the phase spec.
  // --------------------------------------------------------------------------------------

  it('CANONICAL_NESTED_CITATION_PARITY = 100% -- non-citation lexical content is identical between the citation-free and citation-bearing deep-nmod fixtures', () => {
    const withoutCitation = buildDeepNmodFixture(new Set())
    const withCitation = buildDeepNmodFixture(new Set([1]))
    // Independent expectation: the SET of non-citation content words ("rainfall", "soil",
    // "type", "land", "cover") derived directly from each fixture's own token array (by
    // upos/deprel, never by re-reading production's output), excluding any token that is part
    // of a pushed citation subtree (upos PROPN/X or a `dep`/`nmod:unmarked` citation deprel).
    function nonCitationContentWords(tokens: StanzaToken[]): string[] {
      return tokens
        .filter((t) => t.upos === 'NOUN' && !['influence', 'factors'].includes(t.text.toLowerCase()))
        .map((t) => t.text)
        .sort()
    }
    const expectedWords = nonCitationContentWords(withoutCitation.tokens)
    expect(nonCitationContentWords(withCitation.tokens)).toEqual(expectedWords)

    const { coreSet: coreWithout } = buildSentenceCoreSetFromStanzaTokens(withoutCitation.text, withoutCitation.tokens)
    const { coreSet: coreWith } = buildSentenceCoreSetFromStanzaTokens(withCitation.text, withCitation.tokens)
    const displayWithout = displayText(coreWithout.subject, coreWithout.subjectPresentationText)
    const displayWith = displayText(coreWith.subject, coreWith.subjectPresentationText)
    expect(displayWith).toBe(displayWithout)
    for (const word of expectedWords) {
      expect(displayWith?.includes(word)).toBe(true)
    }
    expect(displayWith?.includes('Smith')).toBe(false)
    // Authority stays grounded for both, even though only one has a citation to excise from
    // its PRESENTATION text.
    expect(coreWithout.subject!.text).toBe(withoutCitation.text.slice(coreWithout.subject!.start, coreWithout.subject!.end))
    expect(coreWith.subject!.text).toBe(withCitation.text.slice(coreWith.subject!.start, coreWith.subject!.end))
  })

  it('CANONICAL_CITATION_CONTENT_RETENTION = 100% -- stripCitationTokens removes ONLY the independently-identified citation token IDs, never a sibling', () => {
    const { text, tokens } = buildDeepNmodFixture(new Set([1]))
    const byHead = childrenByHead(tokens)
    // Independent expectation, derived directly from the fixture construction (not from
    // production's own removal logic): the citation subtree for member 1 ("soil type") is
    // exactly the 4 tokens pushed by `pushCitation` immediately after "type" -- identified
    // here purely by upos (PROPN or X) and citation-only deprels, never by re-running the
    // production removal algorithm.
    const expectedRemovedIds = new Set(
      tokens.filter((t) => t.upos === 'PROPN' || (t.upos === 'X' && (t.deprel === 'cc' || t.deprel === 'conj')) || t.deprel === 'nmod:unmarked').map((t) => t.id),
    )
    const expectedRetainedContentIds = new Set(
      tokens.filter((t) => t.text === 'rainfall' || t.text === 'soil' || t.text === 'type' || t.text === 'land' || t.text === 'cover').map((t) => t.id),
    )
    expect(expectedRemovedIds.size).toBe(4)
    for (const id of expectedRetainedContentIds) expect(expectedRemovedIds.has(id)).toBe(false)

    const head = tokens.find((t) => t.text === 'factors')!
    const rawSubtreeIds = new Set<number>()
    ;(function collect(t: StanzaToken) {
      rawSubtreeIds.add(t.id)
      for (const c of byHead.get(t.id) ?? []) collect(c)
    })(head)
    const rawSubtree = tokens.filter((t) => rawSubtreeIds.has(t.id))
    const stripped = stripCitationTokens(text, head, rawSubtree, byHead)
    const strippedIds = new Set(stripped.map((t) => t.id))
    for (const id of expectedRetainedContentIds) expect(strippedIds.has(id)).toBe(true) // nothing genuine was deleted
    for (const id of expectedRemovedIds) expect(strippedIds.has(id)).toBe(false) // the citation itself is gone
  })
})
