import { describe, expect, it } from 'vitest'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import { layoutSiblingsWithCoordinationGroups } from '../../src/features/grammar/domain/coordinationGroupPresentation.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.6C5 -- Unified Coordination Presentation Consolidation.
 *
 * Covers the two genuinely NEW mechanics this phase introduces (Class A enumeration, Class D
 * shared-subject predicate coordination, connector-duplication, and citation-safety are
 * already extensively covered by the existing accepted suites -- stanzaStructureTreeCoordinatedClauseConnector.test.ts,
 * stanzaStructureTreeEnumerationConnector.test.ts, stanzaStructureTreeNonCoreSupplement.test.ts
 * -- and are re-run unchanged as part of the full suite, not duplicated here):
 *
 * CLASS B (clause coordination): a later coordinated predicate with its OWN distinct explicit
 * subject now produces a top-level coordination CONTAINER (role 'clause', empty own text)
 * whose children are coordinate clause BRANCHES as SIBLINGS -- never one subject nested inside
 * the other's own subtree.
 *
 * CLASS C (canonical constituent coordination): a premodifier chain sharing one final head
 * noun (e.g. "Ordovician, Silurian, ..., and igneous ROCKS of various stages") decomposes into
 * 'coordinationMember' children under the canonical slot, the container's own displayed text
 * collapsing to '' (all content shown once, via children), while the canonical slot's own
 * grounded authority text/start/end stay byte-identical to SentenceCoreSet.
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

// ----------------------------------------------------------------------------
// CLASS B -- clause coordination: sibling hierarchy generalization.
// ----------------------------------------------------------------------------

