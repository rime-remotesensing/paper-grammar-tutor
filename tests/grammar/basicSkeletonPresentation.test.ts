import { describe, expect, it } from 'vitest'
import { getBasicSkeletonDisplayText } from '../../src/features/grammar/domain/basicSkeletonPresentation.ts'
import type { PredicateCore, SentenceCore, SentenceCoreSet, Span } from '../../src/features/grammar/schemas/grammarAnalysis.schema.ts'

/**
 * Prototype 2.6G2-F1 -- Basic Skeleton canonical presentation-text selection.
 *
 * `getBasicSkeletonDisplayText` is the isolated, Tree-free unit that decides what Basic
 * Skeleton displays for S/IO/O/C: the citation-free canonical presentation text produced by
 * the Stanza syntax authority's fine-grained citation pruning (2.6G2.5C4/C4.2) when one is
 * available, falling back to the constituent's own grounded `.text` otherwise. `??` (never
 * `||`) is the fallback operator throughout, so a genuinely empty string presentation
 * override is preserved rather than treated as "absent".
 */

function span(text: string, start = 0): Span {
  return { text, start, end: start + text.length }
}

function predicateCore(overrides: Partial<PredicateCore> = {}): PredicateCore {
  return {
    predicateCoreId: 'predicate-1',
    relation: 'main',
    connector: null,
    verb: span('collected'),
    indirectObject: null,
    object: null,
    complement: null,
    pattern: 'SV',
    ...overrides,
  }
}

function coreSet(overrides: Partial<SentenceCoreSet> = {}, predicateOverrides: Partial<PredicateCore> = {}): SentenceCoreSet {
  return {
    subject: span('Relevant data'),
    subjectHead: span('data'),
    predicateCores: [predicateCore(predicateOverrides)],
    ...overrides,
  }
}

function legacyCore(overrides: Partial<SentenceCore> = {}): SentenceCore {
  return {
    subject: span('Relevant data'),
    subjectHead: span('data'),
    verb: span('collected'),
    indirectObject: null,
    object: null,
    complement: null,
    pattern: 'SV',
    ...overrides,
  }
}

describe('Prototype 2.6G2-F1 -- getBasicSkeletonDisplayText', () => {
  it('(A) no presentation override -- renders grounded .text', () => {
    const result = getBasicSkeletonDisplayText(coreSet(), legacyCore())
    expect(result.subject).toBe('Relevant data')
  })

  it('(B) subjectPresentationText present -- renders presentation text', () => {
    const result = getBasicSkeletonDisplayText(
      coreSet({ subjectPresentationText: 'Relevant data (clean)' }),
      legacyCore(),
    )
    expect(result.subject).toBe('Relevant data (clean)')
  })

  it('(C) objectPresentationText present -- renders presentation text', () => {
    const result = getBasicSkeletonDisplayText(
      coreSet({}, { object: span('rainfall, soil type (Smith et al. 2020), and land cover'), objectPresentationText: 'rainfall, soil type, and land cover' }),
      legacyCore({ object: span('rainfall, soil type (Smith et al. 2020), and land cover') }),
    )
    expect(result.object).toBe('rainfall, soil type, and land cover')
  })

  it('(D) complementPresentationText present -- renders presentation text', () => {
    const result = getBasicSkeletonDisplayText(
      coreSet({}, { complement: span('accurate, reliable (Smith et al. 2020), and fast'), complementPresentationText: 'accurate, reliable, and fast' }),
      legacyCore({ complement: span('accurate, reliable (Smith et al. 2020), and fast') }),
    )
    expect(result.complement).toBe('accurate, reliable, and fast')
  })

  it('(E) indirectObjectPresentationText present -- renders presentation text', () => {
    const result = getBasicSkeletonDisplayText(
      coreSet({}, { indirectObject: span('the team (Smith et al. 2020)'), indirectObjectPresentationText: 'the team' }),
      legacyCore({ indirectObject: span('the team (Smith et al. 2020)') }),
    )
    expect(result.indirectObject).toBe('the team')
  })

  it('(F) missing effectiveCoreSet -- legacy fallback unchanged', () => {
    const result = getBasicSkeletonDisplayText(null, legacyCore({ object: span('legacy object text') }))
    expect(result.subject).toBe('Relevant data')
    expect(result.object).toBe('legacy object text')
  })

  it('(G) presentation field = null -- falls through to grounded .text', () => {
    const result = getBasicSkeletonDisplayText(
      coreSet({ subjectPresentationText: null }),
      legacyCore(),
    )
    expect(result.subject).toBe('Relevant data')
  })

  it('(H) presentation field = empty string -- preserved (?? not ||)', () => {
    const result = getBasicSkeletonDisplayText(
      coreSet({ subjectPresentationText: '' }),
      legacyCore(),
    )
    expect(result.subject).toBe('')
    expect(result.subject).not.toBe('Relevant data')
  })

  it('citation control: interior-citation object -- presentation citation-free, span text untouched', () => {
    const citationSpan = span('rainfall, soil type (Smith et al. 2020), and land cover')
    const result = getBasicSkeletonDisplayText(
      coreSet({}, { object: citationSpan, objectPresentationText: 'rainfall, soil type, and land cover' }),
      legacyCore({ object: citationSpan }),
    )
    // Basic Skeleton display is citation-free.
    expect(result.object).toBe('rainfall, soil type, and land cover')
    expect(result.object?.includes('Smith')).toBe(false)
    // The underlying span itself was never touched by this selection.
    expect(citationSpan.text).toBe('rainfall, soil type (Smith et al. 2020), and land cover')
  })

  it('citation control: paired citation-free version yields identical display content', () => {
    const withCitation = getBasicSkeletonDisplayText(
      coreSet({}, { object: span('rainfall, soil type (Smith et al. 2020), and land cover'), objectPresentationText: 'rainfall, soil type, and land cover' }),
      legacyCore({ object: span('rainfall, soil type (Smith et al. 2020), and land cover') }),
    )
    const withoutCitation = getBasicSkeletonDisplayText(
      coreSet({}, { object: span('rainfall, soil type, and land cover') }),
      legacyCore({ object: span('rainfall, soil type, and land cover') }),
    )
    expect(withCitation.object).toBe(withoutCitation.object)
  })

  it('C3 regression: nonrestrictive supplement subject has no presentation override either way', () => {
    const withCitation = getBasicSkeletonDisplayText(coreSet({ subject: span('Relevant data'), subjectPresentationText: null }), legacyCore())
    const withoutCitation = getBasicSkeletonDisplayText(coreSet({ subject: span('Relevant data'), subjectPresentationText: null }), legacyCore())
    expect(withCitation.subject).toBe('Relevant data')
    expect(withoutCitation.subject).toBe('Relevant data')
    expect(withCitation.subject).toBe(withoutCitation.subject)
  })
})
