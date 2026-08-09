import { describe, expect, it } from 'vitest'
import { derivePattern } from '../../src/features/grammar/domain/derivePattern'
import type { Span } from '../../src/features/grammar/schemas/grammarAnalysis.schema'

const SPAN: Span = { text: 'x', start: 0, end: 1 }

describe('derivePattern', () => {
  it('returns other when there is no verb', () => {
    expect(
      derivePattern({ verb: null, indirectObject: null, object: null, complement: null }),
    ).toBe('other')
  })

  it('returns SV when only the verb is present', () => {
    expect(
      derivePattern({ verb: SPAN, indirectObject: null, object: null, complement: null }),
    ).toBe('SV')
  })

  it('returns SVC when only complement is present', () => {
    expect(
      derivePattern({ verb: SPAN, indirectObject: null, object: null, complement: SPAN }),
    ).toBe('SVC')
  })

  it('returns SVO when only object is present', () => {
    expect(
      derivePattern({ verb: SPAN, indirectObject: null, object: SPAN, complement: null }),
    ).toBe('SVO')
  })

  it('returns SVOO when both indirect and direct object are present', () => {
    expect(
      derivePattern({ verb: SPAN, indirectObject: SPAN, object: SPAN, complement: null }),
    ).toBe('SVOO')
  })

  it('returns SVOC when object and complement are both present', () => {
    expect(
      derivePattern({ verb: SPAN, indirectObject: null, object: SPAN, complement: SPAN }),
    ).toBe('SVOC')
  })

  it('returns other for an incoherent indirect-object-without-object combination', () => {
    expect(
      derivePattern({ verb: SPAN, indirectObject: SPAN, object: null, complement: null }),
    ).toBe('other')
  })

  it('matches the spec worked example: S V O, complement is null even though a PP is present elsewhere', () => {
    // "The results obtained in the previous experiment indicate that the proposed
    // method is effective." — the PP "in the previous experiment" is a modifier of
    // "obtained", not the sentence's complement, so complement must be null here.
    expect(
      derivePattern({ verb: SPAN, indirectObject: null, object: SPAN, complement: null }),
    ).toBe('SVO')
  })
})
