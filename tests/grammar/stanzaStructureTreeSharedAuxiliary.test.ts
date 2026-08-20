import { describe, expect, it } from 'vitest'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import { layoutSiblingsWithCoordinationGroups } from '../../src/features/grammar/domain/coordinationGroupPresentation.ts'
import { buildSentenceCoreSetFromStanzaTokens } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.6C6 -- Shared Auxiliary Scope Presentation.
 *
 * "Relevant data were collected and converted..." -- the passive auxiliary "were" appears
 * once in the source but grammatically governs every same-subject coordinated participle
 * ("converted", "cropped"), not just the first ("collected"). The Tree previously gave no
 * indication of this, which could read as "were belongs only to collected".
 *
 * The fix is presentation-only, in `buildClauseNode` (stanzaStructureTree.ts):
 * `findSharedAuxiliarySpan` grounds the main predicate's own `aux`/`aux:pass` children (never
 * `cop`) as one span; `sharedAuxiliaryFor` decides, per later coordinated predicate, whether it
 * has no auxiliary of its own and therefore inherits that span, attached as
 * `node.sharedAuxiliarySpan` (new optional Span field, structureTree.ts) -- REFERENCE metadata
 * to the one real grounded occurrence, never a fabricated "were converted" lexical node. Fixtures
 * use the exact raw-Stanza dependency shapes confirmed by live diagnostic.
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

function build(text: string, tokens: StanzaToken[]) {
  const tree = buildStanzaHierarchicalTree(text, tokens)
  const flat = flatten(tree)
  return { tree, flat }
}

