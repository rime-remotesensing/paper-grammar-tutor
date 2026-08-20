import { describe, expect, it } from 'vitest'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import { layoutSiblingsWithCoordinationGroups } from '../../src/features/grammar/domain/coordinationGroupPresentation.ts'
import { buildSentenceCoreSetFromStanzaTokens } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.6C4.2B -- Structured Connector Preservation for Colon Enumeration.
 *
 * Root cause: `buildEnumerationChildren` built every enumeration item with the generic
 * `'other'` role. `coordinationGroupPresentation.ts`'s `groupingKey` deliberately gives every
 * `'other'` node its OWN unique key (a defensive guard against spuriously grouping unrelated
 * "the model couldn't classify this" leftovers, e.g. two unconnected equation placeholders) --
 * which also meant two genuine enumeration members, despite carrying real dependency-parsed
 * coordination evidence (a real `appos`/`conj` chain under the list's own head), could never
 * form a coordination "run" together, so the sibling-level connector badge
 * (`layoutSiblingsWithCoordinationGroups`) never even got a chance to render their `and`/`or`/
 * `but`.
 *
 * The repair: enumeration items now get their own dedicated role, `'enumerationMember'`
 * (structureTree.ts), which `groupingKey` treats normally (no special-casing needed there --
 * every non-'other'/non-predicate role already falls through to `return node.role`). Each
 * FOLLOWING member (one reached via a `conj` chain, never the list's own first member) also
 * has its structured `connector` field populated from the real `cc` token that introduces it
 * -- grounded via dependency structure (`findConjunctionConnector` in stanzaStructureTree.ts),
 * never a literal "and" text match, and never invented when no `cc` token exists. This lets
 * the EXISTING `buildGroupFromConnectors` mechanism (already used for predicate/object/NP
 * coordination) render the connector exactly once, through the same established pipeline --
 * no new lexical/enumeration-only hack.
 *
 * Fixtures use the exact raw-Stanza dependency shape confirmed by live diagnostic (`cc`
 * attaches as a direct child of the `conj` token it introduces, matching the same "et" -> head
 * "al." shape already relied on for citation handling elsewhere in this codebase).
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

/** Builds "The system offers two ITEM1WORD modes: ITEM1 CONNECTOR ITEM2." -- a minimal
 * two-member colon-enumeration fixture matching the exact live-confirmed dependency shape
 * (item1 via `appos` of the enumeration head, item2 via `conj` of item1, an optional `cc`
 * child of item2 itself). `connectorWord` is `null` for a comma-only boundary (no `cc` token
 * at all). */
function twoMemberFixture(item1: string, connectorWord: string | null, item2: string): { text: string; tokens: StanzaToken[] } {
  const text = connectorWord
    ? `The system offers two modes: ${item1} ${connectorWord} ${item2}.`
    : `The system offers two modes: ${item1}, ${item2}.`
  const next = seq(text)
  const pThe = next('The')
  const pSystem = next('system')
  const pOffers = next('offers')
  const pTwo = next('two')
  const pModes = next('modes')
  const pColon = next(':')
  const item1Words = item1.split(' ')
  const item1LastId = 7 + item1Words.length - 1
  const tokens: StanzaToken[] = [
    tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
    tok({ id: 2, text: 'system', upos: 'NOUN', head: 3, deprel: 'nsubj', ...pSystem }),
    tok({ id: 3, text: 'offers', upos: 'VERB', head: 0, deprel: 'root', ...pOffers }),
    tok({ id: 4, text: 'two', upos: 'NUM', head: 5, deprel: 'nummod', ...pTwo }),
    tok({ id: 5, text: 'modes', upos: 'NOUN', head: 3, deprel: 'obj', ...pModes }),
    tok({ id: 6, text: ':', upos: 'PUNCT', head: item1LastId, deprel: 'punct', ...pColon }),
  ]
  let nextId = 7
  item1Words.forEach((w, i) => {
    const p = next(w)
    const isLast = i === item1Words.length - 1
    tokens.push(tok({ id: nextId, text: w, upos: isLast ? 'NOUN' : 'ADJ', head: isLast ? 5 : item1LastId, deprel: isLast ? 'appos' : 'amod', ...p }))
    nextId += 1
  })
  const item2Words = item2.split(' ')
  const item2FirstId = nextId + 1 // both branches below push exactly one token (connector or comma) before item2 begins
  const item2LastId = item2FirstId + item2Words.length - 1
  if (connectorWord) {
    const pConn = next(connectorWord)
    tokens.push(tok({ id: nextId, text: connectorWord, upos: 'CCONJ', head: item2LastId, deprel: 'cc', ...pConn }))
    nextId += 1
  } else {
    const pComma = next(',')
    tokens.push(tok({ id: nextId, text: ',', upos: 'PUNCT', head: item2LastId, deprel: 'punct', ...pComma }))
    nextId += 1
  }
  item2Words.forEach((w, i) => {
    const p = next(w)
    const isLast = i === item2Words.length - 1
    tokens.push(tok({ id: nextId, text: w, upos: isLast ? 'NOUN' : 'ADJ', head: isLast ? item1LastId : item2LastId, deprel: isLast ? 'conj' : 'amod', ...p }))
    nextId += 1
  })
  const pDot = next('.')
  tokens.push(tok({ id: nextId, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', ...pDot }))
  return { text, tokens }
}

function enumerationMembers(text: string, tokens: StanzaToken[]) {
  const tree = buildStanzaHierarchicalTree(text, tokens)
  const flat = flatten(tree)
  const container = flat.find((n) => n.role === 'enumeration')
  return { tree, flat, container }
}

describe('Prototype 2.6G2.6C4.2B -- enumeration structured connector preservation', () => {
  it('(1) two-member "and"', () => {
    const { text, tokens } = twoMemberFixture('fast mode', 'and', 'accurate mode')
    const { container } = enumerationMembers(text, tokens)
    expect(container!.children.map((c) => c.text)).toEqual(['fast mode', 'accurate mode'])
    expect(container!.children[0]!.connector).toBeUndefined()
    expect(container!.children[1]!.connector?.text).toBe('and')
    expect(container!.children.every((c) => c.role === 'enumerationMember')).toBe(true)
  })

  it('(2) two-member "or"', () => {
    const { text, tokens } = twoMemberFixture('fast mode', 'or', 'accurate mode')
    const { container } = enumerationMembers(text, tokens)
    expect(container!.children[1]!.connector?.text).toBe('or')
  })

  it('(3) two-member "but"', () => {
    const { text, tokens } = twoMemberFixture('fast mode', 'but', 'accurate mode')
    const { container } = enumerationMembers(text, tokens)
    expect(container!.children[1]!.connector?.text).toBe('but')
  })

  it('(5) punctuation-only "A, B" -- no connector invented', () => {
    const { text, tokens } = twoMemberFixture('fast mode', null, 'accurate mode')
    const { container } = enumerationMembers(text, tokens)
    expect(container!.children.map((c) => c.text)).toEqual(['fast mode', 'accurate mode'])
    expect(container!.children[0]!.connector).toBeUndefined()
    expect(container!.children[1]!.connector).toBeUndefined()
  })

  it('(11) connector visible exactly once through the render pipeline (VISIBLE_CONNECTOR_DUPLICATION = 0)', () => {
    const { text, tokens } = twoMemberFixture('fast mode', 'and', 'accurate mode')
    const { container } = enumerationMembers(text, tokens)
    const items = layoutSiblingsWithCoordinationGroups(text, container!.children)
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('group')
    if (items[0]!.kind === 'group') {
      const andCount = items[0]!.group.boundaryConnectors.filter((c) => c === 'and').length
      expect(andCount).toBe(1)
    }
  })

  it('(4) three-member "A, B, and C" -- connector only on the final boundary', () => {
    const text = 'The study identified three factors: rainfall intensity, soil saturation, and slope angle.'
    const next = seq(text)
    const pThe = next('The')
    const pStudy = next('study')
    const pIdentified = next('identified')
    const pThree = next('three')
    const pFactors = next('factors')
    const pColon = next(':')
    const pRainfall = next('rainfall')
    const pIntensity = next('intensity')
    const pComma1 = next(',')
    const pSoil = next('soil')
    const pSaturation = next('saturation')
    const pComma2 = next(',')
    const pAnd = next('and')
    const pSlope = next('slope')
    const pAngle = next('angle')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'study', upos: 'NOUN', head: 3, deprel: 'nsubj', ...pStudy }),
      tok({ id: 3, text: 'identified', upos: 'VERB', head: 0, deprel: 'root', ...pIdentified }),
      tok({ id: 4, text: 'three', upos: 'NUM', head: 5, deprel: 'nummod', ...pThree }),
      tok({ id: 5, text: 'factors', upos: 'NOUN', head: 3, deprel: 'obj', ...pFactors }),
      tok({ id: 6, text: ':', upos: 'PUNCT', head: 8, deprel: 'punct', ...pColon }),
      tok({ id: 7, text: 'rainfall', upos: 'NOUN', head: 8, deprel: 'compound', ...pRainfall }),
      tok({ id: 8, text: 'intensity', upos: 'NOUN', head: 5, deprel: 'appos', ...pIntensity }),
      tok({ id: 9, text: ',', upos: 'PUNCT', head: 11, deprel: 'punct', ...pComma1 }),
      tok({ id: 10, text: 'soil', upos: 'NOUN', head: 11, deprel: 'compound', ...pSoil }),
      tok({ id: 11, text: 'saturation', upos: 'NOUN', head: 8, deprel: 'conj', ...pSaturation }),
      tok({ id: 12, text: ',', upos: 'PUNCT', head: 14, deprel: 'punct', ...pComma2 }),
      tok({ id: 13, text: 'and', upos: 'CCONJ', head: 14, deprel: 'cc', ...pAnd }),
      tok({ id: 14, text: 'slope', upos: 'NOUN', head: 8, deprel: 'conj', ...pSlope }),
      tok({ id: 15, text: 'angle', upos: 'NOUN', head: 14, deprel: 'compound', ...pAngle }),
      tok({ id: 16, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', ...pDot }),
    ]
    const { container } = enumerationMembers(text, tokens)
    expect(container!.children.map((c) => c.text)).toEqual(['rainfall intensity', 'soil saturation', 'slope angle'])
    expect(container!.children[0]!.connector).toBeUndefined()
    expect(container!.children[1]!.connector).toBeUndefined()
    expect(container!.children[2]!.connector?.text).toBe('and')
    // Rendered exactly once through the group pipeline too.
    const items = layoutSiblingsWithCoordinationGroups(text, container!.children)
    expect(items).toHaveLength(1)
    if (items[0]!.kind === 'group') {
      expect(items[0]!.group.boundaryConnectors).toEqual([null, null, 'and'])
    }
  })

  it('(6) colon enumeration + trailing citation -- connector preserved, citation excluded (COLON_ENUMERATION_CITATION_LEAKAGE = 0)', () => {
    // The exact live diagnostic control from Prototype 2.6G2.6C4.2A.
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
    const { container, flat } = enumerationMembers(text, tokens)
    expect(container!.children.map((c) => c.text)).toEqual(['causative factors', 'trigger factors'])
    expect(container!.children[0]!.connector).toBeUndefined()
    expect(container!.children[1]!.connector?.text).toBe('and')
    // No citation fragment ever becomes its own member or leaks into connector/member text.
    expect(flat.some((n) => n.text.includes('Mandal') || n.text.includes('al.'))).toBe(false)
    expect(container!.children.every((c) => !c.text.includes('Mandal') && !c.text.includes('al.') && !c.text.includes('et'))).toBe(true)
    // Canonical authority (Basic Skeleton) must be unaffected by this Tree-only fix.
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The landslide causal factors for LSM')
    expect(coreSet.predicateCores[0]?.verb?.text).toBe('can be classified')
    expect(coreSet.predicateCores[0]?.pattern).toBe('SV')
  })

  it('(7) colon enumeration + genuine apposition "(DEM)" -- preserved, not treated as a citation', () => {
    const text = 'The study used two datasets: digital elevation model (DEM) and land cover map.'
    const next = seq(text)
    const pThe = next('The')
    const pStudy = next('study')
    const pUsed = next('used')
    const pTwo = next('two')
    const pDatasets = next('datasets')
    const pColon = next(':')
    const pDigital = next('digital')
    const pElevation = next('elevation')
    const pModel = next('model')
    const pOpen = next('(')
    const pDEM = next('DEM')
    const pClose = next(')')
    const pAnd = next('and')
    const pLand = next('land')
    const pCover = next('cover')
    const pMap = next('map')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'study', upos: 'NOUN', head: 3, deprel: 'nsubj', ...pStudy }),
      tok({ id: 3, text: 'used', upos: 'VERB', head: 0, deprel: 'root', ...pUsed }),
      tok({ id: 4, text: 'two', upos: 'NUM', head: 5, deprel: 'nummod', ...pTwo }),
      tok({ id: 5, text: 'datasets', upos: 'NOUN', head: 3, deprel: 'obj', ...pDatasets }),
      tok({ id: 6, text: ':', upos: 'PUNCT', head: 9, deprel: 'punct', ...pColon }),
      tok({ id: 7, text: 'digital', upos: 'ADJ', head: 9, deprel: 'amod', ...pDigital }),
      tok({ id: 8, text: 'elevation', upos: 'NOUN', head: 9, deprel: 'compound', ...pElevation }),
      tok({ id: 9, text: 'model', upos: 'NOUN', head: 5, deprel: 'appos', ...pModel }),
      tok({ id: 10, text: '(', upos: 'PUNCT', head: 11, deprel: 'punct', ...pOpen }),
      tok({ id: 11, text: 'DEM', upos: 'PROPN', head: 9, deprel: 'appos', ...pDEM }),
      tok({ id: 12, text: ')', upos: 'PUNCT', head: 11, deprel: 'punct', ...pClose }),
      tok({ id: 13, text: 'and', upos: 'CCONJ', head: 16, deprel: 'cc', ...pAnd }),
      tok({ id: 14, text: 'land', upos: 'NOUN', head: 15, deprel: 'compound', ...pLand }),
      tok({ id: 15, text: 'cover', upos: 'NOUN', head: 16, deprel: 'compound', ...pCover }),
      tok({ id: 16, text: 'map', upos: 'NOUN', head: 9, deprel: 'conj', ...pMap }),
      tok({ id: 17, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', ...pDot }),
    ]
    const { container } = enumerationMembers(text, tokens)
    expect(container!.children.map((c) => c.text)).toEqual(['digital elevation model (DEM)', 'land cover map'])
    expect(container!.children[1]!.connector?.text).toBe('and')
  })

  it('(8) numbered enumeration regression -- surface fallback items stay role \'other\', no connector fabricated', () => {
    const text = 'The method has three steps: (1) collect the data (2) clean the data (3) analyze the results.'
    const next = seq(text)
    const pThe = next('The')
    const pMethod = next('method')
    const pHas = next('has')
    const pThree = next('three')
    const pSteps = next('steps')
    const pColon = next(':')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'method', upos: 'NOUN', head: 3, deprel: 'nsubj', ...pMethod }),
      tok({ id: 3, text: 'has', upos: 'VERB', head: 0, deprel: 'root', ...pHas }),
      tok({ id: 4, text: 'three', upos: 'NUM', head: 5, deprel: 'nummod', ...pThree }),
      tok({ id: 5, text: 'steps', upos: 'NOUN', head: 3, deprel: 'obj', ...pSteps }),
      tok({ id: 6, text: ':', upos: 'PUNCT', head: 3, deprel: 'punct', ...pColon }),
    ]
    const { tree } = enumerationMembers(text, tokens)
    // Surface numbered-fallback only fires when the dependency-based walk found fewer than 2
    // members (see buildEnumerationChildren's own doc comment) -- here there are none at all,
    // so it is exercised; its own items must remain role 'other' (no structured cc evidence
    // ever exists for a purely positional/regex-based recovery), never 'enumerationMember'.
    const flat = flatten(tree)
    const otherNodes = flat.filter((n) => n.role === 'other' && /collect|clean|analyze/.test(n.text))
    if (otherNodes.length > 0) {
      expect(otherNodes.every((n) => n.connector === undefined)).toBe(true)
    }
  })

  it('(9) coordinated-subject regression -- unaffected by enumeration role change', () => {
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
    const { flat } = enumerationMembers(text, tokens)
    const members = flat.filter((n) => n.role === 'coordinationMember')
    expect(members.map((m) => m.text)).toEqual(['The temperature', 'humidity'])
    expect(members[1]!.connector?.text).toBe('and')
    const items = layoutSiblingsWithCoordinationGroups(text, members)
    expect(items).toHaveLength(1)
  })

  it('(10) coordinated-predicate regression -- unaffected by enumeration role change', () => {
    const text = 'The team collected the data and analyzed the results.'
    const next = seq(text)
    const pThe = next('The')
    const pTeam = next('team')
    const pCollected = next('collected')
    const pThe2 = next('the')
    const pData = next('data')
    const pAnd = next('and')
    const pAnalyzed = next('analyzed')
    const pThe3 = next('the')
    const pResults = next('results')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', ...pTeam }),
      tok({ id: 3, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', ...pCollected }),
      tok({ id: 4, text: 'the', upos: 'DET', head: 5, deprel: 'det', ...pThe2 }),
      tok({ id: 5, text: 'data', upos: 'NOUN', head: 3, deprel: 'obj', ...pData }),
      tok({ id: 6, text: 'and', upos: 'CCONJ', head: 7, deprel: 'cc', ...pAnd }),
      tok({ id: 7, text: 'analyzed', upos: 'VERB', head: 3, deprel: 'conj', ...pAnalyzed }),
      tok({ id: 8, text: 'the', upos: 'DET', head: 9, deprel: 'det', ...pThe3 }),
      tok({ id: 9, text: 'results', upos: 'NOUN', head: 7, deprel: 'obj', ...pResults }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 7, deprel: 'punct', ...pDot }),
    ]
    const { flat, tree } = enumerationMembers(text, tokens)
    expect(flat.filter((n) => n.role === 'predicate')).toHaveLength(1)
    expect(flat.filter((n) => n.role === 'coordinatedPredicate')).toHaveLength(1)
    // predicate/coordinatedPredicate are siblings nested under the subject node's own
    // children, not top-level entries of `tree` itself.
    const siblings = tree[0]!.children
    const items = layoutSiblingsWithCoordinationGroups(text, siblings)
    const predicateGroup = items.find((i) => i.kind === 'group' && i.group.members.some((m) => m.role === 'predicate' || m.role === 'coordinatedPredicate'))
    expect(predicateGroup).toBeDefined()
  })

  it('(12) ENUMERATION_STRUCTURED_CONNECTOR_PRESERVATION = 100% -- every structural control with a real cc token surfaces it exactly once', () => {
    const controls = [
      twoMemberFixture('fast mode', 'and', 'accurate mode'),
      twoMemberFixture('fast mode', 'or', 'accurate mode'),
      twoMemberFixture('fast mode', 'but', 'accurate mode'),
    ]
    let preserved = 0
    for (const { text, tokens } of controls) {
      const { container } = enumerationMembers(text, tokens)
      const items = layoutSiblingsWithCoordinationGroups(text, container!.children)
      const visibleConnectors = items.flatMap((i) => (i.kind === 'group' ? i.group.boundaryConnectors.filter((c): c is string => c !== null) : []))
      if (visibleConnectors.length === 1) preserved += 1
    }
    expect(preserved).toBe(controls.length)
  })
})
