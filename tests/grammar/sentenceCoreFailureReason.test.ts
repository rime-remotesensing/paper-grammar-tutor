import { describe, expect, it } from 'vitest'
import { classifySentenceCoreFailure } from '../../src/features/grammar/domain/sentenceCoreFailureReason'
import { isSentenceCoreFailure } from '../../src/features/grammar/domain/sentenceCoreRecovery'
import type { Span } from '../../src/features/grammar/schemas/grammarAnalysis.schema'

// Prototype 2.3L item 37 — failure-reason classifier tests.

function span(text: string, start: number): Span {
  return { text, start, end: start + text.length }
}

describe('classifySentenceCoreFailure — NONE', () => {
  it('returns NONE for a clean, non-overlapping core', () => {
    const core = { subject: span('The sensor', 0), subjectHead: span('sensor', 4), verb: span('recorded', 11) }
    expect(classifySentenceCoreFailure(core)).toBe('NONE')
  })
})

describe('classifySentenceCoreFailure — NULL_SUBJECT / NULL_VERB', () => {
  it('returns NULL_SUBJECT when subject is null', () => {
    const core = { subject: null, subjectHead: null, verb: span('recorded', 11) }
    expect(classifySentenceCoreFailure(core)).toBe('NULL_SUBJECT')
  })

  it('returns NULL_VERB when verb is null (subject present)', () => {
    const core = { subject: span('The sensor', 0), subjectHead: span('sensor', 4), verb: null }
    expect(classifySentenceCoreFailure(core)).toBe('NULL_VERB')
  })

  it('prioritizes NULL_SUBJECT over NULL_VERB when both are null (matches original check order)', () => {
    const core = { subject: null, subjectHead: null, verb: null }
    expect(classifySentenceCoreFailure(core)).toBe('NULL_SUBJECT')
  })
})

describe('classifySentenceCoreFailure — SUBJECT_VERB_OVERLAP (resolved-span based, not string containment)', () => {
  it('returns SUBJECT_VERB_OVERLAP when the resolved spans actually intersect', () => {
    // "We found the sensor" [0,20) vs "found" [3,8) -- genuinely overlapping ranges.
    const core = { subject: span('We found the sensor', 0), subjectHead: null, verb: span('found', 3) }
    expect(classifySentenceCoreFailure(core)).toBe('SUBJECT_VERB_OVERLAP')
  })

  it('does NOT flag overlap for adjacent (non-overlapping) spans', () => {
    // subject ends exactly where verb begins -- adjacency is not overlap.
    const core = { subject: span('The sensor', 0), subjectHead: null, verb: span('recorded', 10) }
    expect(classifySentenceCoreFailure(core)).toBe('NONE')
  })

  it('does not misfire via string containment when spans do not actually overlap', () => {
    // The word "sensor" appears in both subject and verb TEXT by coincidence, but their
    // resolved source positions do not overlap at all -- must not be misclassified.
    const core = {
      subject: span('The sensor', 0),
      subjectHead: span('sensor', 4),
      verb: span('sensor-calibrated', 40), // same substring, unrelated position
    }
    expect(classifySentenceCoreFailure(core)).toBe('NONE')
  })

  it('does not flag overlap when either span is ungrounded (-1,-1) — matches original spansOverlap guard', () => {
    const core = { subject: { text: 'We found the sensor', start: -1, end: -1 }, subjectHead: null, verb: span('found', 3) }
    expect(classifySentenceCoreFailure(core)).toBe('NONE')
  })
})

describe('classifySentenceCoreFailure — SUBJECT_HEAD_OUTSIDE', () => {
  it('returns SUBJECT_HEAD_OUTSIDE when subjectHead falls outside the subject span', () => {
    const core = { subject: span('sensor', 4), subjectHead: span('The sensor recorded', 0), verb: span('data', 21) }
    expect(classifySentenceCoreFailure(core)).toBe('SUBJECT_HEAD_OUTSIDE')
  })

  it('returns NONE when subjectHead is fully contained within subject', () => {
    const core = { subject: span('The sensor', 0), subjectHead: span('sensor', 4), verb: span('recorded', 11) }
    expect(classifySentenceCoreFailure(core)).toBe('NONE')
  })
})

describe('classifySentenceCoreFailure — boolean equivalence with isSentenceCoreFailure (item 6: no silent widening)', () => {
  const cases: Array<{ label: string; core: { subject: Span | null; subjectHead: Span | null; verb: Span | null } }> = [
    { label: 'clean core', core: { subject: span('The sensor', 0), subjectHead: span('sensor', 4), verb: span('recorded', 11) } },
    { label: 'null subject', core: { subject: null, subjectHead: null, verb: span('recorded', 11) } },
    { label: 'null verb', core: { subject: span('The sensor', 0), subjectHead: null, verb: null } },
    {
      label: 'overlap',
      core: { subject: span('We found the sensor', 0), subjectHead: null, verb: span('found', 3) },
    },
    {
      label: 'subjectHead outside',
      core: { subject: span('sensor', 4), subjectHead: span('The sensor recorded', 0), verb: span('data', 21) },
    },
    {
      // The one deliberate divergence point: an ungrounded (but non-null) subject with no
      // other issue. Both must agree this is NOT a failure (item 6's documented parity).
      label: 'ungrounded subject, otherwise clean',
      core: { subject: { text: 'The sensor', start: -1, end: -1 }, subjectHead: null, verb: span('recorded', 11) },
    },
  ]

  for (const { label, core } of cases) {
    it(`agrees with isSentenceCoreFailure for: ${label}`, () => {
      expect(classifySentenceCoreFailure(core) !== 'NONE').toBe(isSentenceCoreFailure(core))
    })
  }
})