describe('Prototype 2.6G2.6C6 -- shared auxiliary scope presentation', () => {
  it('(1) were collected and converted -- one-token passive auxiliary shared', () => {
    const text = 'The data were collected and converted.'
    const next = seq(text)
    const pThe = next('The')
    const pData = next('data')
    const pWere = next('were')
    const pCollected = next('collected')
    const pAnd = next('and')
    const pConverted = next('converted')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'data', upos: 'NOUN', head: 4, deprel: 'nsubj:pass', ...pData }),
      tok({ id: 3, text: 'were', upos: 'AUX', head: 4, deprel: 'aux:pass', feats: 'Mood=Ind|Number=Plur|Person=3|Tense=Past|VerbForm=Fin', ...pWere }),
      tok({ id: 4, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', feats: 'Tense=Past|VerbForm=Part|Voice=Pass', ...pCollected }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 6, deprel: 'cc', ...pAnd }),
      tok({ id: 6, text: 'converted', upos: 'VERB', head: 4, deprel: 'conj', feats: 'Tense=Past|VerbForm=Part|Voice=Pass', ...pConverted }),
      tok({ id: 7, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', ...pDot }),
    ]
    const { flat } = build(text, tokens)
    const converted = flat.find((n) => n.role === 'coordinatedPredicate' && n.text === 'converted')!
    expect(converted.sharedAuxiliarySpan?.text).toBe('were')
    expect(converted.text).toBe('converted') // node's own text never fabricated as "were converted"
    const collected = flat.find((n) => n.role === 'predicate')!
    expect(collected.text).toBe('were collected')
    expect(collected.sharedAuxiliarySpan).toBeUndefined() // the FIRST predicate never inherits from itself
  })

  it('(2) were collected, converted, and cropped -- three-way shared scope', () => {
    const text = 'Relevant data were collected and then converted to the same coordinate system and cropped to the boundary of the study area using QGIS.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Relevant', upos: 'ADJ', head: 2, deprel: 'amod', start: 0, end: 8 }),
      tok({ id: 2, text: 'data', upos: 'NOUN', head: 4, deprel: 'nsubj:pass', start: 9, end: 13 }),
      tok({ id: 3, text: 'were', upos: 'AUX', head: 4, deprel: 'aux:pass', feats: 'Mood=Ind|Number=Plur|Person=3|Tense=Past|VerbForm=Fin', start: 14, end: 18 }),
      tok({ id: 4, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', feats: 'Tense=Past|VerbForm=Part|Voice=Pass', start: 19, end: 28 }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 7, deprel: 'cc', start: 29, end: 32 }),
      tok({ id: 6, text: 'then', upos: 'ADV', head: 7, deprel: 'advmod', start: 33, end: 37 }),
      tok({ id: 7, text: 'converted', upos: 'VERB', head: 4, deprel: 'conj', feats: 'Tense=Past|VerbForm=Part|Voice=Pass', start: 38, end: 47 }),
      tok({ id: 8, text: 'to', upos: 'ADP', head: 12, deprel: 'case', start: 48, end: 50 }),
      tok({ id: 9, text: 'the', upos: 'DET', head: 12, deprel: 'det', start: 51, end: 54 }),
      tok({ id: 10, text: 'same', upos: 'ADJ', head: 12, deprel: 'amod', start: 55, end: 59 }),
      tok({ id: 11, text: 'coordinate', upos: 'NOUN', head: 12, deprel: 'compound', start: 60, end: 70 }),
      tok({ id: 12, text: 'system', upos: 'NOUN', head: 7, deprel: 'obl', start: 71, end: 77 }),
      tok({ id: 13, text: 'and', upos: 'CCONJ', head: 14, deprel: 'cc', start: 78, end: 81 }),
      tok({ id: 14, text: 'cropped', upos: 'VERB', head: 4, deprel: 'conj', feats: 'Tense=Past|VerbForm=Part|Voice=Pass', start: 82, end: 89 }),
      tok({ id: 15, text: 'to', upos: 'ADP', head: 17, deprel: 'case', start: 90, end: 92 }),
      tok({ id: 16, text: 'the', upos: 'DET', head: 17, deprel: 'det', start: 93, end: 96 }),
      tok({ id: 17, text: 'boundary', upos: 'NOUN', head: 14, deprel: 'obl', start: 97, end: 105 }),
      tok({ id: 18, text: 'of', upos: 'ADP', head: 21, deprel: 'case', start: 106, end: 108 }),
      tok({ id: 19, text: 'the', upos: 'DET', head: 21, deprel: 'det', start: 109, end: 112 }),
      tok({ id: 20, text: 'study', upos: 'NOUN', head: 21, deprel: 'compound', start: 113, end: 118 }),
      tok({ id: 21, text: 'area', upos: 'NOUN', head: 17, deprel: 'nmod', start: 119, end: 123 }),
      tok({ id: 22, text: 'using', upos: 'VERB', head: 21, deprel: 'acl', start: 124, end: 129 }),
      tok({ id: 23, text: 'QGIS', upos: 'PROPN', head: 22, deprel: 'obj', start: 130, end: 134 }),
      tok({ id: 24, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', start: 134, end: 135 }),
    ]
    const { flat, tree } = build(text, tokens)
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    // Basic Skeleton unchanged (section 18).
    expect(coreSet.subject?.text).toBe('Relevant data')
    expect(coreSet.predicateCores[0]?.verb?.text).toBe('were collected')
    expect(coreSet.predicateCores[0]?.pattern).toBe('SV')

    const converted = flat.find((n) => n.role === 'coordinatedPredicate' && n.text === 'converted')!
    const cropped = flat.find((n) => n.role === 'coordinatedPredicate' && n.text === 'cropped')!
    expect(converted.sharedAuxiliarySpan?.text).toBe('were')
    expect(cropped.sharedAuxiliarySpan?.text).toBe('were')
    // Connectors visible exactly once each, modifiers stay on their own predicate.
    expect(converted.connector?.text).toBe('and')
    expect(cropped.connector?.text).toBe('and')
    expect(converted.children.map((c) => c.text)).toEqual(['then', 'to the same coordinate system'])
    expect(cropped.children.map((c) => c.text)).toEqual(['to the boundary of the study area using QGIS'])
    // "were" occurs exactly once in the source and is never duplicated as a real lexical node.
    const wereNodes = flat.filter((n) => n.text === 'were')
    expect(wereNodes).toHaveLength(0)
    void tree
  })

  it('(3) has been tested and validated -- multi-token auxiliary chain shared', () => {
    const text = 'The method has been tested and validated.'
    const next = seq(text)
    const pThe = next('The')
    const pMethod = next('method')
    const pHas = next('has')
    const pBeen = next('been')
    const pTested = next('tested')
    const pAnd = next('and')
    const pValidated = next('validated')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'method', upos: 'NOUN', head: 5, deprel: 'nsubj:pass', ...pMethod }),
      tok({ id: 3, text: 'has', upos: 'AUX', head: 5, deprel: 'aux', feats: 'Mood=Ind|Number=Sing|Person=3|Tense=Pres|VerbForm=Fin', ...pHas }),
      tok({ id: 4, text: 'been', upos: 'AUX', head: 5, deprel: 'aux:pass', feats: 'Tense=Past|VerbForm=Part', ...pBeen }),
      tok({ id: 5, text: 'tested', upos: 'VERB', head: 0, deprel: 'root', feats: 'Tense=Past|VerbForm=Part|Voice=Pass', ...pTested }),
      tok({ id: 6, text: 'and', upos: 'CCONJ', head: 7, deprel: 'cc', ...pAnd }),
      tok({ id: 7, text: 'validated', upos: 'VERB', head: 5, deprel: 'conj', feats: 'Tense=Past|VerbForm=Part|Voice=Pass', ...pValidated }),
      tok({ id: 8, text: '.', upos: 'PUNCT', head: 5, deprel: 'punct', ...pDot }),
    ]
    const { flat } = build(text, tokens)
    const validated = flat.find((n) => n.role === 'coordinatedPredicate')!
    expect(validated.sharedAuxiliarySpan?.text).toBe('has been')
    expect(validated.text).toBe('validated')
  })

  it('(4) can be applied and extended -- modal auxiliary chain shared', () => {
    const text = 'The method can be applied and extended.'
    const next = seq(text)
    const pThe = next('The')
    const pMethod = next('method')
    const pCan = next('can')
    const pBe = next('be')
    const pApplied = next('applied')
    const pAnd = next('and')
    const pExtended = next('extended')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'method', upos: 'NOUN', head: 5, deprel: 'nsubj:pass', ...pMethod }),
      tok({ id: 3, text: 'can', upos: 'AUX', head: 5, deprel: 'aux', feats: 'VerbForm=Fin', ...pCan }),
      tok({ id: 4, text: 'be', upos: 'AUX', head: 5, deprel: 'aux:pass', feats: 'VerbForm=Inf', ...pBe }),
      tok({ id: 5, text: 'applied', upos: 'VERB', head: 0, deprel: 'root', feats: 'Tense=Past|VerbForm=Part|Voice=Pass', ...pApplied }),
      tok({ id: 6, text: 'and', upos: 'CCONJ', head: 7, deprel: 'cc', ...pAnd }),
      tok({ id: 7, text: 'extended', upos: 'VERB', head: 5, deprel: 'conj', feats: 'Tense=Past|VerbForm=Part|Voice=Pass', ...pExtended }),
      tok({ id: 8, text: '.', upos: 'PUNCT', head: 5, deprel: 'punct', ...pDot }),
    ]
    const { flat } = build(text, tokens)
    const extended = flat.find((n) => n.role === 'coordinatedPredicate')!
    expect(extended.sharedAuxiliarySpan?.text).toBe('can be')
  })

  it('(4b) can collect and analyze -- active modal (VerbForm=Inf/Inf) shared', () => {
    const text = 'The method can collect and analyze the data.'
    const next = seq(text)
    const pThe = next('The')
    const pMethod = next('method')
    const pCan = next('can')
    const pCollect = next('collect')
    const pAnd = next('and')
    const pAnalyze = next('analyze')
    const pThe2 = next('the')
    const pData = next('data')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'method', upos: 'NOUN', head: 4, deprel: 'nsubj', ...pMethod }),
      tok({ id: 3, text: 'can', upos: 'AUX', head: 4, deprel: 'aux', feats: 'VerbForm=Fin', ...pCan }),
      tok({ id: 4, text: 'collect', upos: 'VERB', head: 0, deprel: 'root', feats: 'VerbForm=Inf', ...pCollect }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 6, deprel: 'cc', ...pAnd }),
      tok({ id: 6, text: 'analyze', upos: 'VERB', head: 4, deprel: 'conj', feats: 'VerbForm=Inf', ...pAnalyze }),
      tok({ id: 7, text: 'the', upos: 'DET', head: 8, deprel: 'det', ...pThe2 }),
      tok({ id: 8, text: 'data', upos: 'NOUN', head: 6, deprel: 'obj', ...pData }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', ...pDot }),
    ]
    const { flat } = build(text, tokens)
    const analyze = flat.find((n) => n.role === 'coordinatedPredicate')!
    expect(analyze.sharedAuxiliarySpan?.text).toBe('can')
  })

  it('(4c) have collected and analyzed -- perfect active (VerbForm=Part/Part) shared', () => {
    const text = 'The researchers have collected and analyzed the samples.'
    const next = seq(text)
    const pThe = next('The')
    const pResearchers = next('researchers')
    const pHave = next('have')
    const pCollected = next('collected')
    const pAnd = next('and')
    const pAnalyzed = next('analyzed')
    const pThe2 = next('the')
    const pSamples = next('samples')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'researchers', upos: 'NOUN', head: 4, deprel: 'nsubj', ...pResearchers }),
      tok({ id: 3, text: 'have', upos: 'AUX', head: 4, deprel: 'aux', feats: 'Mood=Ind|Number=Plur|Person=3|Tense=Pres|VerbForm=Fin', ...pHave }),
      tok({ id: 4, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', feats: 'Tense=Past|VerbForm=Part', ...pCollected }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 6, deprel: 'cc', ...pAnd }),
      tok({ id: 6, text: 'analyzed', upos: 'VERB', head: 4, deprel: 'conj', feats: 'Tense=Past|VerbForm=Part', ...pAnalyzed }),
      tok({ id: 7, text: 'the', upos: 'DET', head: 8, deprel: 'det', ...pThe2 }),
      tok({ id: 8, text: 'samples', upos: 'NOUN', head: 6, deprel: 'obj', ...pSamples }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', ...pDot }),
    ]
    const { flat } = build(text, tokens)
    const analyzed = flat.find((n) => n.role === 'coordinatedPredicate')!
    expect(analyzed.sharedAuxiliarySpan?.text).toBe('have')
  })

  it('(4d) NEGATIVE -- has visited and lives: VerbForm=Part vs VerbForm=Fin blocks sharing', () => {
    const text = 'She has visited Paris and lives in London.'
    const next = seq(text)
    const pShe = next('She')
    const pHas = next('has')
    const pVisited = next('visited')
    const pParis = next('Paris')
    const pAnd = next('and')
    const pLives = next('lives')
    const pIn = next('in')
    const pLondon = next('London')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'She', upos: 'PRON', head: 3, deprel: 'nsubj', ...pShe }),
      tok({ id: 2, text: 'has', upos: 'AUX', head: 3, deprel: 'aux', feats: 'Mood=Ind|Number=Sing|Person=3|Tense=Pres|VerbForm=Fin', ...pHas }),
      tok({ id: 3, text: 'visited', upos: 'VERB', head: 0, deprel: 'root', feats: 'Tense=Past|VerbForm=Part', ...pVisited }),
      tok({ id: 4, text: 'Paris', upos: 'PROPN', head: 3, deprel: 'obj', ...pParis }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 6, deprel: 'cc', ...pAnd }),
      tok({ id: 6, text: 'lives', upos: 'VERB', head: 3, deprel: 'conj', feats: 'Mood=Ind|Number=Sing|Person=3|Tense=Pres|VerbForm=Fin', ...pLives }),
      tok({ id: 7, text: 'in', upos: 'ADP', head: 8, deprel: 'case', ...pIn }),
      tok({ id: 8, text: 'London', upos: 'PROPN', head: 6, deprel: 'obl', ...pLondon }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', ...pDot }),
    ]
    const { flat } = build(text, tokens)
    const lives = flat.find((n) => n.role === 'coordinatedPredicate')!
    expect(lives.sharedAuxiliarySpan).toBeUndefined()
  })

  it('(4e) NEGATIVE -- was tested and works: VerbForm=Part vs VerbForm=Fin blocks sharing', () => {
    const text = 'The system was tested and works well.'
    const next = seq(text)
    const pThe = next('The')
    const pSystem = next('system')
    const pWas = next('was')
    const pTested = next('tested')
    const pAnd = next('and')
    const pWorks = next('works')
    const pWell = next('well')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'system', upos: 'NOUN', head: 4, deprel: 'nsubj:pass', ...pSystem }),
      tok({ id: 3, text: 'was', upos: 'AUX', head: 4, deprel: 'aux:pass', feats: 'Mood=Ind|Number=Sing|Person=3|Tense=Past|VerbForm=Fin', ...pWas }),
      tok({ id: 4, text: 'tested', upos: 'VERB', head: 0, deprel: 'root', feats: 'Tense=Past|VerbForm=Part|Voice=Pass', ...pTested }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 6, deprel: 'cc', ...pAnd }),
      tok({ id: 6, text: 'works', upos: 'VERB', head: 4, deprel: 'conj', feats: 'Mood=Ind|Number=Sing|Person=3|Tense=Pres|VerbForm=Fin', ...pWorks }),
      tok({ id: 7, text: 'well', upos: 'ADV', head: 6, deprel: 'advmod', ...pWell }),
      tok({ id: 8, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', ...pDot }),
    ]
    const { flat } = build(text, tokens)
    const works = flat.find((n) => n.role === 'coordinatedPredicate')!
    expect(works.sharedAuxiliarySpan).toBeUndefined()
  })

  it('(4f) NEGATIVE -- is running and sings: VerbForm=Part(Pres) vs VerbForm=Fin blocks sharing', () => {
    const text = 'He is running and sings loudly.'
    const next = seq(text)
    const pHe = next('He')
    const pIs = next('is')
    const pRunning = next('running')
    const pAnd = next('and')
    const pSings = next('sings')
    const pLoudly = next('loudly')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'He', upos: 'PRON', head: 3, deprel: 'nsubj', ...pHe }),
      tok({ id: 2, text: 'is', upos: 'AUX', head: 3, deprel: 'aux', feats: 'Mood=Ind|Number=Sing|Person=3|Tense=Pres|VerbForm=Fin', ...pIs }),
      tok({ id: 3, text: 'running', upos: 'VERB', head: 0, deprel: 'root', feats: 'Tense=Pres|VerbForm=Part', ...pRunning }),
      tok({ id: 4, text: 'and', upos: 'CCONJ', head: 5, deprel: 'cc', ...pAnd }),
      tok({ id: 5, text: 'sings', upos: 'VERB', head: 3, deprel: 'conj', feats: 'Mood=Ind|Number=Sing|Person=3|Tense=Pres|VerbForm=Fin', ...pSings }),
      tok({ id: 6, text: 'loudly', upos: 'ADV', head: 5, deprel: 'advmod', ...pLoudly }),
      tok({ id: 7, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', ...pDot }),
    ]
    const { flat } = build(text, tokens)
    const sings = flat.find((n) => n.role === 'coordinatedPredicate')!
    expect(sings.sharedAuxiliarySpan).toBeUndefined()
  })

  it('(4g) ABSTENTION -- missing FEATS on either head withholds sharing rather than guessing', () => {
    const text = 'The data were collected and converted.'
    const next = seq(text)
    const pThe = next('The')
    const pData = next('data')
    const pWere = next('were')
    const pCollected = next('collected')
    const pAnd = next('and')
    const pConverted = next('converted')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'data', upos: 'NOUN', head: 4, deprel: 'nsubj:pass', ...pData }),
      tok({ id: 3, text: 'were', upos: 'AUX', head: 4, deprel: 'aux:pass', feats: 'Mood=Ind|Number=Plur|Person=3|Tense=Past|VerbForm=Fin', ...pWere }),
      // Main predicate deliberately has NO feats -- ambiguous/missing morphological evidence.
      tok({ id: 4, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', ...pCollected }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 6, deprel: 'cc', ...pAnd }),
      tok({ id: 6, text: 'converted', upos: 'VERB', head: 4, deprel: 'conj', feats: 'Tense=Past|VerbForm=Part|Voice=Pass', ...pConverted }),
      tok({ id: 7, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', ...pDot }),
    ]
    const { flat } = build(text, tokens)
    const converted = flat.find((n) => n.role === 'coordinatedPredicate')!
    expect(converted.sharedAuxiliarySpan).toBeUndefined()
  })

  it('(5) NEGATIVE -- has finished and will write: distinct auxiliaries, no sharing', () => {
    const text = 'He has finished the experiment and will write the paper.'
    const next = seq(text)
    const pHe = next('He')
    const pHas = next('has')
    const pFinished = next('finished')
    const pThe1 = next('the')
    const pExperiment = next('experiment')
    const pAnd = next('and')
    const pWill = next('will')
    const pWrite = next('write')
    const pThe2 = next('the')
    const pPaper = next('paper')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'He', upos: 'PRON', head: 3, deprel: 'nsubj', ...pHe }),
      tok({ id: 2, text: 'has', upos: 'AUX', head: 3, deprel: 'aux', ...pHas }),
      tok({ id: 3, text: 'finished', upos: 'VERB', head: 0, deprel: 'root', ...pFinished }),
      tok({ id: 4, text: 'the', upos: 'DET', head: 5, deprel: 'det', ...pThe1 }),
      tok({ id: 5, text: 'experiment', upos: 'NOUN', head: 3, deprel: 'obj', ...pExperiment }),
      tok({ id: 6, text: 'and', upos: 'CCONJ', head: 8, deprel: 'cc', ...pAnd }),
      tok({ id: 7, text: 'will', upos: 'AUX', head: 8, deprel: 'aux', ...pWill }),
      tok({ id: 8, text: 'write', upos: 'VERB', head: 3, deprel: 'conj', ...pWrite }),
      tok({ id: 9, text: 'the', upos: 'DET', head: 10, deprel: 'det', ...pThe2 }),
      tok({ id: 10, text: 'paper', upos: 'NOUN', head: 8, deprel: 'obj', ...pPaper }),
      tok({ id: 11, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', ...pDot }),
    ]
    const { flat } = build(text, tokens)
    const write = flat.find((n) => n.role === 'coordinatedPredicate')!
    expect(write.sharedAuxiliarySpan).toBeUndefined()
    expect(write.text).toBe('will write') // owns its own auxiliary, correctly folded into its own verb span
  })

  it('(6) NEGATIVE -- is accurate and predicts: cop is never treated as shareable auxiliary', () => {
    const text = 'The model is accurate and predicts the outcome.'
    const next = seq(text)
    const pThe = next('The')
    const pModel = next('model')
    const pIs = next('is')
    const pAccurate = next('accurate')
    const pAnd = next('and')
    const pPredicts = next('predicts')
    const pThe2 = next('the')
    const pOutcome = next('outcome')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'model', upos: 'NOUN', head: 4, deprel: 'nsubj', ...pModel }),
      tok({ id: 3, text: 'is', upos: 'AUX', head: 4, deprel: 'cop', ...pIs }),
      tok({ id: 4, text: 'accurate', upos: 'ADJ', head: 0, deprel: 'root', ...pAccurate }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 6, deprel: 'cc', ...pAnd }),
      tok({ id: 6, text: 'predicts', upos: 'VERB', head: 4, deprel: 'conj', ...pPredicts }),
      tok({ id: 7, text: 'the', upos: 'DET', head: 8, deprel: 'det', ...pThe2 }),
      tok({ id: 8, text: 'outcome', upos: 'NOUN', head: 6, deprel: 'obj', ...pOutcome }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', ...pDot }),
    ]
    const { flat } = build(text, tokens)
    const predicts = flat.find((n) => n.role === 'coordinatedPredicate')!
    expect(predicts.sharedAuxiliarySpan).toBeUndefined()
  })

  it('(7) explicit-subject clause coordination negative -- never shares into a distinct-subject branch', () => {
    const text = 'Landslide inventories are an essential basis for landslide susceptibility analysis, and they directly affect the reliability of the results.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Landslide', upos: 'NOUN', head: 2, deprel: 'compound', start: 0, end: 9 }),
      tok({ id: 2, text: 'inventories', upos: 'NOUN', head: 6, deprel: 'nsubj', start: 10, end: 21 }),
      tok({ id: 3, text: 'are', upos: 'AUX', head: 6, deprel: 'cop', start: 22, end: 25 }),
      tok({ id: 4, text: 'an', upos: 'DET', head: 6, deprel: 'det', start: 26, end: 28 }),
      tok({ id: 5, text: 'essential', upos: 'ADJ', head: 6, deprel: 'amod', start: 29, end: 38 }),
      tok({ id: 6, text: 'basis', upos: 'NOUN', head: 0, deprel: 'root', start: 39, end: 44 }),
      tok({ id: 7, text: 'for', upos: 'ADP', head: 10, deprel: 'case', start: 45, end: 48 }),
      tok({ id: 8, text: 'landslide', upos: 'NOUN', head: 9, deprel: 'compound', start: 49, end: 58 }),
      tok({ id: 9, text: 'susceptibility', upos: 'NOUN', head: 10, deprel: 'compound', start: 59, end: 73 }),
      tok({ id: 10, text: 'analysis', upos: 'NOUN', head: 6, deprel: 'nmod', start: 74, end: 82 }),
      tok({ id: 11, text: ',', upos: 'PUNCT', head: 15, deprel: 'punct', start: 82, end: 83 }),
      tok({ id: 12, text: 'and', upos: 'CCONJ', head: 15, deprel: 'cc', start: 84, end: 87 }),
      tok({ id: 13, text: 'they', upos: 'PRON', head: 15, deprel: 'nsubj', start: 88, end: 92 }),
      tok({ id: 14, text: 'directly', upos: 'ADV', head: 15, deprel: 'advmod', start: 93, end: 101 }),
      tok({ id: 15, text: 'affect', upos: 'VERB', head: 6, deprel: 'conj', start: 102, end: 108 }),
      tok({ id: 16, text: 'the', upos: 'DET', head: 17, deprel: 'det', start: 109, end: 112 }),
      tok({ id: 17, text: 'reliability', upos: 'NOUN', head: 15, deprel: 'obj', start: 113, end: 124 }),
      tok({ id: 18, text: 'of', upos: 'ADP', head: 20, deprel: 'case', start: 125, end: 127 }),
      tok({ id: 19, text: 'the', upos: 'DET', head: 20, deprel: 'det', start: 128, end: 131 }),
      tok({ id: 20, text: 'results', upos: 'NOUN', head: 17, deprel: 'nmod', start: 132, end: 139 }),
      tok({ id: 21, text: '.', upos: 'PUNCT', head: 6, deprel: 'punct', start: 139, end: 140 }),
    ]
    const { flat } = build(text, tokens)
    const affect = flat.find((n) => n.role === 'coordinatedPredicate')!
    expect(affect.sharedAuxiliarySpan).toBeUndefined()
    // "are" is `cop`, not `aux`/`aux:pass`, so it would never be shareable in the first place --
    // double negative coverage (clause coordination AND cop-exclusion both block this).
  })

  it('(8) canonical NP coordination negative -- no shared-auxiliary concept applies', () => {
    const text = 'The report includes Ordovician, Silurian, and igneous rocks.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'report', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: 'includes', upos: 'VERB', head: 0, deprel: 'root', start: 11, end: 19 }),
      tok({ id: 4, text: 'Ordovician', upos: 'ADJ', head: 10, deprel: 'amod', start: 20, end: 30 }),
      tok({ id: 5, text: ',', upos: 'PUNCT', head: 6, deprel: 'punct', start: 30, end: 31 }),
      tok({ id: 6, text: 'Silurian', upos: 'ADJ', head: 4, deprel: 'conj', start: 32, end: 40 }),
      tok({ id: 7, text: ',', upos: 'PUNCT', head: 10, deprel: 'punct', start: 40, end: 41 }),
      tok({ id: 8, text: 'and', upos: 'CCONJ', head: 10, deprel: 'cc', start: 42, end: 45 }),
      tok({ id: 9, text: 'igneous', upos: 'ADJ', head: 10, deprel: 'amod', start: 46, end: 53 }),
      tok({ id: 10, text: 'rocks', upos: 'NOUN', head: 3, deprel: 'obj', start: 54, end: 59 }),
      tok({ id: 11, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 59, end: 60 }),
    ]
    const { flat } = build(text, tokens)
    const members = flat.filter((n) => n.role === 'coordinationMember')
    expect(members).toHaveLength(3)
    expect(members.every((m) => m.sharedAuxiliarySpan === undefined)).toBe(true)
  })

  it('(9) enumeration negative -- colon list untouched by shared-auxiliary logic', () => {
    const text = 'The landslide causal factors for LSM can be classified into two categories: causative factors and trigger factors.'
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
      tok({ id: 19, text: '.', upos: 'PUNCT', head: 9, deprel: 'punct', start: 113, end: 114 }),
    ]
    const { flat } = build(text, tokens)
    const enumContainer = flat.find((n) => n.role === 'enumeration')!
    expect(enumContainer.children.map((c) => c.text)).toEqual(['causative factors', 'trigger factors'])
    expect(enumContainer.children.every((c) => c.sharedAuxiliarySpan === undefined)).toBe(true)
    // "can be" belongs to the predicate "classified" only -- an enumeration member is a
    // structurally unrelated concept and must never inherit it.
    const classified = flat.find((n) => n.role === 'predicate')!
    expect(classified.text).toBe('can be classified')
  })

  it('(10)+(11) auxiliary and connector source tokens each appear exactly once (no fabricated duplicate node)', () => {
    const text = 'The data were collected and converted.'
    const next = seq(text)
    const pThe = next('The')
    const pData = next('data')
    const pWere = next('were')
    const pCollected = next('collected')
    const pAnd = next('and')
    const pConverted = next('converted')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'data', upos: 'NOUN', head: 4, deprel: 'nsubj:pass', ...pData }),
      tok({ id: 3, text: 'were', upos: 'AUX', head: 4, deprel: 'aux:pass', ...pWere }),
      tok({ id: 4, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', ...pCollected }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 6, deprel: 'cc', ...pAnd }),
      tok({ id: 6, text: 'converted', upos: 'VERB', head: 4, deprel: 'conj', ...pConverted }),
      tok({ id: 7, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', ...pDot }),
    ]
    const { tree, flat } = build(text, tokens)
    expect(flat.filter((n) => n.text === 'were')).toHaveLength(0) // never its own lexical node
    expect(flat.filter((n) => n.text === 'and')).toHaveLength(0) // connector likewise never a lexical node
    const items = layoutSiblingsWithCoordinationGroups(text, tree[0]!.children)
    const andCount = items.flatMap((i) => (i.kind === 'group' ? i.group.boundaryConnectors.filter((c) => c === 'and') : [])).length
    expect(andCount).toBe(1)
  })

  it('(12) every lexical node stays source-grounded (Span contract holds for sharedAuxiliarySpan too)', () => {
    const text = 'The method has been tested and validated.'
    const next = seq(text)
    const pThe = next('The')
    const pMethod = next('method')
    const pHas = next('has')
    const pBeen = next('been')
    const pTested = next('tested')
    const pAnd = next('and')
    const pValidated = next('validated')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'method', upos: 'NOUN', head: 5, deprel: 'nsubj:pass', ...pMethod }),
      tok({ id: 3, text: 'has', upos: 'AUX', head: 5, deprel: 'aux', feats: 'Mood=Ind|Number=Sing|Person=3|Tense=Pres|VerbForm=Fin', ...pHas }),
      tok({ id: 4, text: 'been', upos: 'AUX', head: 5, deprel: 'aux:pass', feats: 'Tense=Past|VerbForm=Part', ...pBeen }),
      tok({ id: 5, text: 'tested', upos: 'VERB', head: 0, deprel: 'root', feats: 'Tense=Past|VerbForm=Part|Voice=Pass', ...pTested }),
      tok({ id: 6, text: 'and', upos: 'CCONJ', head: 7, deprel: 'cc', ...pAnd }),
      tok({ id: 7, text: 'validated', upos: 'VERB', head: 5, deprel: 'conj', feats: 'Tense=Past|VerbForm=Part|Voice=Pass', ...pValidated }),
      tok({ id: 8, text: '.', upos: 'PUNCT', head: 5, deprel: 'punct', ...pDot }),
    ]
    const { flat } = build(text, tokens)
    for (const n of flat) {
      expect(n.text).toBe(text.slice(n.start, n.end))
      if (n.sharedAuxiliarySpan) {
        expect(n.sharedAuxiliarySpan.text).toBe(text.slice(n.sharedAuxiliarySpan.start, n.sharedAuxiliarySpan.end))
      }
    }
  })

  it('(13) Basic Skeleton unchanged for the live sentence', () => {
    const text = 'The data were collected and converted.'
    const next = seq(text)
    const pThe = next('The')
    const pData = next('data')
    const pWere = next('were')
    const pCollected = next('collected')
    const pAnd = next('and')
    const pConverted = next('converted')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'data', upos: 'NOUN', head: 4, deprel: 'nsubj:pass', ...pData }),
      tok({ id: 3, text: 'were', upos: 'AUX', head: 4, deprel: 'aux:pass', ...pWere }),
      tok({ id: 4, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', ...pCollected }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 6, deprel: 'cc', ...pAnd }),
      tok({ id: 6, text: 'converted', upos: 'VERB', head: 4, deprel: 'conj', ...pConverted }),
      tok({ id: 7, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', ...pDot }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The data')
    expect(coreSet.predicateCores[0]?.verb?.text).toBe('were collected')
    expect(coreSet.predicateCores[0]?.pattern).toBe('SV')
  })

  it('(14) modifier ownership unchanged -- "then"/"to the same coordinate system" stay on their own predicate', () => {
    const text = 'The data were collected and then converted to the system.'
    const next = seq(text)
    const pThe = next('The')
    const pData = next('data')
    const pWere = next('were')
    const pCollected = next('collected')
    const pAnd = next('and')
    const pThen = next('then')
    const pConverted = next('converted')
    const pTo = next('to')
    const pThe2 = next('the')
    const pSystem = next('system')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'data', upos: 'NOUN', head: 4, deprel: 'nsubj:pass', ...pData }),
      tok({ id: 3, text: 'were', upos: 'AUX', head: 4, deprel: 'aux:pass', feats: 'Mood=Ind|Number=Plur|Person=3|Tense=Past|VerbForm=Fin', ...pWere }),
      tok({ id: 4, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', feats: 'Tense=Past|VerbForm=Part|Voice=Pass', ...pCollected }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 7, deprel: 'cc', ...pAnd }),
      tok({ id: 6, text: 'then', upos: 'ADV', head: 7, deprel: 'advmod', ...pThen }),
      tok({ id: 7, text: 'converted', upos: 'VERB', head: 4, deprel: 'conj', feats: 'Tense=Past|VerbForm=Part|Voice=Pass', ...pConverted }),
      tok({ id: 8, text: 'to', upos: 'ADP', head: 10, deprel: 'case', ...pTo }),
      tok({ id: 9, text: 'the', upos: 'DET', head: 10, deprel: 'det', ...pThe2 }),
      tok({ id: 10, text: 'system', upos: 'NOUN', head: 7, deprel: 'obl', ...pSystem }),
      tok({ id: 11, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', ...pDot }),
    ]
    const { flat } = build(text, tokens)
    const converted = flat.find((n) => n.role === 'coordinatedPredicate')!
    expect(converted.sharedAuxiliarySpan?.text).toBe('were')
    expect(converted.children.map((c) => c.text)).toEqual(['then', 'to the system'])
    const collected = flat.find((n) => n.role === 'predicate')!
    expect(collected.children).toHaveLength(0) // "then"/"to the system" never leak onto collected
  })
})
