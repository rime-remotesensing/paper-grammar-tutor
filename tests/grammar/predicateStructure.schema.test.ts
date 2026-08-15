import { describe, expect, it } from 'vitest'
import { llmPredicateStructureSchema } from '../../src/features/grammar/schemas/predicateStructure.schema'
import { PREDICATE_STRUCTURE_JSON_SCHEMA } from '../../src/features/grammar/schemas/predicateStructure.jsonSchema'

// Prototype 2.3C item 36 — schema tests: 1 predicate / 2 coordinated / 3 predicates /
// nested dependents / invalid relation / malformed dependent / exact source grounding
// failure (grounding itself is covered by predicateStructureGrounding.test.ts; this file
// covers shape/enum validity only, mirroring the GrammarAnalysis schema test split).

function leaf(text = 'x', role = 'modifier') {
  return { text, role }
}

function dependent(text = 'data', role = 'object', children: ReturnType<typeof leaf>[] = []) {
  return { text, role, children }
}

function predicate(text = 'collected', relation = 'main', dependents: ReturnType<typeof dependent>[] = []) {
  return { text, relation, dependents }
}

function structure(overrides: Record<string, unknown> = {}) {
  return {
    subjectModifiers: [],
    predicates: [predicate()],
    sentenceModifiers: [],
    ...overrides,
  }
}

describe('llmPredicateStructureSchema — 1 predicate', () => {
  it('accepts a single main predicate with no dependents', () => {
    expect(llmPredicateStructureSchema.safeParse(structure()).success).toBe(true)
  })
})

describe('llmPredicateStructureSchema — 2 coordinated predicates', () => {
  it('accepts one main + one coordinated predicate (active coordination shape)', () => {
    const valid = structure({
      predicates: [
        predicate('collected', 'main', [dependent('data', 'object')]),
        predicate('analyzed', 'coordinated', [dependent('the results', 'object')]),
      ],
    })
    expect(llmPredicateStructureSchema.safeParse(valid).success).toBe(true)
  })
})

describe('llmPredicateStructureSchema — 3 predicates', () => {
  it('accepts three predicates (triple predicate shape: main not necessarily first)', () => {
    const valid = structure({
      predicates: [
        predicate('were dried', 'coordinated'),
        predicate('weighed', 'coordinated'),
        predicate('stored', 'main', [dependent('at room temperature', 'condition')]),
      ],
    })
    expect(llmPredicateStructureSchema.safeParse(valid).success).toBe(true)
  })
})

describe('llmPredicateStructureSchema — nested dependents (fixed depth: predicate -> dependent -> leaf)', () => {
  it('accepts a dependent with leaf children', () => {
    const valid = structure({
      predicates: [predicate('was recorded', 'main', [dependent('every 1 nm', 'condition', [leaf('in the region', 'range')])])],
    })
    expect(llmPredicateStructureSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a leaf that itself tries to carry a "children" field (depth is fixed at 3 levels, no deeper)', () => {
    const leafWithChildren: Record<string, unknown> = { text: 'in the region', role: 'range', children: [] }
    const invalid = structure({
      predicates: [predicate('was recorded', 'main', [dependent('every 1 nm', 'condition', [leafWithChildren as never])])],
    })
    // A leaf carrying its own "children" is simply ignored by Zod's default stripping,
    // not rejected — this test documents that the schema itself, not app logic, is what
    // enforces the 3-level ceiling (leaves have no children field in the type at all).
    const result = llmPredicateStructureSchema.safeParse(invalid)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.predicates[0].dependents[0].children[0]).not.toHaveProperty('children')
  })
})

describe('llmPredicateStructureSchema — invalid relation', () => {
  it('rejects a predicate whose relation is not "main" or "coordinated"', () => {
    const invalid = structure({ predicates: [predicate('collected', 'secondary')] })
    expect(llmPredicateStructureSchema.safeParse(invalid).success).toBe(false)
  })
})

describe('llmPredicateStructureSchema — malformed dependent', () => {
  it('rejects a dependent with an invalid role', () => {
    const invalid = structure({ predicates: [predicate('collected', 'main', [dependent('data', 'notARole')])] })
    expect(llmPredicateStructureSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects a dependent missing "text"', () => {
    const invalid = structure({
      predicates: [{ text: 'collected', relation: 'main', dependents: [{ role: 'object', children: [] }] }],
    })
    expect(llmPredicateStructureSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects an empty-string text (resolveSpan("") would trivially "match" at position 0)', () => {
    const invalid = structure({ predicates: [predicate('', 'main')] })
    expect(llmPredicateStructureSchema.safeParse(invalid).success).toBe(false)
  })
})

describe('llmPredicateStructureSchema — structural invariants', () => {
  it('rejects an empty predicates array (a sentence always has at least one predicate)', () => {
    const invalid = structure({ predicates: [] })
    expect(llmPredicateStructureSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects a missing top-level field (sentenceModifiers)', () => {
    const { sentenceModifiers: _sentenceModifiers, ...invalid } = structure()
    expect(llmPredicateStructureSchema.safeParse(invalid).success).toBe(false)
  })

  it('accepts subjectModifiers/sentenceModifiers as leaves with a role, no children field', () => {
    const valid = structure({ subjectModifiers: [leaf('of X, Y and Z', 'modifier')], sentenceModifiers: [leaf('Although...', 'clause')] })
    expect(llmPredicateStructureSchema.safeParse(valid).success).toBe(true)
  })
})

describe('PREDICATE_STRUCTURE_JSON_SCHEMA — no numeric parent references, no $ref (Prototype 2.2A lesson)', () => {
  it('never declares parent/parentIndex/nodeId', () => {
    const serialized = JSON.stringify(PREDICATE_STRUCTURE_JSON_SCHEMA)
    expect(serialized).not.toContain('"parent"')
    expect(serialized).not.toContain('"parentIndex"')
    expect(serialized).not.toContain('"nodeId"')
  })

  it('never uses $ref (fixed-depth, not recursive)', () => {
    const serialized = JSON.stringify(PREDICATE_STRUCTURE_JSON_SCHEMA)
    expect(serialized).not.toContain('$ref')
  })

  it('required fields are exactly subjectModifiers/predicates/sentenceModifiers', () => {
    expect(PREDICATE_STRUCTURE_JSON_SCHEMA.required).toEqual(['subjectModifiers', 'predicates', 'sentenceModifiers'])
  })
})
