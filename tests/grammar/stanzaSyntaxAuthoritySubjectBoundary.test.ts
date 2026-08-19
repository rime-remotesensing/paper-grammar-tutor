import { describe, expect, it } from 'vitest'
import { buildSentenceCoreSetFromStanzaTokens, type StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'

/**
 * Prototype 2.6G2.5C2 -- Canonical Subject Boundary Repair.
 *
 * Root cause (diagnosed against `d34-long-80` in the frozen/generalization dataset -- see the
 * phase report, not reproduced here as a literal committed test): canonical subject grounding
 * used to be a bare `spanFromTokens(text, collectConstituentTokens(mainSubjToken, ...))` call,
 * never routed through `groundConstituentSpan` the way O/C/IO grounding already was (fixed in
 * 2.6G2.5C). `collectConstituentTokens` itself correctly EXCLUDES the subject's own
 * comma-gated non-restrictive relative clause -- but a Stanza UD coordination-attachment-
 * drift artifact (an enumeration item belonging to the excluded relative clause's own object
 * spuriously attaches its `conj` chain directly to the SUBJECT head instead) is a genuinely
 * SELECTED token, textually stranded far past the excluded relative clause. The old bare
 * `spanFromTokens` call ground a single contiguous min-to-max slice across the whole
 * selected+excluded range, silently reintroducing the entire relative clause sitting in the
 * gap. Routing subject through `groundConstituentSpan` (citation-safe + contiguous-island-
 * restricted, same mechanism 2.6G2.5C already built for O/C/IO) fixes this generally.
 *
 * Synthetic fixtures reproducing the same STRUCTURAL SHAPES, different wording -- no literal
 * live-PDF/dataset sentence is committed here.
 */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

function offsets(text: string, words: string[]): Record<string, { start: number; end: number }> {
  let cursor = 0
  const pos: Record<string, { start: number; end: number }> = {}
  for (const w of words) {
    const start = text.indexOf(w, cursor)
    if (start === -1) throw new Error(`word "${w}" not found starting at ${cursor}`)
    pos[w] = { start, end: start + w.length }
    cursor = start + w.length
  }
  return pos
}

describe('Prototype 2.6G2.5C2 -- canonical subject boundary repair (controls A-J)', () => {
  it('(A) simple subject', () => {
    const text = 'The team reported results.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'reported', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 17 }),
      tok({ id: 4, text: 'results', upos: 'NOUN', head: 3, deprel: 'obj', start: 18, end: 25 }),
      tok({ id: 5, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 25, end: 26 }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The team')
  })

  it('(B) long NP subject with compound/adjectival chain', () => {
    const text = 'The proposed graph-based deep learning approach performs well.'
    const words = ['The', 'proposed', 'graph', 'based', 'deep', 'learning', 'approach', 'performs', 'well']
    const pos = offsets(text, words)
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 7, deprel: 'det', ...pos['The']! }),
      tok({ id: 2, text: 'proposed', upos: 'VERB', head: 7, deprel: 'amod', ...pos['proposed']! }),
      tok({ id: 3, text: 'graph', upos: 'NOUN', head: 5, deprel: 'compound', ...pos['graph']! }),
      tok({ id: 4, text: '-', upos: 'PUNCT', head: 3, deprel: 'punct', start: pos['graph']!.end, end: pos['graph']!.end + 1 }),
      tok({ id: 5, text: 'based', upos: 'ADJ', head: 7, deprel: 'amod', ...pos['based']! }),
      tok({ id: 6, text: 'deep', upos: 'ADJ', head: 7, deprel: 'amod', ...pos['deep']! }),
      tok({ id: 7, text: 'approach', upos: 'NOUN', head: 9, deprel: 'nsubj', ...pos['approach']! }),
      tok({ id: 8, text: 'learning', upos: 'NOUN', head: 7, deprel: 'compound', ...pos['learning']! }),
      tok({ id: 9, text: 'performs', upos: 'VERB', head: 0, deprel: 'root', ...pos['performs']! }),
      tok({ id: 10, text: 'well', upos: 'ADV', head: 9, deprel: 'advmod', ...pos['well']! }),
      tok({ id: 11, text: '.', upos: 'PUNCT', head: 9, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The proposed graph-based deep learning approach')
  })

  it('(C) restrictive relative clause stays INSIDE the subject', () => {
    const text = 'The model that uses radar data performs well.'
    const words = ['The', 'model', 'that', 'uses', 'radar', 'data', 'performs', 'well']
    const pos = offsets(text, words)
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pos['The']! }),
      tok({ id: 2, text: 'model', upos: 'NOUN', head: 7, deprel: 'nsubj', ...pos['model']! }),
      tok({ id: 3, text: 'that', upos: 'PRON', head: 4, deprel: 'nsubj', ...pos['that']! }),
      tok({ id: 4, text: 'uses', upos: 'VERB', head: 2, deprel: 'acl:relcl', ...pos['uses']! }),
      tok({ id: 5, text: 'radar', upos: 'NOUN', head: 6, deprel: 'compound', ...pos['radar']! }),
      tok({ id: 6, text: 'data', upos: 'NOUN', head: 4, deprel: 'obj', ...pos['data']! }),
      tok({ id: 7, text: 'performs', upos: 'VERB', head: 0, deprel: 'root', ...pos['performs']! }),
      tok({ id: 8, text: 'well', upos: 'ADV', head: 7, deprel: 'advmod', ...pos['well']! }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 7, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The model that uses radar data')
  })

  it('(D) non-restrictive relative clause stays OUTSIDE the subject (the d34 shape)', () => {
    const text = 'The framework, which integrates data, performs well.'
    const words = ['The', 'framework', 'which', 'integrates', 'data', 'performs', 'well']
    const pos = offsets(text, words)
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pos['The']! }),
      tok({ id: 2, text: 'framework', upos: 'NOUN', head: 8, deprel: 'nsubj', ...pos['framework']! }),
      tok({ id: 3, text: ',', upos: 'PUNCT', head: 4, deprel: 'punct', start: pos['framework']!.end, end: pos['framework']!.end + 1 }),
      tok({ id: 4, text: 'which', upos: 'PRON', head: 5, deprel: 'nsubj', ...pos['which']! }),
      tok({ id: 5, text: 'integrates', upos: 'VERB', head: 2, deprel: 'acl:relcl', ...pos['integrates']! }),
      tok({ id: 6, text: 'data', upos: 'NOUN', head: 5, deprel: 'obj', ...pos['data']! }),
      tok({ id: 7, text: ',', upos: 'PUNCT', head: 2, deprel: 'punct', start: pos['data']!.end, end: pos['data']!.end + 1 }),
      tok({ id: 8, text: 'performs', upos: 'VERB', head: 0, deprel: 'root', ...pos['performs']! }),
      tok({ id: 9, text: 'well', upos: 'ADV', head: 8, deprel: 'advmod', ...pos['well']! }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 8, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The framework')
    expect(coreSet.subject?.text).not.toContain('which')
  })

  it('(E) coordinated subject stays the full canonical span (no Tree-level decomposition in this phase)', () => {
    const text = 'The sensor and the monitor recorded data.'
    const words = ['The', 'sensor', 'and', 'the', 'monitor', 'recorded', 'data']
    const pos = offsets(text, words)
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pos['The']! }),
      tok({ id: 2, text: 'sensor', upos: 'NOUN', head: 6, deprel: 'nsubj', ...pos['sensor']! }),
      tok({ id: 3, text: 'and', upos: 'CCONJ', head: 5, deprel: 'cc', ...pos['and']! }),
      tok({ id: 4, text: 'the', upos: 'DET', head: 5, deprel: 'det', ...pos['the']! }),
      tok({ id: 5, text: 'monitor', upos: 'NOUN', head: 2, deprel: 'conj', ...pos['monitor']! }),
      tok({ id: 6, text: 'recorded', upos: 'VERB', head: 0, deprel: 'root', ...pos['recorded']! }),
      tok({ id: 7, text: 'data', upos: 'NOUN', head: 6, deprel: 'obj', ...pos['data']! }),
      tok({ id: 8, text: '.', upos: 'PUNCT', head: 6, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The sensor and the monitor')
  })

  it('(F) subject with a parenthetical abbreviation is never lost', () => {
    const text = 'The variance inflation factor (VIF) indicates collinearity.'
    const words = ['The', 'variance', 'inflation', 'factor', 'VIF', 'indicates', 'collinearity']
    const pos = offsets(text, words)
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 4, deprel: 'det', ...pos['The']! }),
      tok({ id: 2, text: 'variance', upos: 'NOUN', head: 4, deprel: 'compound', ...pos['variance']! }),
      tok({ id: 3, text: 'inflation', upos: 'NOUN', head: 4, deprel: 'compound', ...pos['inflation']! }),
      tok({ id: 4, text: 'factor', upos: 'NOUN', head: 8, deprel: 'nsubj', ...pos['factor']! }),
      tok({ id: 5, text: '(', upos: 'PUNCT', head: 6, deprel: 'punct', start: pos['VIF']!.start - 1, end: pos['VIF']!.start }),
      tok({ id: 6, text: 'VIF', upos: 'PROPN', head: 4, deprel: 'appos', ...pos['VIF']! }),
      tok({ id: 7, text: ')', upos: 'PUNCT', head: 6, deprel: 'punct', start: pos['VIF']!.end, end: pos['VIF']!.end + 1 }),
      tok({ id: 8, text: 'indicates', upos: 'VERB', head: 0, deprel: 'root', ...pos['indicates']! }),
      tok({ id: 9, text: 'collinearity', upos: 'NOUN', head: 8, deprel: 'obj', ...pos['collinearity']! }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 8, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The variance inflation factor (VIF)')
  })

  it('(G) subject with a citation-like parenthetical excludes only the citation', () => {
    const text = 'The model Smith et al. 2020 failed.'
    const words = ['The', 'model', 'Smith', 'et', 'al.', '2020', 'failed']
    const pos = offsets(text, words)
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pos['The']! }),
      tok({ id: 2, text: 'model', upos: 'NOUN', head: 7, deprel: 'nsubj', ...pos['model']! }),
      tok({ id: 3, text: 'Smith', upos: 'PROPN', head: 2, deprel: 'dep', ...pos['Smith']! }),
      tok({ id: 4, text: 'et', upos: 'X', head: 5, deprel: 'cc', ...pos['et']! }),
      tok({ id: 5, text: 'al.', upos: 'X', head: 3, deprel: 'conj', ...pos['al.']! }),
      tok({ id: 6, text: '2020', upos: 'NUM', head: 3, deprel: 'nmod:unmarked', ...pos['2020']! }),
      tok({ id: 7, text: 'failed', upos: 'VERB', head: 0, deprel: 'root', ...pos['failed']! }),
      tok({ id: 8, text: '.', upos: 'PUNCT', head: 7, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The model')
    expect(coreSet.subject?.text).not.toContain('Smith')
  })

  it('(H) subject with an equation-placeholder-style bracketed PP is kept (structural PP, not a bare appositive)', () => {
    const text = 'The parameter in [7] determines accuracy.'
    const words = ['The', 'parameter', 'in', '7', 'determines', 'accuracy']
    const pos = offsets(text, words)
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pos['The']! }),
      tok({ id: 2, text: 'parameter', upos: 'NOUN', head: 7, deprel: 'nsubj', ...pos['parameter']! }),
      tok({ id: 3, text: 'in', upos: 'ADP', head: 5, deprel: 'case', ...pos['in']! }),
      tok({ id: 4, text: '[', upos: 'PUNCT', head: 5, deprel: 'punct', start: pos['7']!.start - 1, end: pos['7']!.start }),
      tok({ id: 5, text: '7', upos: 'NUM', head: 2, deprel: 'nmod', ...pos['7']! }),
      tok({ id: 6, text: ']', upos: 'PUNCT', head: 5, deprel: 'punct', start: pos['7']!.end, end: pos['7']!.end + 1 }),
      tok({ id: 7, text: 'determines', upos: 'VERB', head: 0, deprel: 'root', ...pos['determines']! }),
      tok({ id: 8, text: 'accuracy', upos: 'NOUN', head: 7, deprel: 'obj', ...pos['accuracy']! }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 7, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The parameter in [7]')
  })

  it('(I) subject with an internal PP/nmod stays whole', () => {
    const text = 'The team of researchers reported results.'
    const words = ['The', 'team', 'of', 'researchers', 'reported', 'results']
    const pos = offsets(text, words)
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pos['The']! }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 5, deprel: 'nsubj', ...pos['team']! }),
      tok({ id: 3, text: 'of', upos: 'ADP', head: 4, deprel: 'case', ...pos['of']! }),
      tok({ id: 4, text: 'researchers', upos: 'NOUN', head: 2, deprel: 'nmod', ...pos['researchers']! }),
      tok({ id: 5, text: 'reported', upos: 'VERB', head: 0, deprel: 'root', ...pos['reported']! }),
      tok({ id: 6, text: 'results', upos: 'NOUN', head: 5, deprel: 'obj', ...pos['results']! }),
      tok({ id: 7, text: '.', upos: 'PUNCT', head: 5, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The team of researchers')
  })

  it('(J) a token spuriously attached beyond an excluded non-restrictive relative clause is never reinserted (the exact d34 mechanism)', () => {
    // "The framework, which integrates estimates, morphology, performs well." -- "morphology"
    // is deliberately attached via `conj` DIRECTLY to the subject head ("framework"), the
    // same UD coordination-attachment-drift shape diagnosed live in d34-long-80 (an
    // enumeration item belonging to the excluded relative clause's own object spuriously
    // attaches to the subject instead). It must not resurface in the subject's own span.
    const text = 'The framework, which integrates estimates, morphology, performs well.'
    const words = ['The', 'framework', 'which', 'integrates', 'estimates', 'morphology', 'performs', 'well']
    const pos = offsets(text, words)
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pos['The']! }),
      tok({ id: 2, text: 'framework', upos: 'NOUN', head: 10, deprel: 'nsubj', ...pos['framework']! }),
      tok({ id: 3, text: ',', upos: 'PUNCT', head: 4, deprel: 'punct', start: pos['framework']!.end, end: pos['framework']!.end + 1 }),
      tok({ id: 4, text: 'which', upos: 'PRON', head: 5, deprel: 'nsubj', ...pos['which']! }),
      tok({ id: 5, text: 'integrates', upos: 'VERB', head: 2, deprel: 'acl:relcl', ...pos['integrates']! }),
      tok({ id: 6, text: 'estimates', upos: 'NOUN', head: 5, deprel: 'obj', ...pos['estimates']! }),
      tok({ id: 7, text: ',', upos: 'PUNCT', head: 8, deprel: 'punct', start: pos['estimates']!.end, end: pos['estimates']!.end + 1 }),
      // Spurious drift: "morphology" attaches to the SUBJECT head (2), not to "estimates" (6).
      tok({ id: 8, text: 'morphology', upos: 'NOUN', head: 2, deprel: 'conj', ...pos['morphology']! }),
      tok({ id: 9, text: ',', upos: 'PUNCT', head: 2, deprel: 'punct', start: pos['morphology']!.end, end: pos['morphology']!.end + 1 }),
      tok({ id: 10, text: 'performs', upos: 'VERB', head: 0, deprel: 'root', ...pos['performs']! }),
      tok({ id: 11, text: 'well', upos: 'ADV', head: 10, deprel: 'advmod', ...pos['well']! }),
      tok({ id: 12, text: '.', upos: 'PUNCT', head: 10, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The framework')
    expect(coreSet.subject?.text).not.toContain('morphology')
    expect(coreSet.subject?.text).not.toContain('which')
  })
})
