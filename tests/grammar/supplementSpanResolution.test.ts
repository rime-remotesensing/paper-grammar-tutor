import { describe, expect, it } from 'vitest'
import { isSuspiciousCommaIngPredicate, resolveSupplementSpan } from '../../src/features/grammar/domain/supplementSpanResolution'
import type { ComplementVerification } from '../../src/features/grammar/domain/analyzeSentenceWithComplementVerification'
import type { HybridDependent, HybridMergedStructure, HybridPredicate } from '../../src/features/grammar/domain/hybridPredicateMerger'
import type { SentenceCore, SentencePattern, Span } from '../../src/features/grammar/schemas/grammarAnalysis.schema'

// Prototype 2.3O items 30-34 — the raw-SVO supplement-authority fix. 2.3N's re-diagnosis of
// 2.3M's live "not_applicable 2/8" confirmed those are genuinely raw GrammarAnalysis
// producing SVO/C=null from the start (not a Focused Complement Verifier accuracy issue) --
// this file proves the presentation-only fallback that recovers "emphasizing" as a
// supplement in exactly that shape, without any new LLM call.

function span(text: string, start: number): Span {
  return { text, start, end: start + text.length }
}

function core(pattern: SentencePattern, overrides: Partial<SentenceCore> = {}): SentenceCore {
  return {
    subject: span('we', 0),
    subjectHead: span('we', 0),
    verb: span('describe', 3),
    indirectObject: null,
    object: span('the Collection 6 algorithm', 12),
    complement: null,
    pattern,
    ...overrides,
  }
}

function predicate(text: string, start: number, relation: 'main' | 'coordinated' = 'coordinated', dependents: HybridDependent[] = []): HybridPredicate {
  return { text, start, end: start + text.length, relation, dependents, isCoreAnchor: relation === 'main' }
}

function hybrid(overrides: Partial<HybridMergedStructure> = {}): HybridMergedStructure {
  return {
    subject: null,
    subjectModifiers: [],
    predicates: [],
    sentenceModifiers: [],
    dropped: [],
    suppressedCoreDependents: [],
    anchorInjected: false,
    ...overrides,
  }
}

const NOT_APPLICABLE: ComplementVerification = { status: 'not_applicable', classification: null, reasonCode: null }
const CONFIRMED: ComplementVerification = { status: 'confirmed_supplementary_ing', classification: 'SUPPLEMENTARY_ING', reasonCode: 'COMMA_SUPPLEMENT' }

const TARGET_TEXT = 'we describe the Collection 6 algorithm, emphasizing those aspects that have changed since Collection 5.'

describe('isSuspiciousCommaIngPredicate', () => {
  it('matches a comma+-ing predicate immediately after the object when core.complement is null', () => {
    const c = core('SVO')
    const p = predicate('emphasizing', 40, 'coordinated')
    expect(isSuspiciousCommaIngPredicate(TARGET_TEXT, c, p)).toBe(true)
  })

  it('does not match when core.complement is already set (a real SVOC candidate exists -- not this fallback\'s job)', () => {
    const c = core('SVOC', { complement: span('emphasizing those aspects...', 40) })
    const p = predicate('emphasizing', 40, 'coordinated')
    expect(isSuspiciousCommaIngPredicate(TARGET_TEXT, c, p)).toBe(false)
  })

  it('does not match without a comma between object and the predicate', () => {
    const text = 'we describe the Collection 6 algorithm emphasizing those aspects.'
    const c = core('SVO')
    const p = predicate('emphasizing', 39, 'coordinated')
    expect(isSuspiciousCommaIngPredicate(text, c, p)).toBe(false)
  })

  it('does not match a predicate whose own text does not start with an -ing word', () => {
    const text = 'we describe the Collection 6 algorithm, and analyze the results.'
    const c = core('SVO')
    const p = predicate('analyze', 44, 'coordinated')
    expect(isSuspiciousCommaIngPredicate(text, c, p)).toBe(false)
  })

  it('does not match when core.object is null', () => {
    const c = core('SV', { object: null })
    const p = predicate('emphasizing', 40, 'coordinated')
    expect(isSuspiciousCommaIngPredicate(TARGET_TEXT, c, p)).toBe(false)
  })
})

describe('resolveSupplementSpan', () => {
  it('uses the existing confirmed_supplementary_ing authority when present (2.3M behavior unchanged)', () => {
    const rawCore = core('SVOC', { complement: span('emphasizing those aspects...', 40) })
    const effectiveCore = core('SVO')
    const h = hybrid({ predicates: [predicate('emphasizing', 40, 'coordinated')] })
    const result = resolveSupplementSpan(TARGET_TEXT, effectiveCore, rawCore, CONFIRMED, h)
    expect(result).toEqual(rawCore.complement)
  })

  it('falls back to the raw-SVO comma+-ing predicate when verification never fired (item 30-34 fix)', () => {
    const c = core('SVO') // rawCore === effectiveCore here; complement was null from the start
    const h = hybrid({ predicates: [predicate('emphasizing', 40, 'coordinated')] })
    const result = resolveSupplementSpan(TARGET_TEXT, c, c, NOT_APPLICABLE, h)
    expect(result).toEqual({ text: 'emphasizing', start: 40, end: 51 })
  })

  it('returns null when nothing matches (ordinary SVO, no comma+-ing predicate at all)', () => {
    const c = core('SVO')
    const h = hybrid({ predicates: [] })
    const result = resolveSupplementSpan('we describe the Collection 6 algorithm.', c, c, NOT_APPLICABLE, h)
    expect(result).toBeNull()
  })

  it('returns null for a genuine coordinated predicate with "and" (must not be mistaken for a supplement)', () => {
    const text = 'we describe the Collection 6 algorithm, and analyze the results.'
    const c = core('SVO')
    const h = hybrid({ predicates: [predicate('analyze', 44, 'coordinated')] })
    const result = resolveSupplementSpan(text, c, c, NOT_APPLICABLE, h)
    expect(result).toBeNull()
  })
})
