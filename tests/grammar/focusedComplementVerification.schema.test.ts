import { describe, expect, it } from 'vitest'
import { llmFocusedComplementVerificationSchema } from '../../src/features/grammar/schemas/focusedComplementVerification.schema'
import { FOCUSED_COMPLEMENT_VERIFICATION_JSON_SCHEMA } from '../../src/features/grammar/schemas/focusedComplementVerification.jsonSchema'
import {
  buildFocusedComplementVerifierPrompt,
  buildFocusedComplementVerifierRepairPrompt,
} from '../../src/llm/prompts/focusedComplementVerifierPrompt'

// Prototype 2.3I item 35 — schema/prompt contract tests.

describe('llmFocusedComplementVerificationSchema', () => {
  it('accepts a valid OBJECT_COMPLEMENT response', () => {
    const result = llmFocusedComplementVerificationSchema.safeParse({
      classification: 'OBJECT_COMPLEMENT',
      reasonCode: 'OBJECT_PREDICATION',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid SUPPLEMENTARY_ING response', () => {
    const result = llmFocusedComplementVerificationSchema.safeParse({
      classification: 'SUPPLEMENTARY_ING',
      reasonCode: 'COMMA_SUPPLEMENT',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid UNCERTAIN response', () => {
    const result = llmFocusedComplementVerificationSchema.safeParse({
      classification: 'UNCERTAIN',
      reasonCode: 'INSUFFICIENT_EVIDENCE',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid classification value', () => {
    const result = llmFocusedComplementVerificationSchema.safeParse({
      classification: 'MAYBE',
      reasonCode: 'OBJECT_PREDICATION',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid reasonCode value', () => {
    const result = llmFocusedComplementVerificationSchema.safeParse({
      classification: 'OBJECT_COMPLEMENT',
      reasonCode: 'BECAUSE_I_SAID_SO',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a response missing classification', () => {
    const result = llmFocusedComplementVerificationSchema.safeParse({ reasonCode: 'OBJECT_PREDICATION' })
    expect(result.success).toBe(false)
  })

  it('rejects a response missing reasonCode', () => {
    const result = llmFocusedComplementVerificationSchema.safeParse({ classification: 'OBJECT_COMPLEMENT' })
    expect(result.success).toBe(false)
  })
})

describe('FOCUSED_COMPLEMENT_VERIFICATION_JSON_SCHEMA — 1:1 alignment with the Zod schema', () => {
  it('declares the exact same classification enum values as the Zod schema', () => {
    expect(FOCUSED_COMPLEMENT_VERIFICATION_JSON_SCHEMA.properties.classification.enum).toEqual([
      'OBJECT_COMPLEMENT',
      'SUPPLEMENTARY_ING',
      'UNCERTAIN',
    ])
  })

  it('declares the exact same reasonCode enum values as the Zod schema', () => {
    expect(FOCUSED_COMPLEMENT_VERIFICATION_JSON_SCHEMA.properties.reasonCode.enum).toEqual([
      'OBJECT_PREDICATION',
      'COMMA_SUPPLEMENT',
      'INSUFFICIENT_EVIDENCE',
    ])
  })

  it('requires exactly classification and reasonCode, no more, no less', () => {
    expect(FOCUSED_COMPLEMENT_VERIFICATION_JSON_SCHEMA.required).toEqual(['classification', 'reasonCode'])
    expect(FOCUSED_COMPLEMENT_VERIFICATION_JSON_SCHEMA.additionalProperties).toBe(false)
  })
})

describe('focusedComplementVerifierPrompt — Prototype 2.3H authority (item 5: no prompt tuning)', () => {
  it('never mentions the target sentence in the prompt build functions themselves (few-shot stays fixed, item 8)', () => {
    const prompt = buildFocusedComplementVerifierPrompt(
      'In section 3, we describe the Collection 6 algorithm, emphasizing those aspects that have changed since Collection 5.',
      'we',
      'describe',
      'the Collection 6 algorithm',
      'emphasizing those aspects that have changed since Collection 5',
    )
    // The target sentence appears in the USER prompt (it's the actual input being
    // classified) but never inside the SYSTEM prompt's fixed few-shot examples.
    expect(prompt.system).not.toContain('Collection 6')
    expect(prompt.system).not.toContain('section 3')
  })

  it('the system prompt is exactly the 2.3H-authority 27-line text (line count guard)', () => {
    const prompt = buildFocusedComplementVerifierPrompt('x', 's', 'v', 'o', 'c')
    expect(prompt.system.split('\n')).toHaveLength(27)
  })

  it('the system prompt contains exactly the 2 fixed few-shot examples', () => {
    const prompt = buildFocusedComplementVerifierPrompt('x', 's', 'v', 'o', 'c')
    expect(prompt.system).toContain('We found the sensor operating normally.')
    expect(prompt.system).toContain('We describe the method, emphasizing its main advantages.')
    // No third example.
    expect((prompt.system.match(/^Example \d:/gm) ?? []).length).toBe(2)
  })

  it('the repair prompt keeps the exact same fixed system prompt', () => {
    const prompt = buildFocusedComplementVerifierPrompt('x', 's', 'v', 'o', 'c')
    const repairPrompt = buildFocusedComplementVerifierRepairPrompt('x', 's', 'v', 'o', 'c', 'bad output', 'some error')
    expect(repairPrompt.system).toBe(prompt.system)
  })

  it('includes subject/verb/object/candidate complement in the user prompt, verbatim', () => {
    const prompt = buildFocusedComplementVerifierPrompt('The sentence.', 'we', 'describe', 'the algorithm', 'emphasizing X')
    expect(prompt.user).toContain('Subject: we')
    expect(prompt.user).toContain('Verb: describe')
    expect(prompt.user).toContain('Object: the algorithm')
    expect(prompt.user).toContain('Candidate complement: emphasizing X')
  })
})
