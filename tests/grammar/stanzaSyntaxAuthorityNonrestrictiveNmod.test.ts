import { describe, expect, it } from 'vitest'
import { buildSentenceCoreSetFromStanzaTokens, type StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'

/**
 * Prototype 2.6G2.5C3 -- Canonical Nonrestrictive NMOD Supplement Boundary.
 *
 * Root cause (diagnosed against the live paired citation/no-citation "Relevant data,
 * including..." controls -- see the phase report, not reproduced here as a literal committed
 * test): `collectConstituentTokens` had no restrictive/nonrestrictive boundary for `nmod` at
 * all -- every `nmod` child was walked into unconditionally, regardless of comma-set-off
 * structure. A comma-delimited, case-marker-introduced `nmod` supplement ("NP, including A, B,
 * and C, ...") was therefore always absorbed into the canonical constituent. The ONLY reason a
 * citation-bearing version of the same sentence ever looked correct was an unrelated accident:
 * `stripCitationTokens` happened to wipe the whole `nmod` subtree once a citation appeared
 * anywhere inside it, coincidentally matching the (never actually implemented) exclusion
 * policy. This phase gives `nmod` its own explicit, citation-independent, comma-gated
 * exclusion rule -- the same mechanism already used for `acl`/`advcl` -- so canonical subject/
 * object/complement grounding no longer depends on citation presence.
 *
 * Synthetic fixtures reproducing the same STRUCTURAL SHAPES, different wording -- no literal
 * live-PDF/dataset sentence is committed here.
 */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

/** Sequential text-position cursor -- unlike a word->position map, this tolerates repeated
 * tokens (multiple commas, repeated words) by always searching forward from the last match. */
function seq(text: string) {
  let cursor = 0
  return (word: string) => {
    const start = text.indexOf(word, cursor)
    if (start === -1) throw new Error(`"${word}" not found from position ${cursor} in "${text}"`)
    cursor = start + word.length
    return { start, end: cursor }
  }
}

describe('Prototype 2.6G2.5C3 -- canonical nonrestrictive nmod supplement boundary', () => {
  it('(1) citation-free nonrestrictive nmod supplement is excluded from canonical subject', () => {
    const text = 'Data, including elevation models, road maps, and imagery, were collected.'
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
    const pAnd = next('and')
    const pImagery = next('imagery')
    const pC4 = next(',')
    const pWere = next('were')
    const pCollected = next('collected')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Data', upos: 'NOUN', head: 14, deprel: 'nsubj:pass', ...pData }),
      tok({ id: 2, text: ',', upos: 'PUNCT', head: 5, deprel: 'punct', ...pC1 }),
      tok({ id: 3, text: 'including', upos: 'VERB', head: 5, deprel: 'case', ...pIncluding }),
      tok({ id: 4, text: 'elevation', upos: 'NOUN', head: 5, deprel: 'compound', ...pElevation }),
      tok({ id: 5, text: 'models', upos: 'NOUN', head: 1, deprel: 'nmod', ...pModels }),
      tok({ id: 6, text: ',', upos: 'PUNCT', head: 8, deprel: 'punct', ...pC2 }),
      tok({ id: 7, text: 'road', upos: 'NOUN', head: 8, deprel: 'compound', ...pRoad }),
      tok({ id: 8, text: 'maps', upos: 'NOUN', head: 5, deprel: 'conj', ...pMaps }),
      tok({ id: 9, text: ',', upos: 'PUNCT', head: 11, deprel: 'punct', ...pC3 }),
      tok({ id: 10, text: 'and', upos: 'CCONJ', head: 11, deprel: 'cc', ...pAnd }),
      tok({ id: 11, text: 'imagery', upos: 'NOUN', head: 5, deprel: 'conj', ...pImagery }),
      tok({ id: 12, text: ',', upos: 'PUNCT', head: 1, deprel: 'punct', ...pC4 }),
      tok({ id: 13, text: 'were', upos: 'AUX', head: 14, deprel: 'aux:pass', ...pWere }),
      tok({ id: 14, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', ...pCollected }),
      tok({ id: 15, text: '.', upos: 'PUNCT', head: 14, deprel: 'punct', ...pDot }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('Data')
    expect(coreSet.predicateCores[0]?.verb?.text).toBe('were collected')
    expect(coreSet.predicateCores[0]?.pattern).toBe('SV')
  })

  it('(2) same supplement with one nested citation -- canonical subject IDENTICAL to (1)', () => {
    const text = 'Data, including elevation models, road maps (Smith 2020), and imagery, were collected.'
    const next = seq(text)
    const pData = next('Data')
    const pC1 = next(',')
    const pIncluding = next('including')
    const pElevation = next('elevation')
    const pModels = next('models')
    const pC2 = next(',')
    const pRoad = next('road')
    const pMaps = next('maps')
    const pOpen = next('(')
    const pSmith = next('Smith')
    const pYear = next('2020')
    const pClose = next(')')
    const pC3 = next(',')
    const pAnd = next('and')
    const pImagery = next('imagery')
    const pC4 = next(',')
    const pWere = next('were')
    const pCollected = next('collected')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Data', upos: 'NOUN', head: 18, deprel: 'nsubj:pass', ...pData }),
      tok({ id: 2, text: ',', upos: 'PUNCT', head: 5, deprel: 'punct', ...pC1 }),
      tok({ id: 3, text: 'including', upos: 'VERB', head: 5, deprel: 'case', ...pIncluding }),
      tok({ id: 4, text: 'elevation', upos: 'NOUN', head: 5, deprel: 'compound', ...pElevation }),
      tok({ id: 5, text: 'models', upos: 'NOUN', head: 1, deprel: 'nmod', ...pModels }),
      tok({ id: 6, text: ',', upos: 'PUNCT', head: 8, deprel: 'punct', ...pC2 }),
      tok({ id: 7, text: 'road', upos: 'NOUN', head: 8, deprel: 'compound', ...pRoad }),
      tok({ id: 8, text: 'maps', upos: 'NOUN', head: 5, deprel: 'conj', ...pMaps }),
      tok({ id: 9, text: '(', upos: 'PUNCT', head: 11, deprel: 'punct', ...pOpen }),
      tok({ id: 10, text: 'Smith', upos: 'PROPN', head: 8, deprel: 'appos', ...pSmith }),
      tok({ id: 11, text: '2020', upos: 'NUM', head: 10, deprel: 'nmod', ...pYear }),
      tok({ id: 12, text: ')', upos: 'PUNCT', head: 10, deprel: 'punct', ...pClose }),
      tok({ id: 13, text: ',', upos: 'PUNCT', head: 15, deprel: 'punct', ...pC3 }),
      tok({ id: 14, text: 'and', upos: 'CCONJ', head: 15, deprel: 'cc', ...pAnd }),
      tok({ id: 15, text: 'imagery', upos: 'NOUN', head: 5, deprel: 'conj', ...pImagery }),
      tok({ id: 16, text: ',', upos: 'PUNCT', head: 1, deprel: 'punct', ...pC4 }),
      tok({ id: 17, text: 'were', upos: 'AUX', head: 18, deprel: 'aux:pass', ...pWere }),
      tok({ id: 18, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', ...pCollected }),
      tok({ id: 19, text: '.', upos: 'PUNCT', head: 18, deprel: 'punct', ...pDot }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('Data')
  })

  it('(3) same supplement with SEVERAL nested citations -- canonical subject still IDENTICAL', () => {
    const text = 'Data, including elevation models (Lee 2019), road maps (Smith 2020), and imagery (Kim 2021), were collected.'
    const next = seq(text)
    const pData = next('Data')
    const pC1 = next(',')
    const pIncluding = next('including')
    const pElevation = next('elevation')
    const pModels = next('models')
    const pOpen1 = next('(')
    const pLee = next('Lee')
    const pY1 = next('2019')
    const pClose1 = next(')')
    const pC2 = next(',')
    const pRoad = next('road')
    const pMaps = next('maps')
    const pOpen2 = next('(')
    const pSmith = next('Smith')
    const pY2 = next('2020')
    const pClose2 = next(')')
    const pC3 = next(',')
    const pAnd = next('and')
    const pImagery = next('imagery')
    const pOpen3 = next('(')
    const pKim = next('Kim')
    const pY3 = next('2021')
    const pClose3 = next(')')
    const pC4 = next(',')
    const pWere = next('were')
    const pCollected = next('collected')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Data', upos: 'NOUN', head: 26, deprel: 'nsubj:pass', ...pData }),
      tok({ id: 2, text: ',', upos: 'PUNCT', head: 5, deprel: 'punct', ...pC1 }),
      tok({ id: 3, text: 'including', upos: 'VERB', head: 5, deprel: 'case', ...pIncluding }),
      tok({ id: 4, text: 'elevation', upos: 'NOUN', head: 5, deprel: 'compound', ...pElevation }),
      tok({ id: 5, text: 'models', upos: 'NOUN', head: 1, deprel: 'nmod', ...pModels }),
      tok({ id: 6, text: '(', upos: 'PUNCT', head: 8, deprel: 'punct', ...pOpen1 }),
      tok({ id: 7, text: 'Lee', upos: 'PROPN', head: 5, deprel: 'appos', ...pLee }),
      tok({ id: 8, text: '2019', upos: 'NUM', head: 7, deprel: 'nmod', ...pY1 }),
      tok({ id: 9, text: ')', upos: 'PUNCT', head: 7, deprel: 'punct', ...pClose1 }),
      tok({ id: 10, text: ',', upos: 'PUNCT', head: 12, deprel: 'punct', ...pC2 }),
      tok({ id: 11, text: 'road', upos: 'NOUN', head: 12, deprel: 'compound', ...pRoad }),
      tok({ id: 12, text: 'maps', upos: 'NOUN', head: 5, deprel: 'conj', ...pMaps }),
      tok({ id: 13, text: '(', upos: 'PUNCT', head: 15, deprel: 'punct', ...pOpen2 }),
      tok({ id: 14, text: 'Smith', upos: 'PROPN', head: 12, deprel: 'appos', ...pSmith }),
      tok({ id: 15, text: '2020', upos: 'NUM', head: 14, deprel: 'nmod', ...pY2 }),
      tok({ id: 16, text: ')', upos: 'PUNCT', head: 14, deprel: 'punct', ...pClose2 }),
      tok({ id: 17, text: ',', upos: 'PUNCT', head: 19, deprel: 'punct', ...pC3 }),
      tok({ id: 18, text: 'and', upos: 'CCONJ', head: 19, deprel: 'cc', ...pAnd }),
      tok({ id: 19, text: 'imagery', upos: 'NOUN', head: 5, deprel: 'conj', ...pImagery }),
      tok({ id: 20, text: '(', upos: 'PUNCT', head: 22, deprel: 'punct', ...pOpen3 }),
      tok({ id: 21, text: 'Kim', upos: 'PROPN', head: 19, deprel: 'appos', ...pKim }),
      tok({ id: 22, text: '2021', upos: 'NUM', head: 21, deprel: 'nmod', ...pY3 }),
      tok({ id: 23, text: ')', upos: 'PUNCT', head: 21, deprel: 'punct', ...pClose3 }),
      tok({ id: 24, text: ',', upos: 'PUNCT', head: 1, deprel: 'punct', ...pC4 }),
      tok({ id: 25, text: 'were', upos: 'AUX', head: 26, deprel: 'aux:pass', ...pWere }),
      tok({ id: 26, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', ...pCollected }),
      tok({ id: 27, text: '.', upos: 'PUNCT', head: 26, deprel: 'punct', ...pDot }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('Data')
  })

  it('(4) short supplement, single item -- excluded the same way', () => {
    const text = 'Data, including elevation values, were collected.'
    const next = seq(text)
    const pData = next('Data')
    const pC1 = next(',')
    const pIncluding = next('including')
    const pElevation = next('elevation')
    const pValues = next('values')
    const pC2 = next(',')
    const pWere = next('were')
    const pCollected = next('collected')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Data', upos: 'NOUN', head: 8, deprel: 'nsubj:pass', ...pData }),
      tok({ id: 2, text: ',', upos: 'PUNCT', head: 5, deprel: 'punct', ...pC1 }),
      tok({ id: 3, text: 'including', upos: 'VERB', head: 5, deprel: 'case', ...pIncluding }),
      tok({ id: 4, text: 'elevation', upos: 'NOUN', head: 5, deprel: 'compound', ...pElevation }),
      tok({ id: 5, text: 'values', upos: 'NOUN', head: 1, deprel: 'nmod', ...pValues }),
      tok({ id: 6, text: ',', upos: 'PUNCT', head: 1, deprel: 'punct', ...pC2 }),
      tok({ id: 7, text: 'were', upos: 'AUX', head: 8, deprel: 'aux:pass', ...pWere }),
      tok({ id: 8, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', ...pCollected }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 8, deprel: 'punct', ...pDot }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('Data')
  })

  it('(5) long coordinated supplement (five members) -- excluded in full, no partial leakage', () => {
    const text = 'Data, including a, b, c, d, and e, were collected.'
    const next = seq(text)
    const pData = next('Data')
    const pC1 = next(',')
    const pIncluding = next('including')
    const pA = next('a')
    const pC2 = next(',')
    const pB = next('b')
    const pC3 = next(',')
    const pC = next('c')
    const pC4 = next(',')
    const pD = next('d')
    const pC5 = next(',')
    const pAnd = next('and')
    const pE = next('e')
    const pC6 = next(',')
    const pWere = next('were')
    const pCollected = next('collected')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Data', upos: 'NOUN', head: 16, deprel: 'nsubj:pass', ...pData }),
      tok({ id: 2, text: ',', upos: 'PUNCT', head: 4, deprel: 'punct', ...pC1 }),
      tok({ id: 3, text: 'including', upos: 'VERB', head: 4, deprel: 'case', ...pIncluding }),
      tok({ id: 4, text: 'a', upos: 'NOUN', head: 1, deprel: 'nmod', ...pA }),
      tok({ id: 5, text: ',', upos: 'PUNCT', head: 6, deprel: 'punct', ...pC2 }),
      tok({ id: 6, text: 'b', upos: 'NOUN', head: 4, deprel: 'conj', ...pB }),
      tok({ id: 7, text: ',', upos: 'PUNCT', head: 8, deprel: 'punct', ...pC3 }),
      tok({ id: 8, text: 'c', upos: 'NOUN', head: 4, deprel: 'conj', ...pC }),
      tok({ id: 9, text: ',', upos: 'PUNCT', head: 10, deprel: 'punct', ...pC4 }),
      tok({ id: 10, text: 'd', upos: 'NOUN', head: 4, deprel: 'conj', ...pD }),
      tok({ id: 11, text: ',', upos: 'PUNCT', head: 13, deprel: 'punct', ...pC5 }),
      tok({ id: 12, text: 'and', upos: 'CCONJ', head: 13, deprel: 'cc', ...pAnd }),
      tok({ id: 13, text: 'e', upos: 'NOUN', head: 4, deprel: 'conj', ...pE }),
      tok({ id: 14, text: ',', upos: 'PUNCT', head: 1, deprel: 'punct', ...pC6 }),
      tok({ id: 15, text: 'were', upos: 'AUX', head: 16, deprel: 'aux:pass', ...pWere }),
      tok({ id: 16, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', ...pCollected }),
      tok({ id: 17, text: '.', upos: 'PUNCT', head: 16, deprel: 'punct', ...pDot }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('Data')
  })

  it('(6) restrictive nmod ("parameters for the algorithm") stays inside canonical subject', () => {
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
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The parameters for the algorithm')
  })

  it('(7) integral PP/nmod retention ("model in the study area")', () => {
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
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The model in the study area')
  })

  it('(8) parenthetical abbreviation ("factor (VIF)") is retained, not treated as a supplement', () => {
    const text = 'The factor (VIF) was calculated.'
    const next = seq(text)
    const pThe = next('The')
    const pFactor = next('factor')
    const pOpen = next('(')
    const pVIF = next('VIF')
    const pClose = next(')')
    const pWas = next('was')
    const pCalculated = next('calculated')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'factor', upos: 'NOUN', head: 7, deprel: 'nsubj:pass', ...pFactor }),
      tok({ id: 3, text: '(', upos: 'PUNCT', head: 4, deprel: 'punct', ...pOpen }),
      tok({ id: 4, text: 'VIF', upos: 'PROPN', head: 2, deprel: 'appos', ...pVIF }),
      tok({ id: 5, text: ')', upos: 'PUNCT', head: 4, deprel: 'punct', ...pClose }),
      tok({ id: 6, text: 'was', upos: 'AUX', head: 7, deprel: 'aux:pass', ...pWas }),
      tok({ id: 7, text: 'calculated', upos: 'VERB', head: 0, deprel: 'root', ...pCalculated }),
      tok({ id: 8, text: '.', upos: 'PUNCT', head: 7, deprel: 'punct', ...pDot }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The factor (VIF)')
  })

  it('(9) citation-only parenthetical is stripped, head noun retained', () => {
    // Mirrors the established citation fixture convention (stanzaSyntaxAuthorityCitation.test.ts):
    // an "et al." citation attaches via a generic dependency edge directly to the constituent
    // head, matched by `isCitationLike`'s first regex alternative independent of literal
    // parenthesis tokens (which `collectConstituentTokens` never selects in the first place).
    const text = 'The model Smith et al. 2020 was validated.'
    const next = seq(text)
    const pThe = next('The')
    const pModel = next('model')
    const pSmith = next('Smith')
    const pEt = next('et')
    const pAl = next('al.')
    const pYear = next('2020')
    const pWas = next('was')
    const pValidated = next('validated')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'model', upos: 'NOUN', head: 8, deprel: 'nsubj:pass', ...pModel }),
      tok({ id: 3, text: 'Smith', upos: 'PROPN', head: 2, deprel: 'dep', ...pSmith }),
      tok({ id: 4, text: 'et', upos: 'X', head: 5, deprel: 'cc', ...pEt }),
      tok({ id: 5, text: 'al.', upos: 'X', head: 3, deprel: 'conj', ...pAl }),
      tok({ id: 6, text: '2020', upos: 'NUM', head: 3, deprel: 'nmod:unmarked', ...pYear }),
      tok({ id: 7, text: 'was', upos: 'AUX', head: 8, deprel: 'aux:pass', ...pWas }),
      tok({ id: 8, text: 'validated', upos: 'VERB', head: 0, deprel: 'root', ...pValidated }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 8, deprel: 'punct', ...pDot }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The model')
  })

  it('(10) nonrestrictive relative clause -- no regression from the nmod rule', () => {
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
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The framework')
  })

  it('(11) ordinary coordinated subject -- no regression from the nmod rule', () => {
    const text = 'The temperature and humidity were recorded hourly.'
    const next = seq(text)
    const pThe = next('The')
    const pTemperature = next('temperature')
    const pAnd = next('and')
    const pHumidity = next('humidity')
    const pWere = next('were')
    const pRecorded = next('recorded')
    const pHourly = next('hourly')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'temperature', upos: 'NOUN', head: 6, deprel: 'nsubj:pass', ...pTemperature }),
      tok({ id: 3, text: 'and', upos: 'CCONJ', head: 4, deprel: 'cc', ...pAnd }),
      tok({ id: 4, text: 'humidity', upos: 'NOUN', head: 2, deprel: 'conj', ...pHumidity }),
      tok({ id: 5, text: 'were', upos: 'AUX', head: 6, deprel: 'aux:pass', ...pWere }),
      tok({ id: 6, text: 'recorded', upos: 'VERB', head: 0, deprel: 'root', ...pRecorded }),
      tok({ id: 7, text: 'hourly', upos: 'ADV', head: 6, deprel: 'advmod', ...pHourly }),
      tok({ id: 8, text: '.', upos: 'PUNCT', head: 6, deprel: 'punct', ...pDot }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The temperature and humidity')
  })

  it('(12) source-grounded span correctness -- excluded supplement leaves an exact, non-stretched span', () => {
    const text = 'Data, including elevation values, were collected.'
    const next = seq(text)
    const pData = next('Data')
    const pC1 = next(',')
    const pIncluding = next('including')
    const pElevation = next('elevation')
    const pValues = next('values')
    const pC2 = next(',')
    const pWere = next('were')
    const pCollected = next('collected')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Data', upos: 'NOUN', head: 8, deprel: 'nsubj:pass', ...pData }),
      tok({ id: 2, text: ',', upos: 'PUNCT', head: 5, deprel: 'punct', ...pC1 }),
      tok({ id: 3, text: 'including', upos: 'VERB', head: 5, deprel: 'case', ...pIncluding }),
      tok({ id: 4, text: 'elevation', upos: 'NOUN', head: 5, deprel: 'compound', ...pElevation }),
      tok({ id: 5, text: 'values', upos: 'NOUN', head: 1, deprel: 'nmod', ...pValues }),
      tok({ id: 6, text: ',', upos: 'PUNCT', head: 1, deprel: 'punct', ...pC2 }),
      tok({ id: 7, text: 'were', upos: 'AUX', head: 8, deprel: 'aux:pass', ...pWere }),
      tok({ id: 8, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', ...pCollected }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 8, deprel: 'punct', ...pDot }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject).toEqual({ text: 'Data', start: pData.start, end: pData.end })
  })

  /** Builds "Data, including elevation models[, road maps[ CITATION]], were collected." with a
   * configurable number of trailing "Name et al. Year" citations nested inside the coordinated
   * supplement -- the shared fixture family used by the CANONICAL_SUPPLEMENT_CITATION_PARITY
   * gate below to prove canonical subject grounding is independent of citation count. */
  function buildSupplementVariant(citationCount: 0 | 1 | 2): { text: string; tokens: StanzaToken[] } {
    const citeSuffix = (n: number) => ` Name${n} et al. ${2019 + n}`
    const text = `Data, including elevation models${citationCount >= 1 ? citeSuffix(1) : ''}, road maps${citationCount >= 2 ? citeSuffix(2) : ''}, were collected.`
    const next = seq(text)
    const pData = next('Data')
    const pC1 = next(',')
    const pIncluding = next('including')
    const pElevation = next('elevation')
    const pModels = next('models')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Data', upos: 'NOUN', head: 0, deprel: 'nsubj:pass', ...pData }),
      tok({ id: 2, text: ',', upos: 'PUNCT', head: 5, deprel: 'punct', ...pC1 }),
      tok({ id: 3, text: 'including', upos: 'VERB', head: 5, deprel: 'case', ...pIncluding }),
      tok({ id: 4, text: 'elevation', upos: 'NOUN', head: 5, deprel: 'compound', ...pElevation }),
      tok({ id: 5, text: 'models', upos: 'NOUN', head: 1, deprel: 'nmod', ...pModels }),
    ]
    let nextId = 6
    let modelsHeadForCitation = 5
    if (citationCount >= 1) {
      const pName = next('Name1')
      const pEt = next('et')
      const pAl = next('al.')
      const pYear = next('2020')
      tokens.push(
        tok({ id: nextId, text: 'Name1', upos: 'PROPN', head: modelsHeadForCitation, deprel: 'dep', ...pName }),
        tok({ id: nextId + 1, text: 'et', upos: 'X', head: nextId + 2, deprel: 'cc', ...pEt }),
        tok({ id: nextId + 2, text: 'al.', upos: 'X', head: nextId, deprel: 'conj', ...pAl }),
        tok({ id: nextId + 3, text: '2020', upos: 'NUM', head: nextId, deprel: 'nmod:unmarked', ...pYear }),
      )
      nextId += 4
    }
    const pC2 = next(',')
    const pRoad = next('road')
    const pMaps = next('maps')
    tokens.push(
      tok({ id: nextId, text: ',', upos: 'PUNCT', head: nextId + 2, deprel: 'punct', ...pC2 }),
      tok({ id: nextId + 1, text: 'road', upos: 'NOUN', head: nextId + 2, deprel: 'compound', ...pRoad }),
      tok({ id: nextId + 2, text: 'maps', upos: 'NOUN', head: 5, deprel: 'conj', ...pMaps }),
    )
    const mapsId = nextId + 2
    nextId += 3
    if (citationCount >= 2) {
      const pName = next('Name2')
      const pEt = next('et')
      const pAl = next('al.')
      const pYear = next('2021')
      tokens.push(
        tok({ id: nextId, text: 'Name2', upos: 'PROPN', head: mapsId, deprel: 'dep', ...pName }),
        tok({ id: nextId + 1, text: 'et', upos: 'X', head: nextId + 2, deprel: 'cc', ...pEt }),
        tok({ id: nextId + 2, text: 'al.', upos: 'X', head: nextId, deprel: 'conj', ...pAl }),
        tok({ id: nextId + 3, text: '2021', upos: 'NUM', head: nextId, deprel: 'nmod:unmarked', ...pYear }),
      )
      nextId += 4
    }
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
  }

  it('CANONICAL_SUPPLEMENT_CITATION_PARITY = 100% -- canonical subject is identical across 0/1/2 nested citations', () => {
    const results = ([0, 1, 2] as const).map((n) => {
      const { text, tokens } = buildSupplementVariant(n)
      return buildSentenceCoreSetFromStanzaTokens(text, tokens).coreSet.subject?.text
    })
    expect(results[0]).toBe('Data')
    expect(results[1]).toBe('Data')
    expect(results[2]).toBe('Data')
    expect(new Set(results).size).toBe(1)
  })

  it('RESTRICTIVE_NMOD_RETENTION = 100% -- all four restrictive PP/nmod controls keep the modifier inside canonical subject', () => {
    const cases: Array<{ text: string; tokens: StanzaToken[]; expected: string }> = []
    {
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
      cases.push({
        text,
        tokens: [
          tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe1 }),
          tok({ id: 2, text: 'parameters', upos: 'NOUN', head: 7, deprel: 'nsubj:pass', ...pParameters }),
          tok({ id: 3, text: 'for', upos: 'ADP', head: 5, deprel: 'case', ...pFor }),
          tok({ id: 4, text: 'the', upos: 'DET', head: 5, deprel: 'det', ...pThe2 }),
          tok({ id: 5, text: 'algorithm', upos: 'NOUN', head: 2, deprel: 'nmod', ...pAlgorithm }),
          tok({ id: 6, text: 'were', upos: 'AUX', head: 7, deprel: 'aux:pass', ...pWere }),
          tok({ id: 7, text: 'estimated', upos: 'VERB', head: 0, deprel: 'root', ...pEstimated }),
          tok({ id: 8, text: '.', upos: 'PUNCT', head: 7, deprel: 'punct', ...pDot }),
        ],
        expected: 'The parameters for the algorithm',
      })
    }
    {
      const text = 'The effect of rainfall was significant.'
      const next = seq(text)
      const pThe = next('The')
      const pEffect = next('effect')
      const pOf = next('of')
      const pRainfall = next('rainfall')
      const pWas = next('was')
      const pSignificant = next('significant')
      const pDot = next('.')
      cases.push({
        text,
        tokens: [
          tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
          tok({ id: 2, text: 'effect', upos: 'NOUN', head: 6, deprel: 'nsubj', ...pEffect }),
          tok({ id: 3, text: 'of', upos: 'ADP', head: 4, deprel: 'case', ...pOf }),
          tok({ id: 4, text: 'rainfall', upos: 'NOUN', head: 2, deprel: 'nmod', ...pRainfall }),
          tok({ id: 5, text: 'was', upos: 'AUX', head: 6, deprel: 'cop', ...pWas }),
          tok({ id: 6, text: 'significant', upos: 'ADJ', head: 0, deprel: 'root', ...pSignificant }),
          tok({ id: 7, text: '.', upos: 'PUNCT', head: 6, deprel: 'punct', ...pDot }),
        ],
        expected: 'The effect of rainfall',
      })
    }
    {
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
      cases.push({
        text,
        tokens: [
          tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe1 }),
          tok({ id: 2, text: 'model', upos: 'NOUN', head: 8, deprel: 'nsubj:pass', ...pModel }),
          tok({ id: 3, text: 'in', upos: 'ADP', head: 6, deprel: 'case', ...pIn }),
          tok({ id: 4, text: 'the', upos: 'DET', head: 6, deprel: 'det', ...pThe2 }),
          tok({ id: 5, text: 'study', upos: 'NOUN', head: 6, deprel: 'compound', ...pStudy }),
          tok({ id: 6, text: 'area', upos: 'NOUN', head: 2, deprel: 'nmod', ...pArea }),
          tok({ id: 7, text: 'was', upos: 'AUX', head: 8, deprel: 'aux:pass', ...pWas }),
          tok({ id: 8, text: 'evaluated', upos: 'VERB', head: 0, deprel: 'root', ...pEvaluated }),
          tok({ id: 9, text: '.', upos: 'PUNCT', head: 8, deprel: 'punct', ...pDot }),
        ],
        expected: 'The model in the study area',
      })
    }
    {
      const text = 'The measurements from the sensor were retained.'
      const next = seq(text)
      const pThe1 = next('The')
      const pMeasurements = next('measurements')
      const pFrom = next('from')
      const pThe2 = next('the')
      const pSensor = next('sensor')
      const pWere = next('were')
      const pRetained = next('retained')
      const pDot = next('.')
      cases.push({
        text,
        tokens: [
          tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe1 }),
          tok({ id: 2, text: 'measurements', upos: 'NOUN', head: 7, deprel: 'nsubj:pass', ...pMeasurements }),
          tok({ id: 3, text: 'from', upos: 'ADP', head: 5, deprel: 'case', ...pFrom }),
          tok({ id: 4, text: 'the', upos: 'DET', head: 5, deprel: 'det', ...pThe2 }),
          tok({ id: 5, text: 'sensor', upos: 'NOUN', head: 2, deprel: 'nmod', ...pSensor }),
          tok({ id: 6, text: 'were', upos: 'AUX', head: 7, deprel: 'aux:pass', ...pWere }),
          tok({ id: 7, text: 'retained', upos: 'VERB', head: 0, deprel: 'root', ...pRetained }),
          tok({ id: 8, text: '.', upos: 'PUNCT', head: 7, deprel: 'punct', ...pDot }),
        ],
        expected: 'The measurements from the sensor',
      })
    }
    let retained = 0
    for (const c of cases) {
      const { coreSet } = buildSentenceCoreSetFromStanzaTokens(c.text, c.tokens)
      if (coreSet.subject?.text === c.expected) retained += 1
    }
    expect(retained).toBe(cases.length)
  })
})
