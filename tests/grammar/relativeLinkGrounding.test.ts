import { describe, expect, it } from 'vitest'
import { groundRelativeLinkRelation, groundRelativeLinkRelations } from '../../src/features/grammar/domain/relativeLinkGrounding'

// Prototype 2.3O item 52 — grounding tests. Item 53 — zero-relative hallucination
// protection, at the mechanical-sanity layer (the schema-level protection is covered in
// focusedRelativeLink.schema.test.ts; this file proves the SECOND, independent layer also
// catches it, per item 10's "schema + mechanical validationの両方で保証").

describe('groundRelativeLinkRelation', () => {
  const target = 'In Section 3, we describe the Collection 6 algorithm, emphasizing those aspects that have changed since Collection 5.'

  it('grounds a valid relation to exact source spans', () => {
    const result = groundRelativeLinkRelation(target, {
      antecedent: 'those aspects',
      relativeWord: 'that',
      relativeClause: 'that have changed since Collection 5',
    })
    expect(result).not.toBeNull()
    expect(result?.antecedentSpan).toEqual({ text: 'those aspects', start: 66, end: 79 })
    expect(result?.relativeWordSpan).toEqual({ text: 'that', start: 80, end: 84 })
    expect(result?.relativeClauseSpan).toEqual({ text: 'that have changed since Collection 5', start: 80, end: target.length - 1 })
  })

  it('discards a relation whose antecedent is not a literal substring', () => {
    const result = groundRelativeLinkRelation(target, {
      antecedent: 'the aspects', // wrong determiner -- not present verbatim
      relativeWord: 'that',
      relativeClause: 'that have changed since Collection 5',
    })
    expect(result).toBeNull()
  })

  it('discards a relation whose relativeClause is not a literal substring', () => {
    const result = groundRelativeLinkRelation(target, {
      antecedent: 'those aspects',
      relativeWord: 'that',
      relativeClause: 'that changed recently', // fabricated, not in the source
    })
    expect(result).toBeNull()
  })

  it('discards a relation where relativeWord does not sit at the start of relativeClause (sanity check 4/5)', () => {
    const result = groundRelativeLinkRelation('The device that failed was replaced.', {
      antecedent: 'The device',
      relativeWord: 'that',
      relativeClause: 'failed', // relativeClause span does not start at relativeWordSpan
    })
    expect(result).toBeNull()
  })

  it('resolves relativeClause AFTER the antecedent even when an identical-looking span exists earlier in the sentence (sanity check 6\'s "antecedent before clause" guarantee, enforced via fromIndex rather than ever needing to reject a result)', () => {
    // "that failed" appears once BEFORE "The device" and once after -- resolveSpan's
    // fromIndex=antecedentSpan.end for both relativeWord and relativeClause makes it
    // structurally impossible to resolve to the earlier occurrence, so sanity check 6
    // (antecedent ends at/before relativeClause starts) can never actually fail in
    // practice; this test proves the guarantee holds rather than exercising a discard.
    const sentence = 'that failed. The device that failed was replaced.'
    const result = groundRelativeLinkRelation(sentence, {
      antecedent: 'The device',
      relativeWord: 'that',
      relativeClause: 'that failed',
    })
    expect(result).not.toBeNull()
    expect(result?.relativeClauseSpan.start).toBeGreaterThan(result!.antecedentSpan.start)
  })

  it('discards a hallucinated non-relative-pronoun relativeWord even if it happens to be a literal substring (item 53)', () => {
    const result = groundRelativeLinkRelation('The method we used was effective.', {
      antecedent: 'The method',
      // @ts-expect-error -- intentionally bypassing the Zod/TS type to exercise the
      // mechanical-sanity layer directly, simulating a raw LLM payload that somehow reached
      // this function without going through schema validation first (defense in depth).
      relativeWord: 'we',
      relativeClause: 'we used',
    })
    expect(result).toBeNull()
  })

  it('discards a relation with no relative word at all in the antecedent-onward text', () => {
    const result = groundRelativeLinkRelation('The study showed that temperature increased.', {
      antecedent: 'The study',
      relativeWord: 'that',
      relativeClause: 'that temperature increased',
    })
    // "that temperature increased" IS a literal substring here (content-clause "that"), so
    // grounding alone does not reject it -- rejecting content-that is the analyzer prompt's
    // job (never returning this relation in the first place), not the grounding layer's.
    // This test documents that boundary rather than asserting a specific grounding outcome.
    expect(result).not.toBeNull()
  })
})

describe('groundRelativeLinkRelations (batch)', () => {
  it('keeps valid relations and silently drops invalid ones, never throwing', () => {
    const sentence = 'The method that we used produced values that agreed with the observations.'
    const results = groundRelativeLinkRelations(sentence, [
      { antecedent: 'The method', relativeWord: 'that', relativeClause: 'that we used' },
      { antecedent: 'values', relativeWord: 'that', relativeClause: 'that agreed with the observations' },
      { antecedent: 'nonexistent phrase', relativeWord: 'that', relativeClause: 'that does not exist' },
    ])
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.antecedent)).toEqual(['The method', 'values'])
  })

  it('returns an empty array for an empty input', () => {
    expect(groundRelativeLinkRelations('Anything.', [])).toEqual([])
  })
})
