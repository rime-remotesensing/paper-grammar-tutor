import { describe, expect, it } from 'vitest'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import { layoutSiblingsWithCoordinationGroups } from '../../src/features/grammar/domain/coordinationGroupPresentation.ts'
import { buildSentenceCoreSetFromStanzaTokens } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.6C4.2C -- Coordinated Clause Connector Preservation.
 *
 * Root cause: for a coordinated predicate with its own distinct subject (e.g. "..., and THEY
 * directly affect ...", Stanza's `conj`-of-root-predicate + own `nsubj` pattern),
 * `stanzaStructureTree.ts`'s `buildClauseNode` ALREADY correctly grounds the real `cc` token
 * and attaches it as `.connector` metadata onto the "own-subject" wrapper node it builds (role
 * 'subject', wrapping the coordinated predicate as its child) -- confirmed live, the metadata
 * was never lost at that stage. But `coordinationGroupPresentation.ts`'s `groupingKey` gave
 * every 'subject'-role node the SAME key as any other clause subject, and this wrapper is the
 * ONLY 'subject'-role sibling among its own siblings (its sibling is the earlier 'predicate'
 * node, a DIFFERENT key) -- so it could never form a same-key "run" of 2+ with anything, and
 * `buildGroupFromConnectors` (which only inspects `.connector` for an already-formed run)
 * never even looked at its metadata. The connector was silently correct-but-unread, not lost
 * at extraction.
 *
 * The repair: `groupingKey` now recognizes that a 'subject'-role node carrying `.connector` is
 * NEVER an ordinary clause subject (the main/first clause subject is never given one -- only
 * `buildClauseNode`'s own-subject-wrapper path for a SECOND-or-later coordinated predicate
 * ever sets it) -- structurally this wrapper IS a coordinated sibling of the clause's earlier
 * predicate(s), so it now shares `predicateFamily`'s key and joins their run, letting the
 * EXISTING `buildGroupFromConnectors` mechanism render it exactly once, through the same
 * pipeline already used for predicate/object/NP/enumeration coordination -- no new hardcoded
 * JSX path, no lexical "and" text match.
 *
 * Fixtures use the exact raw-Stanza dependency shape confirmed by live diagnostic (`cc`
 * attaches as a direct child of the `conj` token it introduces; the second clause's own
 * subject attaches as `nsubj` of that same `conj` token).
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

/** Builds "SUBJECT1 collected the data, CONNECTOR SUBJECT2 analyzed the results." -- a
 * minimal explicit-second-subject coordinated-clause fixture matching the exact live-
 * confirmed dependency shape (second predicate is `conj` of the root predicate, its own `cc`
 * child, its own `nsubj` child distinct from the first clause's subject). */
function explicitSubjectClauseFixture(connectorWord: string): { text: string; tokens: StanzaToken[] } {
  const text = `The team collected the data, ${connectorWord} they analyzed the results.`
  const next = seq(text)
  const pThe1 = next('The')
  const pTeam = next('team')
  const pCollected = next('collected')
  const pThe2 = next('the')
  const pData = next('data')
  const pComma = next(',')
  const pConn = next(connectorWord)
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
    tok({ id: 7, text: connectorWord, upos: 'CCONJ', head: 9, deprel: 'cc', ...pConn }),
    tok({ id: 8, text: 'they', upos: 'PRON', head: 9, deprel: 'nsubj', ...pThey }),
    tok({ id: 9, text: 'analyzed', upos: 'VERB', head: 3, deprel: 'conj', ...pAnalyzed }),
    tok({ id: 10, text: 'the', upos: 'DET', head: 11, deprel: 'det', ...pThe3 }),
    tok({ id: 11, text: 'results', upos: 'NOUN', head: 9, deprel: 'obj', ...pResults }),
    tok({ id: 12, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', ...pDot }),
  ]
  return { text, tokens }
}

/**
 * Prototype 2.6G2.6C5 update: an explicit-second-subject coordinated clause is now presented
 * as an outer coordination CONTAINER (`tree[0]`, role 'clause', empty own text) whose children
 * are the two coordinate clause BRANCHES -- each its own 'subject'-role node -- as SIBLINGS,
 * never one nested inside the other (see stanzaStructureTree.ts's buildClauseNode, "CLASS B").
 * `mainSubject` here names the FIRST branch specifically (by earliest start), matching this
 * suite's original naming; callers that need "the node whose children include both branches"
 * now use `tree[0]` directly instead.
 */
function topLevelSubjectChildren(text: string, tokens: StanzaToken[]) {
  const tree = buildStanzaHierarchicalTree(text, tokens)
  const flat = flatten(tree)
  const container = tree[0]!
  const mainSubject = container.role === 'subject' ? container : container.children[0]!
  return { tree, flat, container, mainSubject }
}

describe('Prototype 2.6G2.6C4.2C -- coordinated clause connector preservation', () => {
  it('(1) Clause A, and Clause B', () => {
    const { text, tokens } = explicitSubjectClauseFixture('and')
    const { container, mainSubject } = topLevelSubjectChildren(text, tokens)
    const ownSubjectWrapper = container.children.find((c) => c.role === 'subject' && c !== mainSubject)
    expect(ownSubjectWrapper).toBeDefined()
    expect(ownSubjectWrapper!.text).toBe('they')
    expect(ownSubjectWrapper!.connector?.text).toBe('and')
    const items = layoutSiblingsWithCoordinationGroups(text, container.children)
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('group')
    if (items[0]!.kind === 'group') {
      expect(items[0]!.group.boundaryConnectors.filter((c) => c === 'and')).toHaveLength(1)
    }
  })

  it('(2) Clause A, but Clause B', () => {
    const { text, tokens } = explicitSubjectClauseFixture('but')
    const { container } = topLevelSubjectChildren(text, tokens)
    const items = layoutSiblingsWithCoordinationGroups(text, container.children)
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('group')
    if (items[0]!.kind === 'group') {
      expect(items[0]!.group.boundaryConnectors).toEqual([null, 'but'])
    }
  })

  it('(3) Clause A, or Clause B', () => {
    const { text, tokens } = explicitSubjectClauseFixture('or')
    const { container } = topLevelSubjectChildren(text, tokens)
    const items = layoutSiblingsWithCoordinationGroups(text, container.children)
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('group')
    if (items[0]!.kind === 'group') {
      expect(items[0]!.group.boundaryConnectors).toEqual([null, 'or'])
    }
  })

  it('(4) explicit subject in second clause -- copular first clause, matching the exact live shape', () => {
    const text = 'The system is a baseline model, and they extend its capabilities.'
    const next = seq(text)
    const pThe = next('The')
    const pSystem = next('system')
    const pIs = next('is')
    const pA = next('a')
    const pBaseline = next('baseline')
    const pModel = next('model')
    const pComma = next(',')
    const pAnd = next('and')
    const pThey = next('they')
    const pExtend = next('extend')
    const pIts = next('its')
    const pCapabilities = next('capabilities')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'system', upos: 'NOUN', head: 6, deprel: 'nsubj', ...pSystem }),
      tok({ id: 3, text: 'is', upos: 'AUX', head: 6, deprel: 'cop', ...pIs }),
      tok({ id: 4, text: 'a', upos: 'DET', head: 6, deprel: 'det', ...pA }),
      tok({ id: 5, text: 'baseline', upos: 'NOUN', head: 6, deprel: 'compound', ...pBaseline }),
      tok({ id: 6, text: 'model', upos: 'NOUN', head: 0, deprel: 'root', ...pModel }),
      tok({ id: 7, text: ',', upos: 'PUNCT', head: 10, deprel: 'punct', ...pComma }),
      tok({ id: 8, text: 'and', upos: 'CCONJ', head: 10, deprel: 'cc', ...pAnd }),
      tok({ id: 9, text: 'they', upos: 'PRON', head: 10, deprel: 'nsubj', ...pThey }),
      tok({ id: 10, text: 'extend', upos: 'VERB', head: 6, deprel: 'conj', ...pExtend }),
      tok({ id: 11, text: 'its', upos: 'PRON', head: 12, deprel: 'nmod:poss', ...pIts }),
      tok({ id: 12, text: 'capabilities', upos: 'NOUN', head: 10, deprel: 'obj', ...pCapabilities }),
      tok({ id: 13, text: '.', upos: 'PUNCT', head: 6, deprel: 'punct', ...pDot }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    // Canonical authority remains SVC for the primary clause -- the second coordinated clause
    // is additional Tree structure only (section 18), never a reason to change the primary core.
    expect(coreSet.subject?.text).toBe('The system')
    expect(coreSet.predicateCores[0]?.pattern).toBe('SVC')

    const { container } = topLevelSubjectChildren(text, tokens)
    const items = layoutSiblingsWithCoordinationGroups(text, container.children)
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('group')
    if (items[0]!.kind === 'group') {
      expect(items[0]!.group.boundaryConnectors).toEqual([null, 'and'])
    }
  })

  it('(5) shared-subject predicate coordination regression -- unaffected', () => {
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
    const { tree, mainSubject } = topLevelSubjectChildren(text, tokens)
    expect(tree).toHaveLength(1)
    const predicateFamily = mainSubject.children.filter((c) => c.role === 'predicate' || c.role === 'coordinatedPredicate')
    expect(predicateFamily.map((c) => c.text)).toEqual(['were collected', 'analyzed'])
    // Never wrapped in a fake second subject -- shared-subject coordination stays exactly as
    // predicate + coordinatedPredicate siblings, matching the pre-existing established shape.
    expect(mainSubject.children.some((c) => c.role === 'subject')).toBe(false)
    const items = layoutSiblingsWithCoordinationGroups(text, mainSubject.children)
    expect(items).toHaveLength(1)
    if (items[0]!.kind === 'group') {
      expect(items[0]!.group.boundaryConnectors.filter((c) => c === 'and')).toHaveLength(1)
    }
  })

  it('(6) coordinated subject regression -- unaffected', () => {
    const text = 'Temperature and humidity were evaluated.'
    const next = seq(text)
    const pTemperature = next('Temperature')
    const pAnd = next('and')
    const pHumidity = next('humidity')
    const pWere = next('were')
    const pEvaluated = next('evaluated')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Temperature', upos: 'NOUN', head: 5, deprel: 'nsubj:pass', ...pTemperature }),
      tok({ id: 2, text: 'and', upos: 'CCONJ', head: 3, deprel: 'cc', ...pAnd }),
      tok({ id: 3, text: 'humidity', upos: 'NOUN', head: 1, deprel: 'conj', ...pHumidity }),
      tok({ id: 4, text: 'were', upos: 'AUX', head: 5, deprel: 'aux:pass', ...pWere }),
      tok({ id: 5, text: 'evaluated', upos: 'VERB', head: 0, deprel: 'root', ...pEvaluated }),
      tok({ id: 6, text: '.', upos: 'PUNCT', head: 5, deprel: 'punct', ...pDot }),
    ]
    const { flat } = topLevelSubjectChildren(text, tokens)
    const members = flat.filter((n) => n.role === 'coordinationMember')
    expect(members.map((m) => m.text)).toEqual(['Temperature', 'humidity'])
    expect(members[1]!.connector?.text).toBe('and')
  })

  it('(7) coordinated object regression -- unaffected', () => {
    const text = 'The team analyzed rainfall and soil type.'
    const next = seq(text)
    const pThe = next('The')
    const pTeam = next('team')
    const pAnalyzed = next('analyzed')
    const pRainfall = next('rainfall')
    const pAnd = next('and')
    const pSoil = next('soil')
    const pType = next('type')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', ...pTeam }),
      tok({ id: 3, text: 'analyzed', upos: 'VERB', head: 0, deprel: 'root', ...pAnalyzed }),
      tok({ id: 4, text: 'rainfall', upos: 'NOUN', head: 3, deprel: 'obj', ...pRainfall }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 7, deprel: 'cc', ...pAnd }),
      tok({ id: 6, text: 'soil', upos: 'NOUN', head: 7, deprel: 'compound', ...pSoil }),
      tok({ id: 7, text: 'type', upos: 'NOUN', head: 4, deprel: 'conj', ...pType }),
      tok({ id: 8, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', ...pDot }),
    ]
    const { flat } = topLevelSubjectChildren(text, tokens)
    const members = flat.filter((n) => n.role === 'coordinationMember')
    expect(members.map((m) => m.text)).toEqual(['rainfall', 'soil type'])
    expect(members[1]!.connector?.text).toBe('and')
  })

  it('(8) trailing citation on second clause -- connector preserved, citation excluded, object intact', () => {
    // The exact live diagnostic control's own dependency shape.
    const text = 'Landslide inventories are an essential basis for landslide susceptibility analysis, and they directly affect the reliability of the results (Deng et al. 2022).'
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
      tok({ id: 21, text: '(', upos: 'PUNCT', head: 22, deprel: 'punct', start: 140, end: 141 }),
      tok({ id: 22, text: 'Deng', upos: 'PROPN', head: 6, deprel: 'dep', start: 141, end: 145 }),
      tok({ id: 23, text: 'et', upos: 'X', head: 24, deprel: 'cc', start: 146, end: 148 }),
      tok({ id: 24, text: 'al.', upos: 'X', head: 22, deprel: 'conj', start: 149, end: 152 }),
      tok({ id: 25, text: '2022', upos: 'NUM', head: 22, deprel: 'nmod:unmarked', start: 153, end: 157 }),
      tok({ id: 26, text: ')', upos: 'PUNCT', head: 22, deprel: 'punct', start: 157, end: 158 }),
      tok({ id: 27, text: '.', upos: 'PUNCT', head: 6, deprel: 'punct', start: 158, end: 159 }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('Landslide inventories')
    expect(coreSet.predicateCores[0]?.verb?.text).toBe('are')
    expect(coreSet.predicateCores[0]?.complement?.text).toBe('an essential basis for landslide susceptibility analysis')
    expect(coreSet.predicateCores[0]?.pattern).toBe('SVC')

    const { flat, container, mainSubject } = topLevelSubjectChildren(text, tokens)
    const ownSubjectWrapper = container.children.find((c) => c.role === 'subject' && c !== mainSubject)
    expect(ownSubjectWrapper!.text).toBe('they')
    expect(ownSubjectWrapper!.connector?.text).toBe('and')
    const objectNode = flat.find((n) => n.role === 'object')
    expect(objectNode!.text).toBe('the reliability of the results')
    expect(flat.some((n) => n.text.includes('Deng') || n.text.includes('al.'))).toBe(false)
    const items = layoutSiblingsWithCoordinationGroups(text, container.children)
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('group')
    if (items[0]!.kind === 'group') {
      expect(items[0]!.group.boundaryConnectors).toEqual([null, 'and'])
    }
  })

  it('(9) connector exactly once (VISIBLE_CONNECTOR_DUPLICATION = 0)', () => {
    const { text, tokens } = explicitSubjectClauseFixture('and')
    const { container } = topLevelSubjectChildren(text, tokens)
    const items = layoutSiblingsWithCoordinationGroups(text, container.children)
    const andCount = items.flatMap((i) => (i.kind === 'group' ? i.group.boundaryConnectors.filter((c) => c === 'and') : [])).length
    expect(andCount).toBe(1)
  })

  it('(10) punctuation-only negative -- no cc token, no connector invented', () => {
    const text = 'The results were promising; the team decided to continue the study.'
    const next = seq(text)
    const pThe1 = next('The')
    const pResults = next('results')
    const pWere = next('were')
    const pPromising = next('promising')
    const pSemi = next(';')
    const pThe2 = next('the')
    const pTeam = next('team')
    const pDecided = next('decided')
    const pTo = next('to')
    const pContinue = next('continue')
    const pThe3 = next('the')
    const pStudy = next('study')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe1 }),
      tok({ id: 2, text: 'results', upos: 'NOUN', head: 4, deprel: 'nsubj', ...pResults }),
      tok({ id: 3, text: 'were', upos: 'AUX', head: 4, deprel: 'cop', ...pWere }),
      tok({ id: 4, text: 'promising', upos: 'ADJ', head: 0, deprel: 'root', ...pPromising }),
      tok({ id: 5, text: ';', upos: 'PUNCT', head: 8, deprel: 'punct', ...pSemi }),
      tok({ id: 6, text: 'the', upos: 'DET', head: 7, deprel: 'det', ...pThe2 }),
      tok({ id: 7, text: 'team', upos: 'NOUN', head: 8, deprel: 'nsubj', ...pTeam }),
      tok({ id: 8, text: 'decided', upos: 'VERB', head: 4, deprel: 'parataxis', ...pDecided }),
      tok({ id: 9, text: 'to', upos: 'PART', head: 10, deprel: 'mark', ...pTo }),
      tok({ id: 10, text: 'continue', upos: 'VERB', head: 8, deprel: 'xcomp', ...pContinue }),
      tok({ id: 11, text: 'the', upos: 'DET', head: 12, deprel: 'det', ...pThe3 }),
      tok({ id: 12, text: 'study', upos: 'NOUN', head: 10, deprel: 'obj', ...pStudy }),
      tok({ id: 13, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', ...pDot }),
    ]
    const { tree } = topLevelSubjectChildren(text, tokens)
    // A semicolon-separated parataxis clause becomes its own SEPARATE top-level structure --
    // never a connector-carrying sibling, and never any invented connector anywhere.
    const flatAll = flatten(tree)
    expect(flatAll.every((n) => n.connector === undefined)).toBe(true)
  })

  it('(11) colon-enumeration regression -- unaffected by the clause-connector fix', () => {
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
    const { flat } = topLevelSubjectChildren(text, tokens)
    const enumContainer = flat.find((n) => n.role === 'enumeration')
    expect(enumContainer!.children.map((c) => c.text)).toEqual(['causative factors', 'trigger factors'])
    expect(enumContainer!.children[1]!.connector?.text).toBe('and')
    expect(flat.some((n) => n.text.includes('Mandal') || n.text.includes('al.'))).toBe(false)
  })

  it('(12) source-grounded connector span -- .connector.text always equals the real source slice', () => {
    const { text, tokens } = explicitSubjectClauseFixture('and')
    const { container, mainSubject } = topLevelSubjectChildren(text, tokens)
    const ownSubjectWrapper = container.children.find((c) => c.role === 'subject' && c !== mainSubject)!
    const connector = ownSubjectWrapper.connector!
    expect(connector.text).toBe(text.slice(connector.start, connector.end))
    expect(connector.text).toBe('and')
  })
})
