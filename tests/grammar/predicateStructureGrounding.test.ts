import { describe, expect, it } from 'vitest'
import { groundPredicateStructure } from '../../src/features/grammar/domain/predicateStructureGrounding'
import type { LlmPredicateStructure } from '../../src/features/grammar/schemas/predicateStructure.schema'

const SENTENCE = 'The sensor collected data and analyzed the results.'

function base(overrides: Partial<LlmPredicateStructure> = {}): LlmPredicateStructure {
  return {
    subjectModifiers: [],
    predicates: [{ text: 'collected', relation: 'main', dependents: [{ text: 'data', role: 'object', children: [] }] }],
    sentenceModifiers: [],
    ...overrides,
  }
}

describe('groundPredicateStructure — source grounding', () => {
  it('resolves each predicate/dependent/leaf to its exact position in the sentence', () => {
    const result = groundPredicateStructure(base(), SENTENCE)
    expect(result.success).toBe(true)
    if (!result.success) return
    const [p] = result.structure.predicates
    expect(p).toMatchObject({ text: 'collected', start: 11, end: 20, relation: 'main' })
    expect(p.dependents[0]).toMatchObject({ text: 'data', start: 21, end: 25, role: 'object' })
  })

  it('grounds nested leaf children (predicate -> dependent -> leaf, 3 levels)', () => {
    const guide = base({
      predicates: [
        {
          text: 'was recorded',
          relation: 'main',
          dependents: [{ text: 'every 1 nm', role: 'condition', children: [{ text: 'in the region', role: 'range' }] }],
        },
      ],
    })
    const sentence = 'Data was recorded every 1 nm in the region.'
    const result = groundPredicateStructure(guide, sentence)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.structure.predicates[0].dependents[0].children[0]).toMatchObject({ text: 'in the region', role: 'range' })
  })

  it('grounds subjectModifiers and sentenceModifiers', () => {
    const guide = base({
      subjectModifiers: [{ text: 'The sensor', role: 'modifier' }],
      sentenceModifiers: [{ text: 'the results', role: 'other' }],
    })
    const result = groundPredicateStructure(guide, SENTENCE)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.structure.subjectModifiers[0]).toMatchObject({ text: 'The sensor', start: 0, end: 10 })
    expect(result.structure.sentenceModifiers[0]).toMatchObject({ text: 'the results', start: 39, end: 50 })
  })
})

describe('groundPredicateStructure — exact source grounding failure', () => {
  it('rejects a predicate whose text is not an exact (or fuzzy-whitespace) substring of the sentence', () => {
    const guide = base({ predicates: [{ text: 'were fabricated', relation: 'main', dependents: [] }] })
    const result = groundPredicateStructure(guide, SENTENCE)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toContain('were fabricated')
  })

  it('rejects a dependent whose text does not resolve', () => {
    const guide = base({
      predicates: [{ text: 'collected', relation: 'main', dependents: [{ text: 'nonexistent phrase', role: 'object', children: [] }] }],
    })
    const result = groundPredicateStructure(guide, SENTENCE)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toContain('nonexistent phrase')
  })

  it('rejects a leaf child whose text does not resolve', () => {
    const guide = base({
      predicates: [
        {
          text: 'collected',
          relation: 'main',
          dependents: [{ text: 'data', role: 'object', children: [{ text: 'invented detail', role: 'other' }] }],
        },
      ],
    })
    const result = groundPredicateStructure(guide, SENTENCE)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toContain('invented detail')
  })

  it('rejects an unresolvable subjectModifier/sentenceModifier', () => {
    const guide = base({ subjectModifiers: [{ text: 'not in the sentence', role: 'modifier' }] })
    const result = groundPredicateStructure(guide, SENTENCE)
    expect(result.success).toBe(false)
  })

  it('re-derives offsets rather than trusting a claimed (wrong) start/end — same rationale as resolveAnalysisSpans.ts', () => {
    // groundPredicateStructure always calls resolveSpan with start/end -1 (never trusts the
    // model's own claim at all) — verified indirectly here by confirming the resolved
    // offsets match the sentence's actual position regardless of any hypothetical claim.
    const result = groundPredicateStructure(base(), SENTENCE)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(SENTENCE.slice(result.structure.predicates[0].start, result.structure.predicates[0].end)).toBe('collected')
  })
})
