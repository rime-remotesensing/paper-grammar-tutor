import { describe, expect, it } from 'vitest'
import { buildSentenceCoreSetFromStanzaTokens, type StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'

/**
 * Prototype 2.6G2.5C4.2 -- Restore Grounded Span Contract + Add Canonical Citation-Free
 * Presentation Text.
 *
 * The 2.6G2.5C4.1 audit established that the codebase-wide Span contract
 * (`span.text === source.slice(span.start, span.end)`) is not optional -- `resolveSpan`,
 * `sourceSentenceHighlight`, `treeReadingTargets`, and Tree's own independent grounding all
 * assume it. The original 2.6G2.5C4 fine-grained citation pruning violated it by excising an
 * interior citation's characters directly out of `Span.text` while leaving `start`/`end` as
 * the full outer boundary.
 *
 * This phase restores the contract: `groundConstituentSpan` (internal to
 * stanzaSyntaxAuthority.ts) now ALWAYS returns a fully source-grounded `span`, and separately
 * exposes an optional, additive `presentationText` -- citation-free when fine-grained pruning
 * removed something, `null` when nothing was removed (render `span.text` as-is). These are
 * threaded onto `SentenceCoreSet.subjectPresentationText` and
 * `PredicateCore.{indirectObject,object,complement}PresentationText` -- additive optional
 * fields on the APP-level types only, never on the shared `Span` schema itself (which the
 * unrelated Qwen/LLM pipeline also uses).
 *
 * Synthetic fixtures reproducing the same STRUCTURAL SHAPES, different wording -- no literal
 * live-PDF/dataset sentence is committed here.
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

/** Assert the codebase-wide Span contract for any grounded authority span. */
function expectGrounded(source: string, span: { text: string; start: number; end: number } | null) {
  expect(span).not.toBeNull()
  expect(span!.text).toBe(source.slice(span!.start, span!.end))
}

describe('Prototype 2.6G2.5C4.2 -- canonical span contract restoration + presentation text', () => {
  it('(1) span contract without citation -- authority grounded, presentationText null', () => {
    const text = 'The team reported significant results.'
    const next = seq(text)
    const pThe = next('The')
    const pTeam = next('team')
    const pReported = next('reported')
    const pSignificant = next('significant')
    const pResults = next('results')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', ...pTeam }),
      tok({ id: 3, text: 'reported', upos: 'VERB', head: 0, deprel: 'root', ...pReported }),
      tok({ id: 4, text: 'significant', upos: 'ADJ', head: 5, deprel: 'amod', ...pSignificant }),
      tok({ id: 5, text: 'results', upos: 'NOUN', head: 3, deprel: 'obj', ...pResults }),
      tok({ id: 6, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', ...pDot }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expectGrounded(text, coreSet.subject)
    expect(coreSet.subjectPresentationText).toBeNull()
    expectGrounded(text, coreSet.predicateCores[0]!.object)
    expect(coreSet.predicateCores[0]!.objectPresentationText).toBeNull()
  })

  it('(2) trailing citation -- authority grounded, presentationText citation-free', () => {
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
    expectGrounded(text, coreSet.subject)
    // Trailing citation: the grounded span's own min-max already stops before the citation,
    // so there is nothing to excise -- presentationText is null and `.text` is already clean.
    expect(coreSet.subjectPresentationText).toBeNull()
    expect(coreSet.subject!.text).toBe('The effect of rainfall')
  })

  /** "The influence of environmental factors including rainfall, soil type, and land cover
   * was investigated." with an optional "Name et al. Year" citation on a subset of the three
   * coordinated members {0,1,2}. */
  function buildDeepNmodFixture(citationMembers: ReadonlySet<0 | 1 | 2>): { text: string; tokens: StanzaToken[] } {
    const citeNames = ['Lee', 'Smith', 'Kim'] as const
    const citeYears = ['2019', '2020', '2021'] as const
    let text = 'The influence of environmental factors including rainfall'
    if (citationMembers.has(0)) text += ` ${citeNames[0]} et al. ${citeYears[0]}`
    text += ', soil type'
    if (citationMembers.has(1)) text += ` ${citeNames[1]} et al. ${citeYears[1]}`
    text += ', and land cover'
    if (citationMembers.has(2)) text += ` ${citeNames[2]} et al. ${citeYears[2]}`
    text += ' was investigated.'
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

  it('(3) one interior citation -- authority still covers it, presentationText excises it', () => {
    const { text, tokens } = buildDeepNmodFixture(new Set([1]))
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expectGrounded(text, coreSet.subject)
    expect(coreSet.subject!.text.includes('Smith')).toBe(true)
    expect(coreSet.subjectPresentationText).toBe(EXPECTED_DEEP)
  })

  it('(4) multiple interior citations -- authority one contiguous span, presentation strips each narrowly', () => {
    const { text, tokens } = buildDeepNmodFixture(new Set([0, 1, 2]))
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expectGrounded(text, coreSet.subject)
    expect(coreSet.subjectPresentationText).toBe(EXPECTED_DEEP)
    // No whole-subtree deletion: every citation-free member survives, none is a partial
    // fragment (e.g. "soil" without "type").
    for (const word of ['rainfall', 'soil', 'type', 'land', 'cover']) {
      expect(coreSet.subjectPresentationText!.includes(word)).toBe(true)
    }
  })

  it('(5) retained nmod + citation -- no genuine lexical content lost from presentation', () => {
    const { text, tokens } = buildDeepNmodFixture(new Set([1]))
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subjectPresentationText).toBe(EXPECTED_DEEP)
    expect(coreSet.subjectPresentationText!.includes('factors')).toBe(true)
    expect(coreSet.subjectPresentationText!.includes('including')).toBe(true)
  })

  it('(6) subject presentation text is available and citation-free', () => {
    const { text, tokens } = buildDeepNmodFixture(new Set([0]))
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subjectPresentationText).not.toBeNull()
    expect(coreSet.subjectPresentationText!.includes('Lee')).toBe(false)
  })

  it('(7) object presentation text is available and citation-free', () => {
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
    expectGrounded(text, objectSpan)
    expect(objectSpan.text.includes('Smith')).toBe(true)
    expect(coreSet.predicateCores[0]!.objectPresentationText).toBe('rainfall, soil type, and land cover')
  })

  it('(8) complement presentation text is available and citation-free', () => {
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
    expectGrounded(text, complementSpan)
    expect(complementSpan.text.includes('Smith')).toBe(true)
    expect(coreSet.predicateCores[0]!.complementPresentationText).toBe('accurate, reliable, and fast')
  })

  it('(9) source grounding equality -- CANONICAL_SPAN_SOURCE_GROUNDING = 100% across S/IO/O/C', () => {
    const fixtures: Array<{ text: string; tokens: StanzaToken[] }> = [
      buildDeepNmodFixture(new Set()),
      buildDeepNmodFixture(new Set([0])),
      buildDeepNmodFixture(new Set([1])),
      buildDeepNmodFixture(new Set([2])),
      buildDeepNmodFixture(new Set([0, 1, 2])),
    ]
    let checked = 0
    let grounded = 0
    for (const { text, tokens } of fixtures) {
      const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
      for (const span of [coreSet.subject, ...coreSet.predicateCores.flatMap((c) => [c.verb, c.indirectObject, c.object, c.complement])]) {
        if (!span) continue
        checked += 1
        if (span.text === text.slice(span.start, span.end)) grounded += 1
      }
    }
    expect(checked).toBeGreaterThan(0)
    expect(grounded).toBe(checked)
  })

  it('(10) presentation citation parity -- CANONICAL_PRESENTATION_CITATION_PARITY = 100%', () => {
    const withoutCitation = buildDeepNmodFixture(new Set())
    const withCitation = buildDeepNmodFixture(new Set([1]))
    const { coreSet: coreWithout } = buildSentenceCoreSetFromStanzaTokens(withoutCitation.text, withoutCitation.tokens)
    const { coreSet: coreWith } = buildSentenceCoreSetFromStanzaTokens(withCitation.text, withCitation.tokens)
    const displayWithout = coreWithout.subjectPresentationText ?? coreWithout.subject!.text
    const displayWith = coreWith.subjectPresentationText ?? coreWith.subject!.text
    expect(displayWith).toBe(displayWithout)
  })

  it('(11) parenthetical abbreviation negative -- "(VIF)" retained, no presentationText fabricated', () => {
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
    expectGrounded(text, coreSet.subject)
    expect(coreSet.subject!.text).toBe('The variance inflation factor (VIF)')
    expect(coreSet.subjectPresentationText).toBeNull()
  })

  it('(12) C3 nonrestrictive supplement regression -- CANONICAL_SUPPLEMENT_CITATION_PARITY = 100% still holds', () => {
    const withCitation = (() => {
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
      return { text, tokens }
    })()
    const withoutCitation = (() => {
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
      return { text, tokens }
    })()
    const { coreSet: coreWith } = buildSentenceCoreSetFromStanzaTokens(withCitation.text, withCitation.tokens)
    const { coreSet: coreWithout } = buildSentenceCoreSetFromStanzaTokens(withoutCitation.text, withoutCitation.tokens)
    // The comma-gated nmod boundary (C3) excludes the WHOLE supplement structurally, before
    // citation presentation is ever relevant -- so subject.text itself is already "Data" in
    // BOTH cases (never needs a presentationText rewrite at all).
    expect(coreWith.subject!.text).toBe('Data')
    expect(coreWithout.subject!.text).toBe('Data')
    expect(coreWith.subjectPresentationText).toBeNull()
    expect(coreWithout.subjectPresentationText).toBeNull()
    expectGrounded(withCitation.text, coreWith.subject)
    expectGrounded(withoutCitation.text, coreWithout.subject)
  })
})
