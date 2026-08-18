import { describe, expect, it } from 'vitest'
import {
  DEVELOPMENT_CASES,
  GENERALIZATION_DATASET,
  LOCKED_HOLDOUT_CASES,
} from '../../benchmark/generalization/dataset'

describe('Prototype 2.6D complex generalization dataset', () => {
  it('freezes 48 development and 24 locked holdout cases', () => {
    expect(DEVELOPMENT_CASES).toHaveLength(48)
    expect(LOCKED_HOLDOUT_CASES).toHaveLength(24)
    expect(LOCKED_HOLDOUT_CASES.every(({ locked }) => locked)).toBe(true)
    expect(DEVELOPMENT_CASES.every(({ locked }) => !locked)).toBe(true)
  })

  it('grounds every gold span exactly to its source sentence', () => {
    for (const item of GENERALIZATION_DATASET) {
      const spans = [
        item.gold.subject,
        ...item.gold.predicateCores.flatMap((core) => [
          core.verb, core.indirectObject, core.object, core.complement,
        ]),
        ...item.gold.attachments.map(({ span }) => span),
      ].filter((span) => span !== null)
      for (const span of spans) expect(item.text.slice(span.start, span.end)).toBe(span.text)
    }
  })

  it('covers every required structural family with multi-label tags', () => {
    const tags = new Set(GENERALIZATION_DATASET.flatMap(({ tags: itemTags }) => itemTags))
    for (const required of [
      'passive-pp', 'infinitive', 'reduced-relative', 'relative-clause', 'postnominal-participle',
      'stacked-pp', 'predicate-coordination', 'subordinate-clause', 'colon', 'semicolon',
      'respectively', 'citation', 'equation', 'multiple-modifier-depths', 'long-50-80', 'long-80+',
      'SVC+SVC', 'SVC+SV', 'SVO+SVO', 'active-passive', 'three-predicates', 'internal-np-coordination',
    ]) expect(tags.has(required)).toBe(true)
  })

  it('contains both 50–80-word and over-80-word controls', () => {
    expect(GENERALIZATION_DATASET.some(({ wordCount }) => wordCount >= 50 && wordCount <= 80)).toBe(true)
    expect(GENERALIZATION_DATASET.some(({ wordCount }) => wordCount > 80)).toBe(true)
  })

  it('never labels an ordinary passive post-verbal PP as a complement', () => {
    const passivePpCases = GENERALIZATION_DATASET.filter(({ tags }) => tags.includes('passive-pp'))
    expect(passivePpCases.length).toBeGreaterThan(0)
    for (const item of passivePpCases) {
      expect(item.gold.primaryCore.complement).toBeNull()
      expect(item.gold.primaryCore.pattern).toBe('SV')
    }
  })

  it('represents shared-subject mixed coordination as multiple predicate cores', () => {
    const mixedCases = GENERALIZATION_DATASET.filter(({ tags }) => tags.includes('mixed-pattern'))
    expect(mixedCases.length).toBeGreaterThanOrEqual(3)
    expect(mixedCases.every(({ gold }) => gold.predicateCores.length >= 2)).toBe(true)
  })
})
