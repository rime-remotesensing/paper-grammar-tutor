import { describe, expect, it } from 'vitest'
import { evaluatePassiveCoreGate } from '../../src/features/grammar/domain/passiveCoreGate'
import type { Span } from '../../src/features/grammar/schemas/grammarAnalysis.schema'

// Prototype 2.5Z — passive-core-overcomplement gate tests, production port of the
// Prototype 2.5Y spike's validated gate (15/15 correct triggers, 0/25 false triggers).

function span(text: string, start: number): Span {
  return { text, start, end: start + text.length }
}

describe('evaluatePassiveCoreGate — positive: SVC passive overcomplement (item 39)', () => {
  it('fires for a modal+passive verb with a claimed SVC complement (exact CASE B shape)', () => {
    const result = evaluatePassiveCoreGate(span('can be rotated', 21), 'SVC', span('to the horizontal', 36))
    expect(result.fire).toBe(true)
  })

  it('fires for a bare-be passive verb with a claimed SVC complement', () => {
    const result = evaluatePassiveCoreGate(span('is applied', 17), 'SVC', span('directly', 30))
    expect(result.fire).toBe(true)
  })
})

describe('evaluatePassiveCoreGate — positive: SVOC passive overcomplement', () => {
  it('fires for a modal+passive verb with a claimed SVOC complement', () => {
    const result = evaluatePassiveCoreGate(span('can be rotated', 21), 'SVOC', span('to normalize the data', 54))
    expect(result.fire).toBe(true)
  })
})

describe('evaluatePassiveCoreGate — negative: already-correct SV passive', () => {
  it('does NOT fire when pattern is SV (no complement claimed at all)', () => {
    const result = evaluatePassiveCoreGate(span('can be rotated', 21), 'SV', null)
    expect(result.fire).toBe(false)
  })

  it('does NOT fire when pattern is SVC/SVOC but complement is null', () => {
    const result = evaluatePassiveCoreGate(span('can be rotated', 21), 'SVC', null)
    expect(result.fire).toBe(false)
  })
})

describe('evaluatePassiveCoreGate — negative: genuine copular SVC (mutual exclusion with copularCoreGate, item 7)', () => {
  it('does NOT fire for a bare "is" with an SVC complement (not passive-shaped)', () => {
    const result = evaluatePassiveCoreGate(span('is', 16), 'SVC', span('a function of the regression slope', 19))
    expect(result.fire).toBe(false)
  })
})

describe('evaluatePassiveCoreGate — negative: active SVC', () => {
  it('does NOT fire for an ordinary active verb even with a claimed complement', () => {
    const result = evaluatePassiveCoreGate(span('remains', 20), 'SVC', span('a major challenge', 28))
    expect(result.fire).toBe(false)
  })
})

describe('evaluatePassiveCoreGate — negative: no verb / active non-passive', () => {
  it('does NOT fire when verb is null', () => {
    expect(evaluatePassiveCoreGate(null, 'SVC', span('x', 0)).fire).toBe(false)
  })

  it('does NOT fire for a verb that is not passive-shaped at all', () => {
    const result = evaluatePassiveCoreGate(span('collected', 11), 'SVOC', span('data valid', 21))
    expect(result.fire).toBe(false)
  })
})
