import { describe, expect, it } from 'vitest'
import { buildSentenceCoreSetFromStanzaTokens, type StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'

/**
 * Prototype 2.6G2.5C -- Canonical Constituent Boundary Repair.
 *
 * Root cause (diagnosed against the live external control -- see the phase report, not
 * reproduced here as a literal committed test): a copular predicate's canonical complement is
 * grounded from the ROOT token itself (`groundConstituentSpan(frame.headToken, ...,
 * COPULAR_HEAD_STOP_DEPS)`), since the root token doubles as both the predicate's own identity
 * and the complement's grounding head in a copular sentence. A sentence-opening oblique
 * adjunct ("In this study") also attaches directly to that SAME root token (`obl`, not
 * excluded by `COPULAR_HEAD_STOP_DEPS`, which only stops `nsubj`/`csubj`/`cop`) -- so it enters
 * the SELECTED token set. `spanFromTokens` then grounds a single CONTIGUOUS min-to-max slice
 * of the source text over the selected tokens, silently reintroducing the (correctly excluded)
 * subject and copula sitting textually BETWEEN the opening adjunct and the lexical complement,
 * merely because they lie inside that broad range -- never because they were actually
 * selected. Confirmed via raw Stanza token trace (obl "study" -> root; nsubj "model" and cop
 * "is" both stopped out but textually between "study" and the lexical complement head).
 *
 * Fix: `contiguousIslandContaining` (stanzaSyntaxAuthority.ts) restricts `groundConstituentSpan`
 * to the maximal run of tokens, in source order, that are either part of the selected set or
 * punctuation, keeping only the run containing the constituent's own head -- a genuinely
 * excluded CONTENT token (opening modifier, subject, copula, sibling predicate material,
 * non-restrictive clause) breaks the run and is never bridged over. Source-grounded,
 * deterministic, no substring/dictionary/lexical-phrase heuristics. Scoped to
 * `groundConstituentSpan` only (complement/object/indirectObject/xcomp-complement grounding);
 * subject grounding and Tree presentation are untouched.
 *
 * Synthetic fixtures reproducing the same STRUCTURAL SHAPES as the live control, different
 * wording -- no literal live-PDF sentence is committed here.
 */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

describe('Prototype 2.6G2.5C -- copular complement boundary repair (controls A-I)', () => {
  it('(A) opening modifier + SVC nominal complement: the opener never enters C, S/V stay exact', () => {
    // "In this study, the model is a robust approach." -- obl "study" attaches to the root
    // ("approach"), the same token that grounds the copular complement.
    const real = 'In this study, the model is a robust approach.'
    const words = ['In', 'this', 'study', 'the', 'model', 'is', 'a', 'robust', 'approach']
    let cursor = 0
    const pos: Record<string, { start: number; end: number }> = {}
    for (const w of words) {
      const start = real.indexOf(w, cursor)
      pos[w] = { start, end: start + w.length }
      cursor = start + w.length
    }
    const fixed: StanzaToken[] = [
      tok({ id: 1, text: 'In', upos: 'ADP', head: 3, deprel: 'case', ...pos['In']! }),
      tok({ id: 2, text: 'this', upos: 'DET', head: 3, deprel: 'det', ...pos['this']! }),
      tok({ id: 3, text: 'study', upos: 'NOUN', head: 9, deprel: 'obl', ...pos['study']! }),
      tok({ id: 4, text: ',', upos: 'PUNCT', head: 3, deprel: 'punct', start: pos['study']!.end, end: pos['study']!.end + 1 }),
      tok({ id: 5, text: 'the', upos: 'DET', head: 6, deprel: 'det', ...pos['the']! }),
      tok({ id: 6, text: 'model', upos: 'NOUN', head: 9, deprel: 'nsubj', ...pos['model']! }),
      tok({ id: 7, text: 'is', upos: 'AUX', head: 9, deprel: 'cop', ...pos['is']! }),
      tok({ id: 8, text: 'a', upos: 'DET', head: 9, deprel: 'det', ...pos['a']! }),
      tok({ id: 9, text: 'approach', upos: 'NOUN', head: 0, deprel: 'root', ...pos['approach']! }),
      tok({ id: 10, text: 'robust', upos: 'ADJ', head: 9, deprel: 'amod', ...pos['robust']! }),
      tok({ id: 11, text: '.', upos: 'PUNCT', head: 9, deprel: 'punct', start: real.length - 1, end: real.length }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(real, fixed)
    expect(coreSet.subject?.text).toBe('the model')
    expect(coreSet.predicateCores[0]?.verb?.text).toBe('is')
    expect(coreSet.predicateCores[0]?.complement?.text).toBe('a robust approach')
    expect(coreSet.predicateCores[0]?.complement?.text).not.toContain('study')
    expect(coreSet.predicateCores[0]?.complement?.text).not.toContain('model')
    expect(coreSet.predicateCores[0]?.complement?.text).not.toContain('is')
    expect(coreSet.predicateCores[0]?.pattern).toBe('SVC')
  })

  it('(B) opening modifier + adjectival complement', () => {
    const text = 'In this study, the surface is stable.'
    const words = ['In', 'this', 'study', 'the', 'surface', 'is', 'stable']
    let cursor = 0
    const pos: Record<string, { start: number; end: number }> = {}
    for (const w of words) {
      const start = text.indexOf(w, cursor)
      pos[w] = { start, end: start + w.length }
      cursor = start + w.length
    }
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'In', upos: 'ADP', head: 3, deprel: 'case', ...pos['In']! }),
      tok({ id: 2, text: 'this', upos: 'DET', head: 3, deprel: 'det', ...pos['this']! }),
      tok({ id: 3, text: 'study', upos: 'NOUN', head: 8, deprel: 'obl', ...pos['study']! }),
      tok({ id: 4, text: ',', upos: 'PUNCT', head: 3, deprel: 'punct', start: pos['study']!.end, end: pos['study']!.end + 1 }),
      tok({ id: 5, text: 'the', upos: 'DET', head: 6, deprel: 'det', ...pos['the']! }),
      tok({ id: 6, text: 'surface', upos: 'NOUN', head: 8, deprel: 'nsubj', ...pos['surface']! }),
      tok({ id: 7, text: 'is', upos: 'AUX', head: 8, deprel: 'cop', ...pos['is']! }),
      tok({ id: 8, text: 'stable', upos: 'ADJ', head: 0, deprel: 'root', ...pos['stable']! }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 8, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('the surface')
    expect(coreSet.predicateCores[0]?.complement?.text).toBe('stable')
    expect(coreSet.predicateCores[0]?.pattern).toBe('SVC')
  })

  it('(C) nonrestrictive relative after nominal complement stays outside C', () => {
    // "The model is a robust approach, which works well." -- comma-gated acl:relcl on the
    // complement's own head must not be absorbed into C.
    const text = 'The model is a robust approach, which works well.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'model', upos: 'NOUN', head: 6, deprel: 'nsubj', start: 4, end: 9 }),
      tok({ id: 3, text: 'is', upos: 'AUX', head: 6, deprel: 'cop', start: 10, end: 12 }),
      tok({ id: 4, text: 'a', upos: 'DET', head: 6, deprel: 'det', start: 13, end: 14 }),
      tok({ id: 5, text: 'robust', upos: 'ADJ', head: 6, deprel: 'amod', start: 15, end: 21 }),
      tok({ id: 6, text: 'approach', upos: 'NOUN', head: 0, deprel: 'root', start: 22, end: 30 }),
      tok({ id: 7, text: ',', upos: 'PUNCT', head: 9, deprel: 'punct', start: 30, end: 31 }),
      tok({ id: 8, text: 'which', upos: 'PRON', head: 9, deprel: 'nsubj', start: 32, end: 37 }),
      tok({ id: 9, text: 'works', upos: 'VERB', head: 6, deprel: 'acl:relcl', start: 38, end: 43 }),
      tok({ id: 10, text: 'well', upos: 'ADV', head: 9, deprel: 'advmod', start: 44, end: 48 }),
      tok({ id: 11, text: '.', upos: 'PUNCT', head: 6, deprel: 'punct', start: 48, end: 49 }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.predicateCores[0]?.complement?.text).toBe('a robust approach')
    expect(coreSet.predicateCores[0]?.complement?.text).not.toContain('which')
  })

  it('(D) restrictive postmodifier (no comma) stays INSIDE C -- inclusion policy differs from (C)', () => {
    const text = 'The model is an approach that scales well.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'model', upos: 'NOUN', head: 5, deprel: 'nsubj', start: 4, end: 9 }),
      tok({ id: 3, text: 'is', upos: 'AUX', head: 5, deprel: 'cop', start: 10, end: 12 }),
      tok({ id: 4, text: 'an', upos: 'DET', head: 5, deprel: 'det', start: 13, end: 15 }),
      tok({ id: 5, text: 'approach', upos: 'NOUN', head: 0, deprel: 'root', start: 16, end: 24 }),
      tok({ id: 6, text: 'that', upos: 'PRON', head: 7, deprel: 'nsubj', start: 25, end: 29 }),
      tok({ id: 7, text: 'scales', upos: 'VERB', head: 5, deprel: 'acl:relcl', start: 30, end: 36 }),
      tok({ id: 8, text: 'well', upos: 'ADV', head: 7, deprel: 'advmod', start: 37, end: 41 }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 5, deprel: 'punct', start: 41, end: 42 }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.predicateCores[0]?.complement?.text).toBe('an approach that scales well')
  })

  it('(E) copular complement + trailing citation, WITH an opening modifier also present', () => {
    const text = 'In this study, the result is very complex Chen et al. 2015.'
    const words = ['In', 'this', 'study', 'the', 'result', 'is', 'very', 'complex', 'Chen', 'et', 'al.', '2015']
    let cursor = 0
    const pos: Record<string, { start: number; end: number }> = {}
    for (const w of words) {
      const start = text.indexOf(w, cursor)
      pos[w] = { start, end: start + w.length }
      cursor = start + w.length
    }
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'In', upos: 'ADP', head: 3, deprel: 'case', ...pos['In']! }),
      tok({ id: 2, text: 'this', upos: 'DET', head: 3, deprel: 'det', ...pos['this']! }),
      tok({ id: 3, text: 'study', upos: 'NOUN', head: 8, deprel: 'obl', ...pos['study']! }),
      tok({ id: 4, text: ',', upos: 'PUNCT', head: 3, deprel: 'punct', start: pos['study']!.end, end: pos['study']!.end + 1 }),
      tok({ id: 5, text: 'the', upos: 'DET', head: 6, deprel: 'det', ...pos['the']! }),
      tok({ id: 6, text: 'result', upos: 'NOUN', head: 8, deprel: 'nsubj', ...pos['result']! }),
      tok({ id: 7, text: 'is', upos: 'AUX', head: 8, deprel: 'cop', ...pos['is']! }),
      tok({ id: 8, text: 'complex', upos: 'ADJ', head: 0, deprel: 'root', ...pos['complex']! }),
      tok({ id: 9, text: 'very', upos: 'ADV', head: 8, deprel: 'advmod', ...pos['very']! }),
      tok({ id: 10, text: 'Chen', upos: 'PROPN', head: 8, deprel: 'dep', ...pos['Chen']! }),
      tok({ id: 11, text: 'et', upos: 'X', head: 12, deprel: 'cc', ...pos['et']! }),
      tok({ id: 12, text: 'al.', upos: 'X', head: 10, deprel: 'conj', ...pos['al.']! }),
      tok({ id: 13, text: '2015', upos: 'NUM', head: 10, deprel: 'nmod:unmarked', ...pos['2015']! }),
      tok({ id: 14, text: '.', upos: 'PUNCT', head: 8, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('the result')
    expect(coreSet.predicateCores[0]?.complement?.text).toBe('very complex')
    expect(coreSet.predicateCores[0]?.pattern).toBe('SVC')
  })

  it('(F) opening modifier + coordinated copular predicates: no complement bleed across the coordination boundary', () => {
    // Mirrors the live-diagnosed d15-class shape: the second complement must never absorb the
    // "and is" connector+copula sitting between it and the first complement.
    const text = 'In this study, the surface is stable and is durable.'
    const words = ['In', 'this', 'study', 'the', 'surface', 'is', 'stable', 'and', 'durable']
    let cursor = 0
    const pos: Record<string, { start: number; end: number }> = {}
    for (const w of words) {
      const start = text.indexOf(w, cursor)
      pos[w] = { start, end: start + w.length }
      cursor = start + w.length
    }
    const isPositions = [...text.matchAll(/\bis\b/g)].map((m) => ({ start: m.index!, end: m.index! + 2 }))
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'In', upos: 'ADP', head: 3, deprel: 'case', ...pos['In']! }),
      tok({ id: 2, text: 'this', upos: 'DET', head: 3, deprel: 'det', ...pos['this']! }),
      tok({ id: 3, text: 'study', upos: 'NOUN', head: 7, deprel: 'obl', ...pos['study']! }),
      tok({ id: 4, text: ',', upos: 'PUNCT', head: 3, deprel: 'punct', start: pos['study']!.end, end: pos['study']!.end + 1 }),
      tok({ id: 5, text: 'the', upos: 'DET', head: 6, deprel: 'det', ...pos['the']! }),
      tok({ id: 6, text: 'surface', upos: 'NOUN', head: 7, deprel: 'nsubj', ...pos['surface']! }),
      tok({ id: 7, text: 'stable', upos: 'ADJ', head: 0, deprel: 'root', ...pos['stable']! }),
      tok({ id: 8, text: 'is', upos: 'AUX', head: 7, deprel: 'cop', ...isPositions[0]! }),
      tok({ id: 9, text: 'and', upos: 'CCONJ', head: 11, deprel: 'cc', ...pos['and']! }),
      tok({ id: 10, text: 'is', upos: 'AUX', head: 11, deprel: 'cop', ...isPositions[1]! }),
      tok({ id: 11, text: 'durable', upos: 'ADJ', head: 7, deprel: 'conj', ...pos['durable']! }),
      tok({ id: 12, text: '.', upos: 'PUNCT', head: 7, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.predicateCores).toHaveLength(2)
    expect(coreSet.predicateCores[0]?.complement?.text).toBe('stable')
    expect(coreSet.predicateCores[1]?.complement?.text).toBe('durable')
    expect(coreSet.predicateCores[1]?.complement?.text).not.toContain('and')
    expect(coreSet.predicateCores[1]?.complement?.text).not.toContain('is')
  })

  it('(G) ordinary SVC without any opener -- sanity baseline, unaffected', () => {
    const text = 'The surface is stable.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'surface', upos: 'NOUN', head: 4, deprel: 'nsubj', start: 4, end: 11 }),
      tok({ id: 3, text: 'is', upos: 'AUX', head: 4, deprel: 'cop', start: 12, end: 14 }),
      tok({ id: 4, text: 'stable', upos: 'ADJ', head: 0, deprel: 'root', start: 15, end: 21 }),
      tok({ id: 5, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', start: 21, end: 22 }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The surface')
    expect(coreSet.predicateCores[0]?.complement?.text).toBe('stable')
    expect(coreSet.predicateCores[0]?.pattern).toBe('SVC')
  })

  it('(H) long noun complement with an internal PP stays whole -- no truncation from the island split', () => {
    const text = 'In this study, the model is a scalable approach for large datasets.'
    const words = ['In', 'this', 'study', 'the', 'model', 'is', 'a', 'scalable', 'approach', 'for', 'large', 'datasets']
    let cursor = 0
    const pos: Record<string, { start: number; end: number }> = {}
    for (const w of words) {
      const start = text.indexOf(w, cursor)
      pos[w] = { start, end: start + w.length }
      cursor = start + w.length
    }
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'In', upos: 'ADP', head: 3, deprel: 'case', ...pos['In']! }),
      tok({ id: 2, text: 'this', upos: 'DET', head: 3, deprel: 'det', ...pos['this']! }),
      tok({ id: 3, text: 'study', upos: 'NOUN', head: 9, deprel: 'obl', ...pos['study']! }),
      tok({ id: 4, text: ',', upos: 'PUNCT', head: 3, deprel: 'punct', start: pos['study']!.end, end: pos['study']!.end + 1 }),
      tok({ id: 5, text: 'the', upos: 'DET', head: 6, deprel: 'det', ...pos['the']! }),
      tok({ id: 6, text: 'model', upos: 'NOUN', head: 9, deprel: 'nsubj', ...pos['model']! }),
      tok({ id: 7, text: 'is', upos: 'AUX', head: 9, deprel: 'cop', ...pos['is']! }),
      tok({ id: 8, text: 'a', upos: 'DET', head: 9, deprel: 'det', ...pos['a']! }),
      tok({ id: 9, text: 'approach', upos: 'NOUN', head: 0, deprel: 'root', ...pos['approach']! }),
      tok({ id: 10, text: 'scalable', upos: 'ADJ', head: 9, deprel: 'amod', ...pos['scalable']! }),
      tok({ id: 11, text: 'for', upos: 'ADP', head: 13, deprel: 'case', ...pos['for']! }),
      tok({ id: 12, text: 'large', upos: 'ADJ', head: 13, deprel: 'amod', ...pos['large']! }),
      tok({ id: 13, text: 'datasets', upos: 'NOUN', head: 9, deprel: 'nmod', ...pos['datasets']! }),
      tok({ id: 14, text: '.', upos: 'PUNCT', head: 9, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.predicateCores[0]?.complement?.text).toBe('a scalable approach for large datasets')
  })

  it('(I) an excluded token strictly between two selected constituent tokens must not cause leftward OR rightward span reinsertion', () => {
    // Mirrors control (A)'s exact mechanism but asserts both boundaries explicitly: the
    // leftward opening modifier is excluded, and nothing beyond the complement's own last
    // token ("approach") leaks rightward either (the sentence ends right there).
    const text = 'In this study, the model is a robust approach.'
    const words = ['In', 'this', 'study', 'the', 'model', 'is', 'a', 'robust', 'approach']
    let cursor = 0
    const pos: Record<string, { start: number; end: number }> = {}
    for (const w of words) {
      const start = text.indexOf(w, cursor)
      pos[w] = { start, end: start + w.length }
      cursor = start + w.length
    }
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'In', upos: 'ADP', head: 3, deprel: 'case', ...pos['In']! }),
      tok({ id: 2, text: 'this', upos: 'DET', head: 3, deprel: 'det', ...pos['this']! }),
      tok({ id: 3, text: 'study', upos: 'NOUN', head: 9, deprel: 'obl', ...pos['study']! }),
      tok({ id: 4, text: ',', upos: 'PUNCT', head: 3, deprel: 'punct', start: pos['study']!.end, end: pos['study']!.end + 1 }),
      tok({ id: 5, text: 'the', upos: 'DET', head: 6, deprel: 'det', ...pos['the']! }),
      tok({ id: 6, text: 'model', upos: 'NOUN', head: 9, deprel: 'nsubj', ...pos['model']! }),
      tok({ id: 7, text: 'is', upos: 'AUX', head: 9, deprel: 'cop', ...pos['is']! }),
      tok({ id: 8, text: 'a', upos: 'DET', head: 9, deprel: 'det', ...pos['a']! }),
      tok({ id: 9, text: 'approach', upos: 'NOUN', head: 0, deprel: 'root', ...pos['approach']! }),
      tok({ id: 10, text: 'robust', upos: 'ADJ', head: 9, deprel: 'amod', ...pos['robust']! }),
      tok({ id: 11, text: '.', upos: 'PUNCT', head: 9, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    const complement = coreSet.predicateCores[0]?.complement
    expect(complement?.text).toBe('a robust approach')
    // Leftward: the excluded subject+copula (and the opening modifier beyond them) never
    // reappear to the LEFT of the complement's own first selected token.
    expect(complement?.start).toBe(pos['a']!.start)
    // Rightward: nothing beyond the complement's own last selected token ("approach",
    // excluding the final period) leaks in either.
    expect(complement?.end).toBe(pos['approach']!.end)
  })
})
