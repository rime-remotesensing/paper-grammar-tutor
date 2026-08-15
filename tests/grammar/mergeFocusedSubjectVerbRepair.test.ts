import { describe, expect, it } from 'vitest'
import { mergeFocusedSubjectVerbRepair } from '../../src/features/grammar/domain/mergeFocusedSubjectVerbRepair'
import type { SentenceCore, Span } from '../../src/features/grammar/schemas/grammarAnalysis.schema'

// Prototype 2.3L items 39/40/41 — target/simple-active fixtures + dependent preservation.

function span(text: string, start: number): Span {
  return { text, start, end: start + text.length }
}

function core(overrides: Partial<SentenceCore>): SentenceCore {
  return {
    subject: null,
    subjectHead: null,
    verb: null,
    indirectObject: null,
    object: null,
    complement: null,
    pattern: 'other',
    ...overrides,
  }
}

describe('mergeFocusedSubjectVerbRepair — target object-complement scenario', () => {
  it('"We found the sensor operating normally." — repairs S/V, preserves O/C, derives SVOC', () => {
    const raw = core({
      subject: span('We found the sensor', 0), // overscoped, this is what triggered the failure
      subjectHead: null,
      verb: span('found', 3),
      object: span('the sensor', 9),
      complement: span('operating normally', 20),
    })
    const focused = { subject: span('We', 0), subjectHead: span('We', 0), verb: span('found', 3) }
    const { core: merged, dropped } = mergeFocusedSubjectVerbRepair(raw, focused)

    expect(merged.subject?.text).toBe('We')
    expect(merged.verb?.text).toBe('found')
    expect(merged.object?.text).toBe('the sensor')
    expect(merged.complement?.text).toBe('operating normally')
    expect(merged.pattern).toBe('SVOC')
    expect(dropped).toEqual([])
  })
})

describe('mergeFocusedSubjectVerbRepair — simple SVO scenario', () => {
  it('"The sensor recorded data." — repairs S/V, preserves O, derives SVO', () => {
    const raw = core({
      subject: span('The sensor recorded data', 0), // overscoped
      subjectHead: span('sensor', 4),
      verb: span('recorded', 11),
      object: span('data', 20),
    })
    const focused = { subject: span('The sensor', 0), subjectHead: span('sensor', 4), verb: span('recorded', 11) }
    const { core: merged, dropped } = mergeFocusedSubjectVerbRepair(raw, focused)

    expect(merged.subject?.text).toBe('The sensor')
    expect(merged.verb?.text).toBe('recorded')
    expect(merged.object?.text).toBe('data')
    expect(merged.pattern).toBe('SVO')
    expect(dropped).toEqual([])
  })
})

describe('mergeFocusedSubjectVerbRepair — dependent preservation safety (item 41)', () => {
  it('preserves a safe (grounded, non-overlapping) object', () => {
    const raw = core({ object: span('data', 20) })
    const focused = { subject: span('The sensor', 0), subjectHead: span('sensor', 4), verb: span('recorded', 11) }
    const { core: merged, dropped } = mergeFocusedSubjectVerbRepair(raw, focused)
    expect(merged.object?.text).toBe('data')
    expect(dropped).toEqual([])
  })

  it('does NOT preserve an ungrounded object — drops it to null rather than guessing', () => {
    const raw = core({ object: { text: 'something', start: -1, end: -1 } })
    const focused = { subject: span('The sensor', 0), subjectHead: span('sensor', 4), verb: span('recorded', 11) }
    const { core: merged, dropped } = mergeFocusedSubjectVerbRepair(raw, focused)
    expect(merged.object).toBeNull()
    expect(dropped).toEqual([{ text: 'something', reason: 'ungrounded' }])
  })

  it('does NOT preserve an object that overlaps the repaired subject span', () => {
    // Raw object accidentally spans into the same region as the repaired subject.
    const raw = core({ object: span('The sensor', 0) })
    const focused = { subject: span('The sensor', 0), subjectHead: span('sensor', 4), verb: span('recorded', 11) }
    const { core: merged, dropped } = mergeFocusedSubjectVerbRepair(raw, focused)
    expect(merged.object).toBeNull()
    expect(dropped).toEqual([{ text: 'The sensor', reason: 'overlaps repaired subject' }])
  })

  it('does NOT preserve a complement that overlaps the repaired verb span', () => {
    const raw = core({ complement: span('recorded', 11) })
    const focused = { subject: span('The sensor', 0), subjectHead: span('sensor', 4), verb: span('recorded', 11) }
    const { core: merged, dropped } = mergeFocusedSubjectVerbRepair(raw, focused)
    expect(merged.complement).toBeNull()
    expect(dropped).toEqual([{ text: 'recorded', reason: 'overlaps repaired verb' }])
  })

  it('never regenerates/guesses a new IO/O/C value — only preserves-or-drops the raw one', () => {
    const raw = core({ object: span('data', 20), complement: null })
    const focused = { subject: span('The sensor', 0), subjectHead: span('sensor', 4), verb: span('recorded', 11) }
    const { core: merged } = mergeFocusedSubjectVerbRepair(raw, focused)
    // complement was null in raw and stays null -- never invented.
    expect(merged.complement).toBeNull()
  })

  it('pattern is always re-derived, never hand-set', () => {
    const raw = core({ object: null, complement: null })
    const focused = { subject: span('Data', 0), subjectHead: span('Data', 0), verb: span('increased', 5) }
    const { core: merged } = mergeFocusedSubjectVerbRepair(raw, focused)
    expect(merged.pattern).toBe('SV')
  })
})
