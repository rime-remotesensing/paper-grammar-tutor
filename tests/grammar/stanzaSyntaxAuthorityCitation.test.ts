import { describe, expect, it } from 'vitest'
import { buildSentenceCoreSetFromStanzaTokens, type StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'

/**
 * Prototype 2.6G2.2 item 1 -- citation-safe canonical complement/object extraction.
 *
 * The live "very complex (Chen et al. 2015)" control proved that the pre-existing whole-span
 * `isCitationLike` check nulled an ENTIRE O/C constituent the moment any citation-like text
 * appeared anywhere inside it, losing genuine grammatical content along with the citation.
 * These are synthetic, general fixtures reproducing the same STRUCTURAL SHAPE (a citation
 * attached via a generic dependency edge to the constituent's own head, or nested inside an
 * NP), not the real sentence's wording.
 */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

describe('Prototype 2.6G2.2 -- citation-safe complement/object extraction', () => {
  it('copular complement survives a trailing citation attached to the predicative head', () => {
    // "The result is very complex Chen et al. 2015." -- citation attaches via a generic
    // `dep` edge directly to the copular head, mirroring the real live-control shape.
    const text = 'The result is very complex Chen et al. 2015.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'result', upos: 'NOUN', head: 5, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: 'is', upos: 'AUX', head: 5, deprel: 'cop', start: 11, end: 13 }),
      tok({ id: 4, text: 'very', upos: 'ADV', head: 5, deprel: 'advmod', start: 14, end: 18 }),
      tok({ id: 5, text: 'complex', upos: 'ADJ', head: 0, deprel: 'root', start: 19, end: 26 }),
      tok({ id: 6, text: 'Chen', upos: 'PROPN', head: 5, deprel: 'dep', start: 27, end: 31 }),
      tok({ id: 7, text: 'et', upos: 'X', head: 8, deprel: 'cc', start: 32, end: 34 }),
      tok({ id: 8, text: 'al.', upos: 'X', head: 6, deprel: 'conj', start: 35, end: 38 }),
      tok({ id: 9, text: '2015', upos: 'NUM', head: 6, deprel: 'nmod:unmarked', start: 39, end: 43 }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 5, deprel: 'punct', start: 43, end: 44 }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.predicateCores[0]?.complement?.text).toBe('very complex')
    expect(coreSet.predicateCores[0]?.pattern).toBe('SVC')
  })

  it('object survives a trailing citation attached to the object head', () => {
    const text = 'The team reported significant findings Chen et al. 2015.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'reported', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 17 }),
      tok({ id: 4, text: 'significant', upos: 'ADJ', head: 5, deprel: 'amod', start: 18, end: 29 }),
      tok({ id: 5, text: 'findings', upos: 'NOUN', head: 3, deprel: 'obj', start: 30, end: 38 }),
      tok({ id: 6, text: 'Chen', upos: 'PROPN', head: 5, deprel: 'dep', start: 39, end: 43 }),
      tok({ id: 7, text: 'et', upos: 'X', head: 8, deprel: 'cc', start: 44, end: 46 }),
      tok({ id: 8, text: 'al.', upos: 'X', head: 6, deprel: 'conj', start: 47, end: 50 }),
      tok({ id: 9, text: '2015', upos: 'NUM', head: 6, deprel: 'nmod:unmarked', start: 51, end: 55 }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 55, end: 56 }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.predicateCores[0]?.object?.text).toBe('significant findings')
    expect(coreSet.predicateCores[0]?.object?.text.includes('Chen')).toBe(false)
  })

  it('a citation-only candidate (nothing else to strip) is still correctly rejected', () => {
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

  it('a non-citation parenthetical/aside is never blindly deleted', () => {
    // "within expected ranges" resembles the citation's attachment SHAPE (a `dep`-attached
    // aside off the object head) but contains no citation-like text -- must survive intact.
    const text = 'The team reported strong results within expected ranges.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'reported', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 17 }),
      tok({ id: 4, text: 'strong', upos: 'ADJ', head: 5, deprel: 'amod', start: 18, end: 24 }),
      tok({ id: 5, text: 'results', upos: 'NOUN', head: 3, deprel: 'obj', start: 25, end: 32 }),
      tok({ id: 6, text: 'within', upos: 'ADP', head: 8, deprel: 'case', start: 33, end: 39 }),
      tok({ id: 7, text: 'expected', upos: 'ADJ', head: 8, deprel: 'amod', start: 40, end: 48 }),
      tok({ id: 8, text: 'ranges', upos: 'NOUN', head: 5, deprel: 'dep', start: 49, end: 55 }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 55, end: 56 }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.predicateCores[0]?.object?.text).toBe('strong results within expected ranges')
  })
})