/** "SUBJECT1 VERB1 ..., CONNECTOR SUBJECT2 VERB2 ..." -- explicit second-subject shape. */
function twoClauseFixture(connectorWord: string, secondSubject: string): { text: string; tokens: StanzaToken[] } {
  const secondSubjectWords = secondSubject.split(' ')
  const text = `The team collected the data, ${connectorWord} ${secondSubject} analyzed the results.`
  const next = seq(text)
  const pThe1 = next('The')
  const pTeam = next('team')
  const pCollected = next('collected')
  const pThe2 = next('the')
  const pData = next('data')
  const pComma = next(',')
  const pConn = next(connectorWord)
  // "analyzed" (the second clause's own predicate head) is id `analyzedId`, positioned right
  // after the second subject's own word tokens (ids 8..8+len-1) -- computed up front so every
  // token that needs to reference it (comma/cc/subject words) can do so correctly regardless
  // of how many words the second subject itself has.
  const analyzedId = 8 + secondSubjectWords.length
  const tokens: StanzaToken[] = [
    tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe1 }),
    tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', ...pTeam }),
    tok({ id: 3, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', ...pCollected }),
    tok({ id: 4, text: 'the', upos: 'DET', head: 5, deprel: 'det', ...pThe2 }),
    tok({ id: 5, text: 'data', upos: 'NOUN', head: 3, deprel: 'obj', ...pData }),
    tok({ id: 6, text: ',', upos: 'PUNCT', head: analyzedId, deprel: 'punct', ...pComma }),
    tok({ id: 7, text: connectorWord, upos: 'CCONJ', head: analyzedId, deprel: 'cc', ...pConn }),
  ]
  let nextId = 8
  const secondSubjectHeadId = analyzedId - 1
  secondSubjectWords.forEach((w, i) => {
    const p = next(w)
    const isLast = i === secondSubjectWords.length - 1
    tokens.push(tok({ id: nextId, text: w, upos: isLast ? 'NOUN' : 'DET', head: isLast ? analyzedId : secondSubjectHeadId, deprel: isLast ? 'nsubj' : 'det', ...p }))
    nextId += 1
  })
  const pAnalyzed = next('analyzed')
  tokens.push(tok({ id: analyzedId, text: 'analyzed', upos: 'VERB', head: 3, deprel: 'conj', ...pAnalyzed }))
  nextId = analyzedId + 1
  const pThe3 = next('the')
  const pResults = next('results')
  tokens.push(
    tok({ id: nextId, text: 'the', upos: 'DET', head: nextId + 1, deprel: 'det', ...pThe3 }),
    tok({ id: nextId + 1, text: 'results', upos: 'NOUN', head: analyzedId, deprel: 'obj', ...pResults }),
  )
  const pDot = next('.')
  tokens.push(tok({ id: nextId + 2, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', ...pDot }))
  return { text, tokens }
}

describe('Prototype 2.6G2.6C5 -- Class B: clause coordination sibling hierarchy', () => {
  it('(4) Clause A and Clause B with explicit second subject -- two sibling branches, never one nested in the other', () => {
    const { text, tokens } = twoClauseFixture('and', 'they')
    const { tree } = build(text, tokens)
    const container = tree[0]!
    expect(container.role).toBe('clause')
    expect(container.text).toBe('')
    const branches = container.children.filter((c) => c.role === 'subject')
    expect(branches).toHaveLength(2)
    expect(branches[0]!.text).toBe('The team')
    expect(branches[1]!.text).toBe('they')
    expect(branches[1]!.connector?.text).toBe('and')
    // "they" is a SIBLING of "The team", never a descendant of it.
    expect(branches[0]!.children.some((c) => c.text === 'they')).toBe(false)
    expect(branches[1]!.children.some((c) => c.role === 'coordinatedPredicate' && c.text === 'analyzed')).toBe(true)
  })

  it('(5) Clause A but Clause B -- connector "but" preserved on the sibling boundary', () => {
    const { text, tokens } = twoClauseFixture('but', 'they')
    const { tree } = build(text, tokens)
    const container = tree[0]!
    const items = layoutSiblingsWithCoordinationGroups(text, container.children)
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('group')
    if (items[0]!.kind === 'group') expect(items[0]!.group.boundaryConnectors).toEqual([null, 'but'])
  })

  it('(6) Clause A or Clause B -- connector "or" preserved on the sibling boundary', () => {
    const { text, tokens } = twoClauseFixture('or', 'they')
    const { tree } = build(text, tokens)
    const container = tree[0]!
    const items = layoutSiblingsWithCoordinationGroups(text, container.children)
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('group')
    if (items[0]!.kind === 'group') expect(items[0]!.group.boundaryConnectors).toEqual([null, 'or'])
  })

  it('(7) full-NP second subject -- generalizes beyond a bare pronoun', () => {
    const { text, tokens } = twoClauseFixture('and', 'the research team')
    const { tree } = build(text, tokens)
    const container = tree[0]!
    const branches = container.children.filter((c) => c.role === 'subject')
    expect(branches).toHaveLength(2)
    expect(branches[1]!.text).toBe('the research team')
    expect(branches[1]!.connector?.text).toBe('and')
  })

  it('(8) shared-subject negative -- no distinct second subject stays ordinary predicate coordination, never split into sibling branches', () => {
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
    const { tree } = build(text, tokens)
    expect(tree).toHaveLength(1)
    expect(tree[0]!.role).toBe('subject')
    expect(tree[0]!.text).toBe('The observations')
    expect(tree[0]!.children.some((c) => c.role === 'subject')).toBe(false)
    const predicateFamily = tree[0]!.children.filter((c) => c.role === 'predicate' || c.role === 'coordinatedPredicate')
    expect(predicateFamily.map((c) => c.text)).toEqual(['were collected', 'analyzed'])
  })
})

// ----------------------------------------------------------------------------
// CLASS C -- canonical constituent coordination: shared-head trailing member.
// ----------------------------------------------------------------------------

/** Builds "SUBJECT VERB A, B, ..., and FINALADJ HEAD." -- the elliptical shared-head-noun
 * coordination pattern (e.g. "includes Ordovician, Silurian, and igneous rocks"), matching the
 * exact live-confirmed dependency shape: each earlier item is a bare `amod` chained via `conj`
 * from the first, each preceded by its own comma PUNCT token (attaching forward to itself, the
 * same shape the live diagnostic confirmed -- required for `hasCommaBetween` to recognize the
 * chain as a genuine comma-separated list); the final item is a separate `amod` sibling of
 * `head` itself, introduced by `head`'s own direct `cc` child. `items` needs at least 2 entries
 * -- Stanza only produces an explicit `conj` CHAIN when 2+ premodifiers genuinely coordinate
 * with each other; a lone single premodifier plus the final shared-head item is a bare 2-item
 * pair with no chain to detect at all (a structurally different, narrower shape this fixture
 * does not attempt to model). */
function sharedHeadCoordinationFixture(items: string[], finalAdj: string, headNoun: string): { text: string; tokens: StanzaToken[] } {
  const text = `The report includes ${items.join(', ')}, and ${finalAdj} ${headNoun}.`
  const next = seq(text)
  const pThe = next('The')
  const pReport = next('report')
  const pIncludes = next('includes')
  const tokens: StanzaToken[] = [
    tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
    tok({ id: 2, text: 'report', upos: 'NOUN', head: 3, deprel: 'nsubj', ...pReport }),
    tok({ id: 3, text: 'includes', upos: 'VERB', head: 0, deprel: 'root', ...pIncludes }),
  ]
  let nextId = 4
  let firstItemId = 0
  items.forEach((item, i) => {
    if (i > 0) {
      const pComma = next(',')
      tokens.push(tok({ id: nextId, text: ',', upos: 'PUNCT', head: nextId + 1, deprel: 'punct', ...pComma }))
      nextId += 1
    }
    const p = next(item)
    const id = nextId
    nextId += 1
    tokens.push(tok({ id, text: item, upos: 'ADJ', head: i === 0 ? 0 /* patched below */ : firstItemId, deprel: i === 0 ? 'amod' : 'conj', ...p }))
    if (i === 0) firstItemId = id
  })
  // head noun's own children: amod chain root (already pushed), trailing comma, cc, final
  // amod, itself -- matching the exact live-confirmed shape (a comma also precedes "and").
  const headNounId = nextId + 3
  tokens.find((t) => t.id === firstItemId)!.head = headNounId
  const pTrailingComma = next(',')
  tokens.push(tok({ id: nextId, text: ',', upos: 'PUNCT', head: headNounId, deprel: 'punct', ...pTrailingComma }))
  nextId += 1
  const pAnd = next('and')
  const andId = nextId
  nextId += 1
  tokens.push(tok({ id: andId, text: 'and', upos: 'CCONJ', head: headNounId, deprel: 'cc', ...pAnd }))
  const pFinalAdj = next(finalAdj)
  const finalAdjId = nextId
  nextId += 1
  tokens.push(tok({ id: finalAdjId, text: finalAdj, upos: 'ADJ', head: headNounId, deprel: 'amod', ...pFinalAdj }))
  const pHeadNoun = next(headNoun)
  tokens.push(tok({ id: headNounId, text: headNoun, upos: 'NOUN', head: 3, deprel: 'obj', ...pHeadNoun }))
  const pDot = next('.')
  tokens.push(tok({ id: headNounId + 1, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', ...pDot }))
  return { text, tokens: tokens.sort((a, b) => a.id - b.id) }
}

describe('Prototype 2.6G2.6C5 -- Class C: canonical constituent coordination (shared-head trailing member)', () => {
  it('(9) two-member canonical object (minimum realistic shape: one comma-chained premodifier + the final shared-head item)', () => {
    const { text, tokens } = sharedHeadCoordinationFixture(['Ordovician', 'Silurian'], 'igneous', 'rocks')
    const { tree, flat } = build(text, tokens)
    const objectNode = flat.find((n) => n.role === 'object')!
    expect(objectNode.presentationSpan?.text).toBe('')
    expect(objectNode.children.map((c) => c.text)).toEqual(['Ordovician', 'Silurian', 'igneous rocks'])
    expect(objectNode.children[2]!.connector?.text).toBe('and')
    expect(objectNode.text).toBe('Ordovician, Silurian, and igneous rocks') // authority span untouched
    expect(tree[0]!.text).toBe('The report')
  })

  it('(10) four-member canonical object', () => {
    const { text, tokens } = sharedHeadCoordinationFixture(['Ordovician', 'Silurian', 'Devonian'], 'igneous', 'rocks')
    const { flat } = build(text, tokens)
    const objectNode = flat.find((n) => n.role === 'object')!
    expect(objectNode.children.map((c) => c.text)).toEqual(['Ordovician', 'Silurian', 'Devonian', 'igneous rocks'])
    expect(objectNode.children[0]!.connector).toBeUndefined()
    expect(objectNode.children[1]!.connector).toBeUndefined()
    expect(objectNode.children[2]!.connector).toBeUndefined()
    expect(objectNode.children[3]!.connector?.text).toBe('and')
  })

  it('(11) six-member canonical object -- the exact live diagnostic control shape', () => {
    const { text, tokens } = sharedHeadCoordinationFixture(
      ['Ordovician', 'Silurian', 'Devonian', 'Carboniferous', 'Quaternary'],
      'igneous',
      'rocks',
    )
    const { flat } = build(text, tokens)
    const objectNode = flat.find((n) => n.role === 'object')!
    expect(objectNode.children.map((c) => c.text)).toEqual([
      'Ordovician',
      'Silurian',
      'Devonian',
      'Carboniferous',
      'Quaternary',
      'igneous rocks',
    ])
    expect(objectNode.children.every((c) => c.role === 'coordinationMember')).toBe(true)
    expect(objectNode.children.at(-1)!.connector?.text).toBe('and')
    // No false modifier roles (CANONICAL_COORDINATION_FALSE_MODIFIER_ROLE = 0).
    expect(flat.some((n) => n.role === 'modifier' && (n.text === 'Ordovician' || n.text === 'Silurian'))).toBe(false)
  })

  it('(24) no false modifier roles / no lost members -- member coverage + false-modifier gate together', () => {
    const { text, tokens } = sharedHeadCoordinationFixture(['Alpha', 'Beta', 'Gamma'], 'final', 'units')
    const { flat } = build(text, tokens)
    const objectNode = flat.find((n) => n.role === 'object')!
    const memberTexts = objectNode.children.map((c) => c.text)
    expect(memberTexts).toEqual(['Alpha', 'Beta', 'Gamma', 'final units'])
    expect(new Set(memberTexts).size).toBe(memberTexts.length)
    expect(objectNode.children.every((c) => c.role === 'coordinationMember')).toBe(true)
  })
})

// ----------------------------------------------------------------------------
// CLASS C slot generalization -- subject / complement, not just object.
// ----------------------------------------------------------------------------

describe('Prototype 2.6G2.6C5 -- Class C slot generalization (subject/complement)', () => {
  it('(12) canonical subject coordination -- shared-head trailing member as SUBJECT', () => {
    const text = 'Ordovician, Silurian, and igneous rocks were sampled.'
    const next = seq(text)
    const pOrdovician = next('Ordovician')
    const pC1 = next(',')
    const pSilurian = next('Silurian')
    const pC2 = next(',')
    const pAnd = next('and')
    const pIgneous = next('igneous')
    const pRocks = next('rocks')
    const pWere = next('were')
    const pSampled = next('sampled')
    const pDot = next('.')
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Ordovician', upos: 'ADJ', head: 7, deprel: 'amod', ...pOrdovician }),
      tok({ id: 2, text: ',', upos: 'PUNCT', head: 3, deprel: 'punct', ...pC1 }),
      tok({ id: 3, text: 'Silurian', upos: 'ADJ', head: 1, deprel: 'conj', ...pSilurian }),
      tok({ id: 4, text: ',', upos: 'PUNCT', head: 7, deprel: 'punct', ...pC2 }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 7, deprel: 'cc', ...pAnd }),
      tok({ id: 6, text: 'igneous', upos: 'ADJ', head: 7, deprel: 'amod', ...pIgneous }),
      tok({ id: 7, text: 'rocks', upos: 'NOUN', head: 9, deprel: 'nsubj:pass', ...pRocks }),
      tok({ id: 8, text: 'were', upos: 'AUX', head: 9, deprel: 'aux:pass', ...pWere }),
      tok({ id: 9, text: 'sampled', upos: 'VERB', head: 0, deprel: 'root', ...pSampled }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 9, deprel: 'punct', ...pDot }),
    ]
    const { tree } = build(text, tokens)
    const subjectNode = tree[0]!
    expect(subjectNode.role).toBe('subject')
    expect(subjectNode.presentationSpan?.text).toBe('')
    // The subject's own coordination members -- the sibling predicate ("were sampled") is
    // also legitimately a child here (ordinary single-clause subject-wraps-predicate nesting,
    // unrelated to this coordination), so this filters to just the coordinationMember set.
    const members = subjectNode.children.filter((c) => c.role === 'coordinationMember')
    expect(members.map((c) => c.text)).toEqual(['Ordovician', 'Silurian', 'igneous rocks'])
    expect(members.at(-1)!.connector?.text).toBe('and')
    expect(subjectNode.children.some((c) => c.role === 'predicate' && c.text === 'were sampled')).toBe(true)
  })

  it('(13) canonical complement coordination -- shared-head trailing member as COMPLEMENT', () => {
    const text = 'The samples are Ordovician, Silurian, and igneous rocks.'
    const next = seq(text)
    const pThe = next('The')
    const pSamples = next('samples')
    const pAre = next('are')
    const pOrdovician = next('Ordovician')
    const pC1 = next(',')
    const pSilurian = next('Silurian')
    const pC2 = next(',')
    const pAnd = next('and')
    const pIgneous = next('igneous')
    const pRocks = next('rocks')
    const pDot = next('.')
    // Root = "rocks" (id 10); "are" is its cop, "samples" its nsubj -- standard UD copular
    // shape, matching the same fixture pattern the subject/object variants above already use.
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pThe }),
      tok({ id: 2, text: 'samples', upos: 'NOUN', head: 10, deprel: 'nsubj', ...pSamples }),
      tok({ id: 3, text: 'are', upos: 'AUX', head: 10, deprel: 'cop', ...pAre }),
      tok({ id: 4, text: 'Ordovician', upos: 'ADJ', head: 10, deprel: 'amod', ...pOrdovician }),
      tok({ id: 5, text: ',', upos: 'PUNCT', head: 6, deprel: 'punct', ...pC1 }),
      tok({ id: 6, text: 'Silurian', upos: 'ADJ', head: 4, deprel: 'conj', ...pSilurian }),
      tok({ id: 7, text: ',', upos: 'PUNCT', head: 10, deprel: 'punct', ...pC2 }),
      tok({ id: 8, text: 'and', upos: 'CCONJ', head: 10, deprel: 'cc', ...pAnd }),
      tok({ id: 9, text: 'igneous', upos: 'ADJ', head: 10, deprel: 'amod', ...pIgneous }),
      tok({ id: 10, text: 'rocks', upos: 'NOUN', head: 0, deprel: 'root', ...pRocks }),
      tok({ id: 11, text: '.', upos: 'PUNCT', head: 10, deprel: 'punct', ...pDot }),
    ]
    const { flat } = build(text, tokens)
    const complementNode = flat.find((n) => n.role === 'complement')!
    expect(complementNode).toBeDefined()
    expect(complementNode.presentationSpan?.text).toBe('')
    expect(complementNode.children.map((c) => c.text)).toEqual(['Ordovician', 'Silurian', 'igneous rocks'])
    expect(complementNode.children.at(-1)!.connector?.text).toBe('and')
  })
})
