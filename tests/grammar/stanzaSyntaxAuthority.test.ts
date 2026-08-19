import { describe, expect, it } from 'vitest'
import { buildClauseFrames, buildSentenceCoreSetFromStanzaTokens, type StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import { projectPrimaryCore } from '../../src/features/grammar/domain/sentenceCoreSet.ts'

/** Minimal hand-built dependency graphs, independent of the benchmark artifacts, so these
 * unit tests read standalone and don't depend on any JSON fixture being present on disk
 * (the 96-case behavioral parity is covered separately by stanzaSyntaxAuthorityParity.test.ts). */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

function childrenByHead(tokens: StanzaToken[]) {
  const byHead = new Map<number, StanzaToken[]>()
  for (const token of tokens) {
    if (!byHead.has(token.head)) byHead.set(token.head, [])
    byHead.get(token.head)!.push(token)
  }
  return byHead
}

describe('ClauseFrame construction', () => {
  it('registers exactly one main clause for a simple sentence', () => {
    // "The system works."
    const text = 'The system works.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'system', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: 'works', upos: 'VERB', head: 0, deprel: 'root', start: 11, end: 16 }),
      tok({ id: 4, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 16, end: 17 }),
    ]
    const clauses = buildClauseFrames(text, tokens, childrenByHead(tokens))
    expect(clauses).toHaveLength(1)
    expect(clauses[0]!.relation).toBe('main')
    expect(clauses[0]!.headTokenId).toBe(3)
  })

  it('excludes a subordinate clause verb from the main clause predicate chain', () => {
    // "Because A omits X, the model reports Y." -- "omits" must never join "reports"'s chain.
    const text = 'Because A omits X, the model reports Y.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Because', upos: 'SCONJ', head: 3, deprel: 'mark', start: 0, end: 7 }),
      tok({ id: 2, text: 'A', upos: 'PROPN', head: 3, deprel: 'nsubj', start: 8, end: 9 }),
      tok({ id: 3, text: 'omits', upos: 'VERB', head: 7, deprel: 'advcl', start: 10, end: 15 }),
      tok({ id: 4, text: 'X', upos: 'PROPN', head: 3, deprel: 'obj', start: 16, end: 17 }),
      tok({ id: 5, text: 'the', upos: 'DET', head: 6, deprel: 'det', start: 19, end: 22 }),
      tok({ id: 6, text: 'model', upos: 'NOUN', head: 7, deprel: 'nsubj', start: 23, end: 28 }),
      tok({ id: 7, text: 'reports', upos: 'VERB', head: 0, deprel: 'root', start: 29, end: 36 }),
      tok({ id: 8, text: 'Y', upos: 'PROPN', head: 7, deprel: 'obj', start: 37, end: 38 }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.predicateCores).toHaveLength(1)
    expect(coreSet.predicateCores[0]!.verb?.text).toBe('reports')
    // subordinate predicate leakage: "omits" must not appear anywhere in the core set
    expect(coreSet.predicateCores.some((c) => c.verb?.text === 'omits')).toBe(false)
  })
})

describe('coordination', () => {
  it('preserves a coordinated second predicate core with a connector', () => {
    // "The system collects data and reports it."
    const text = 'The system collects data and reports it.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'system', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: 'collects', upos: 'VERB', head: 0, deprel: 'root', start: 11, end: 19 }),
      tok({ id: 4, text: 'data', upos: 'NOUN', head: 3, deprel: 'obj', start: 20, end: 24 }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 6, deprel: 'cc', start: 25, end: 28 }),
      tok({ id: 6, text: 'reports', upos: 'VERB', head: 3, deprel: 'conj', start: 29, end: 36 }),
      tok({ id: 7, text: 'it', upos: 'PRON', head: 6, deprel: 'obj', start: 37, end: 39 }),
      tok({ id: 8, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 39, end: 40 }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.predicateCores).toHaveLength(2)
    expect(coreSet.predicateCores[0]!.relation).toBe('main')
    expect(coreSet.predicateCores[1]!.relation).toBe('coordinated')
    expect(coreSet.predicateCores[1]!.connector?.text).toBe('and')
    expect(coreSet.predicateCores[1]!.verb?.text).toBe('reports')
  })
})

