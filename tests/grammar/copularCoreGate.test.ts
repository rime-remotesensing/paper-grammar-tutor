import { describe, expect, it } from 'vitest'
import { evaluateCopularGate } from '../../src/features/grammar/domain/copularCoreGate'
import type { Span } from '../../src/features/grammar/schemas/grammarAnalysis.schema'

// Prototype 2.5W — copular-core gate tests, production port of the Prototype 2.5V spike's
// validated signals (20/20 exact-target, 15/15 passive negative controls, 5/5 coordinated
// controls via signal 2).

function span(text: string, start: number): Span {
  return { text, start, end: start + text.length }
}

describe('evaluateCopularGate — signal 1: bare copula + object slot filled (classic O-vs-C shape)', () => {
  it('fires when verb is a bare "is" and an object slot is populated', () => {
    const result = evaluateCopularGate(span('is', 17), span('a function of the regression slope', 20), null)
    expect(result.fire).toBe(true)
    expect(result.verbShapeFired).toBe(true)
  })

  it('does NOT fire for a bare "is" with no object (already SVC or SV, nothing to check)', () => {
    const result = evaluateCopularGate(span('is', 17), null, null)
    expect(result.fire).toBe(false)
  })
})

describe('evaluateCopularGate — signal 1: multi-word be-verb over-capture shape', () => {
  it('fires for "is a function of" (over-captured, does not look passive)', () => {
    const result = evaluateCopularGate(span('is a function of', 17), null, null)
    expect(result.fire).toBe(true)
    expect(result.verbShapeFired).toBe(true)
  })

  it('fires for "is a problem" style over-capture', () => {
    const result = evaluateCopularGate(span('is a problem', 17), null, null)
    expect(result.fire).toBe(true)
  })
})

describe('evaluateCopularGate — passive protection (item 16: mandatory negative controls)', () => {
  it('does NOT fire for "is applied"', () => {
    const result = evaluateCopularGate(span('is applied', 17), null, null)
    expect(result.fire).toBe(false)
  })

  it('does NOT fire for "are normalized"', () => {
    const result = evaluateCopularGate(span('are normalized', 17), null, null)
    expect(result.fire).toBe(false)
  })

  it('does NOT fire for "is based"', () => {
    const result = evaluateCopularGate(span('is based', 17), span('on observations', 26), null)
    expect(result.fire).toBe(false)
  })

  it('does NOT fire for a regular -ed passive not in the closed set', () => {
    const result = evaluateCopularGate(span('is validated', 17), null, null)
    expect(result.fire).toBe(false)
  })
})

describe('evaluateCopularGate — no verb / non-copula verb', () => {
  it('does NOT fire when core.verb is null', () => {
    expect(evaluateCopularGate(null, null, null).fire).toBe(false)
  })

  it('does NOT fire for a verb that is not copula-led at all', () => {
    const result = evaluateCopularGate(span('collected', 11), span('data', 21), null)
    expect(result.fire).toBe(false)
  })
})

describe('evaluateCopularGate — signal 2: Stage-2 divergence', () => {
  it('fires when a grounded Stage-2 main predicate does not overlap Stage-1 core.verb at all', () => {
    // Stage 1 anchored on the coordinated second clause ("is introduced"); Stage 2's own
    // main predicate is "is a function", which never overlaps it.
    const coreVerb = span('is introduced', 93)
    const stage2Main = span('is a function', 16)
    const result = evaluateCopularGate(coreVerb, null, stage2Main)
    expect(result.fire).toBe(true)
    expect(result.divergesFromStage2).toBe(true)
  })

  it('does NOT fire on divergence grounds when the spans DO overlap', () => {
    const coreVerb = span('is a function', 16)
    const stage2Main = span('is a function', 16)
    const result = evaluateCopularGate(coreVerb, null, stage2Main)
    expect(result.divergesFromStage2).toBe(false)
  })

  it('is inert (never fires on signal 2 alone) when no Stage-2 hint is supplied — the production default today', () => {
    const result = evaluateCopularGate(span('is introduced', 93), null, null)
    expect(result.divergesFromStage2).toBe(false)
  })

  it('does not double-fire signal 2 for passive verbs even when a stage2 hint happens to diverge', () => {
    // Even if a hint were supplied and diverged, signal 1 stays independently correct — a
    // passive verb by itself is not why this fires; divergence is its own signal.
    const coreVerb = span('is applied', 93)
    const stage2Main = span('is a function', 16)
    const result = evaluateCopularGate(coreVerb, null, stage2Main)
    expect(result.verbShapeFired).toBe(false)
    expect(result.divergesFromStage2).toBe(true)
    expect(result.fire).toBe(true)
  })
})
