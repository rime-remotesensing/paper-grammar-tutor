import { describe, expect, it } from 'vitest'
import { evaluateWhereClauseGate } from '../../src/features/grammar/domain/whereClauseGate'
import type { PredicateStructure } from '../../src/features/grammar/schemas/predicateStructure.schema'

// Prototype 2.5W — where-clause gate tests.

function leaf(text: string, start: number, role: PredicateStructure['sentenceModifiers'][number]['role'] = 'clause') {
  return { text, start, end: start + text.length, role }
}

function structureOf(overrides: Partial<PredicateStructure>): PredicateStructure {
  return { subjectModifiers: [], predicates: [], sentenceModifiers: [], ...overrides }
}

describe('evaluateWhereClauseGate — candidacy (item 31)', () => {
  it('fires for a "where ..." clause-role sentenceModifier when accepted predicates exist', () => {
    const structure = structureOf({ sentenceModifiers: [leaf('where x is the input', 10)] })
    const result = evaluateWhereClauseGate(structure, 1)
    expect(result.fire).toBe(true)
    expect(result.candidateIndex).toBe(0)
  })

  it('does NOT fire when no accepted predicate candidates exist at all', () => {
    const structure = structureOf({ sentenceModifiers: [leaf('where x is the input', 10)] })
    const result = evaluateWhereClauseGate(structure, 0)
    expect(result.fire).toBe(false)
  })

  it('does NOT fire when there is no clause-role sentenceModifier at all', () => {
    const structure = structureOf({ sentenceModifiers: [leaf('under load', 10, 'condition')] })
    expect(evaluateWhereClauseGate(structure, 1).fire).toBe(false)
  })

  it('does NOT fire for a clause-role sentenceModifier that does not start with "where" (item 32: narrow production scope)', () => {
    const structure = structureOf({ sentenceModifiers: [leaf('which is the primary factor', 10)] })
    expect(evaluateWhereClauseGate(structure, 1).fire).toBe(false)
  })
})

describe('evaluateWhereClauseGate — healthy structure never repaired (item 31/46-48)', () => {
  it('does NOT fire when a clause dependent elsewhere already has more than one child (already well-formed)', () => {
    const structure = structureOf({
      predicates: [
        {
          text: 'use',
          start: 3,
          end: 6,
          relation: 'main',
          dependents: [
            {
              text: 'where x is the input and y is the output',
              start: 15,
              end: 57,
              role: 'clause',
              children: [leaf('x is the input', 20), leaf('y is the output', 40)],
            },
          ],
        },
      ],
      sentenceModifiers: [],
    })
    expect(evaluateWhereClauseGate(structure, 1).fire).toBe(false)
  })

  it('fires when a clause dependent exists but has zero/one children (not yet well-formed) AND a candidate sentenceModifier exists', () => {
    const structure = structureOf({
      predicates: [
        {
          text: 'use',
          start: 3,
          end: 6,
          relation: 'main',
          dependents: [{ text: 'a model', start: 8, end: 15, role: 'object', children: [] }],
        },
      ],
      sentenceModifiers: [leaf('where x is the input', 20)],
    })
    expect(evaluateWhereClauseGate(structure, 1).fire).toBe(true)
  })
})