describe('copula and complement semantics', () => {
  it('splits V = copula, C = lexical predicate phrase', () => {
    // "The result is significant."
    const text = 'The result is significant.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'result', upos: 'NOUN', head: 4, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: 'is', upos: 'AUX', head: 4, deprel: 'cop', start: 11, end: 13 }),
      tok({ id: 4, text: 'significant', upos: 'ADJ', head: 0, deprel: 'root', start: 14, end: 25 }),
      tok({ id: 5, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', start: 25, end: 26 }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.predicateCores[0]!.verb?.text).toBe('is')
    expect(coreSet.predicateCores[0]!.complement?.text).toBe('significant')
    expect(coreSet.predicateCores[0]!.pattern).toBe('SVC')
    expect(coreSet.predicateCores[0]!.object).toBeNull()
  })

  it('never assigns an ordinary predicate modifier PP to complement (false-C safety)', () => {
    // "The team worked in the laboratory." -- SV, "in the laboratory" is a PP modifier, not C.
    const text = 'The team worked in the laboratory.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'worked', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 15 }),
      tok({ id: 4, text: 'in', upos: 'ADP', head: 6, deprel: 'case', start: 16, end: 18 }),
      tok({ id: 5, text: 'the', upos: 'DET', head: 6, deprel: 'det', start: 19, end: 22 }),
      tok({ id: 6, text: 'laboratory', upos: 'NOUN', head: 3, deprel: 'obl', start: 23, end: 33 }),
      tok({ id: 7, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 33, end: 34 }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.predicateCores[0]!.complement).toBeNull()
    expect(coreSet.predicateCores[0]!.object).toBeNull()
    expect(coreSet.predicateCores[0]!.pattern).toBe('SV')
  })
})

describe('passive', () => {
  it('produces SV with no fabricated complement/object for a plain passive', () => {
    // "The sample was tested." -- aux:pass + root VERB, no cop.
    const text = 'The sample was tested.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'sample', upos: 'NOUN', head: 4, deprel: 'nsubj:pass', start: 4, end: 10 }),
      tok({ id: 3, text: 'was', upos: 'AUX', head: 4, deprel: 'aux:pass', start: 11, end: 14 }),
      tok({ id: 4, text: 'tested', upos: 'VERB', head: 0, deprel: 'root', start: 15, end: 21 }),
      tok({ id: 5, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', start: 21, end: 22 }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.predicateCores[0]!.verb?.text).toBe('was tested')
    expect(coreSet.predicateCores[0]!.object).toBeNull()
    expect(coreSet.predicateCores[0]!.complement).toBeNull()
    expect(coreSet.predicateCores[0]!.pattern).toBe('SV')
  })
})

describe('lexical linking verb complement (xcomp)', () => {
  it('maps an ADJ-headed xcomp to complement for a non-copula linking verb', () => {
    // "The pattern remained stable." -- "remained" has no cop child; "stable" attaches via xcomp.
    const text = 'The pattern remained stable.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'pattern', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 11 }),
      tok({ id: 3, text: 'remained', upos: 'VERB', head: 0, deprel: 'root', start: 12, end: 20 }),
      tok({ id: 4, text: 'stable', upos: 'ADJ', head: 3, deprel: 'xcomp', start: 21, end: 27 }),
      tok({ id: 5, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 27, end: 28 }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.predicateCores[0]!.verb?.text).toBe('remained')
    expect(coreSet.predicateCores[0]!.complement?.text).toBe('stable')
    expect(coreSet.predicateCores[0]!.pattern).toBe('SVC')
  })

  it('leaves a VERB-headed xcomp unmapped (catenative, not a 5-pattern complement)', () => {
    // "The team began to investigate." -- "investigate" (VERB) must never become C.
    const text = 'The team began to investigate.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'began', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 14 }),
      tok({ id: 4, text: 'to', upos: 'PART', head: 5, deprel: 'mark', start: 15, end: 17 }),
      tok({ id: 5, text: 'investigate', upos: 'VERB', head: 3, deprel: 'xcomp', start: 18, end: 29 }),
      tok({ id: 6, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 29, end: 30 }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.predicateCores[0]!.complement).toBeNull()
    expect(coreSet.predicateCores[0]!.pattern).toBe('SV')
  })
})

describe('object boundary', () => {
  it('excludes a non-restrictive (comma-set-off) postmodifier from the object', () => {
    // "The team published results, confirmed by reviewers, immediately." -- comma-set-off acl
    // must not extend the object span.
    const text = 'The team published results, confirmed by reviewers, immediately.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'published', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 18 }),
      tok({ id: 4, text: 'results', upos: 'NOUN', head: 3, deprel: 'obj', start: 19, end: 26 }),
      tok({ id: 5, text: ',', upos: 'PUNCT', head: 6, deprel: 'punct', start: 26, end: 27 }),
      tok({ id: 6, text: 'confirmed', upos: 'VERB', head: 4, deprel: 'acl', start: 28, end: 37 }),
      tok({ id: 7, text: 'by', upos: 'ADP', head: 8, deprel: 'case', start: 38, end: 40 }),
      tok({ id: 8, text: 'reviewers', upos: 'NOUN', head: 6, deprel: 'obl', start: 41, end: 50 }),
      tok({ id: 9, text: ',', upos: 'PUNCT', head: 3, deprel: 'punct', start: 50, end: 51 }),
      tok({ id: 10, text: 'immediately', upos: 'ADV', head: 3, deprel: 'advmod', start: 52, end: 63 }),
      tok({ id: 11, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 63, end: 64 }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.predicateCores[0]!.object?.text).toBe('results')
  })
})

describe('balanced delimiters', () => {
  it('never truncates a closing bracket that belongs to retained content', () => {
    // "The score, given by [式 (2)], is high." -- comma-enclosed appos excluded (equation ref
    // dropped entirely with the subject here) but any span that DOES retain a "(" must keep
    // its matching ")".
    const text = 'The panel reviewed the result (see Table 2).'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'panel', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 9 }),
      tok({ id: 3, text: 'reviewed', upos: 'VERB', head: 0, deprel: 'root', start: 10, end: 18 }),
      tok({ id: 4, text: 'the', upos: 'DET', head: 5, deprel: 'det', start: 19, end: 22 }),
      tok({ id: 5, text: 'result', upos: 'NOUN', head: 3, deprel: 'obj', start: 23, end: 29 }),
      tok({ id: 6, text: '(', upos: 'PUNCT', head: 8, deprel: 'punct', start: 30, end: 31 }),
      tok({ id: 7, text: 'see', upos: 'VERB', head: 5, deprel: 'appos', start: 31, end: 34 }),
      tok({ id: 8, text: 'Table', upos: 'NOUN', head: 7, deprel: 'obj', start: 35, end: 40 }),
      tok({ id: 9, text: '2', upos: 'NUM', head: 8, deprel: 'nummod', start: 41, end: 42 }),
      tok({ id: 10, text: ')', upos: 'PUNCT', head: 7, deprel: 'punct', start: 42, end: 43 }),
      tok({ id: 11, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 43, end: 44 }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    // "see Table 2" is a bare appos (no `case` child) so is excluded; the important assertion
    // is that the object span never ends up with an unmatched "(" left dangling.
    const objectText = coreSet.predicateCores[0]!.object?.text ?? ''
    const opens = (objectText.match(/\(/g) ?? []).length
    const closes = (objectText.match(/\)/g) ?? []).length
    expect(opens).toBe(closes)
  })
})

describe('SentenceCoreSet compatibility projection', () => {
  it('projectPrimaryCore always exposes the first/main core, preserving secondary cores in the set', () => {
    const text = 'The system collects data and reports it.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'system', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: 'collects', upos: 'VERB', head: 0, deprel: 'root', start: 11, end: 19 }),
      tok({ id: 4, text: 'data', upos: 'NOUN', head: 3, deprel: 'obj', start: 20, end: 24 }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 6, deprel: 'cc', start: 25, end: 28 }),
      tok({ id: 6, text: 'reports', upos: 'VERB', head: 3, deprel: 'conj', start: 29, end: 36 }),
      tok({ id: 7, text: 'it', upos: 'PRON', head: 6, deprel: 'obj', start: 37, end: 39 }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    const primary = projectPrimaryCore(coreSet)
    expect(primary.verb?.text).toBe('collects')
    // multi-core preservation: the second predicate core must still be present in the set,
    // even though the legacy projection only ever exposes the first.
    expect(coreSet.predicateCores).toHaveLength(2)
    expect(coreSet.predicateCores[1]!.verb?.text).toBe('reports')
  })
})
