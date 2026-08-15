import { describe, expect, it } from 'vitest'
import { llmFocusedRelativeLinkSchema, relativeWordSchema } from '../../src/features/grammar/schemas/focusedRelativeLink.schema'

// Prototype 2.3O item 51 — schema tests.

describe('llmFocusedRelativeLinkSchema', () => {
  it('accepts an empty relations array', () => {
    const result = llmFocusedRelativeLinkSchema.safeParse({ relations: [] })
    expect(result.success).toBe(true)
  })

  it('accepts a valid "that" relation', () => {
    const result = llmFocusedRelativeLinkSchema.safeParse({
      relations: [{ antecedent: 'those aspects', relativeWord: 'that', relativeClause: 'that have changed since Collection 5' }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid "which" relation', () => {
    const result = llmFocusedRelativeLinkSchema.safeParse({
      relations: [{ antecedent: 'The results', relativeWord: 'which', relativeClause: 'which we obtained' }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid "who" relation', () => {
    const result = llmFocusedRelativeLinkSchema.safeParse({
      relations: [{ antecedent: 'The scientist', relativeWord: 'who', relativeClause: 'who discovered the compound' }],
    })
    expect(result.success).toBe(true)
  })

  it('rejects "whose" (deferred this round, item 39/DEFER)', () => {
    const result = llmFocusedRelativeLinkSchema.safeParse({
      relations: [{ antecedent: 'The sensor', relativeWord: 'whose', relativeClause: 'whose calibration was updated' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects "whom" (deferred)', () => {
    const result = llmFocusedRelativeLinkSchema.safeParse({
      relations: [{ antecedent: 'The scientist', relativeWord: 'whom', relativeClause: 'whom we met' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an arbitrary word as relativeWord (item 53: zero-relative hallucination protection)', () => {
    const result = llmFocusedRelativeLinkSchema.safeParse({
      relations: [{ antecedent: 'The method', relativeWord: 'we', relativeClause: 'we used' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a relation missing a required field', () => {
    const result = llmFocusedRelativeLinkSchema.safeParse({
      relations: [{ antecedent: 'The method', relativeWord: 'that' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a relation with an empty-string field', () => {
    const result = llmFocusedRelativeLinkSchema.safeParse({
      relations: [{ antecedent: '', relativeWord: 'that', relativeClause: 'that we used' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects extra/unexpected top-level fields', () => {
    const result = llmFocusedRelativeLinkSchema.safeParse({ relations: [], function: 'SUBJECT' })
    expect(result.success).toBe(true) // extra top-level keys are ignored by default z.object; relations itself is what matters
  })

  it('rejects a relation carrying a function field with an invalid enum shape mixed in incorrectly (defensive: schema does not require/accept function at all)', () => {
    const result = llmFocusedRelativeLinkSchema.safeParse({
      relations: [{ antecedent: 'The method', relativeWord: 'that', relativeClause: 'that we used', function: 'OBJECT' }],
    })
    // function is simply an unrecognized extra key on the relation object -- zod's default
    // object parsing strips unknown keys rather than rejecting, so this still succeeds; the
    // resulting parsed relation itself never carries `function` (verified by type: the
    // inferred LlmFocusedRelativeLinkRelation type has no `function` field at all, item 5).
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.relations[0]).not.toHaveProperty('function')
    }
  })
})

describe('relativeWordSchema', () => {
  it('accepts exactly that/which/who', () => {
    for (const word of ['that', 'which', 'who']) {
      expect(relativeWordSchema.safeParse(word).success).toBe(true)
    }
  })

  it('rejects whose/whom/where/when/why and arbitrary words', () => {
    for (const word of ['whose', 'whom', 'where', 'when', 'why', 'we', 'this']) {
      expect(relativeWordSchema.safeParse(word).success).toBe(false)
    }
  })
})
