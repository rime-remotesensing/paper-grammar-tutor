import { describe, expect, it } from 'vitest'
import { isSuspiciousCommaIngComplement } from '../../src/features/grammar/domain/commaIngComplementGate'
import type { SentenceCore, Span } from '../../src/features/grammar/schemas/grammarAnalysis.schema'

// Prototype 2.3I item 36 — suspicious gate tests, production port of the Prototype
// 2.3G/2.3H validated pure helper (unchanged logic).

/** Locates `text` inside `sentence` via indexOf, so fixture spans are always correct by
 * construction instead of hand-counted (a hand-counted offset caused two failing tests
 * during this file's first draft — see commit history if reintroducing manual offsets). */
function spanIn(sentence: string, text: string): Span {
  const start = sentence.indexOf(text)
  if (start === -1) throw new Error(`fixture bug: "${text}" not found in "${sentence}"`)
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

describe('isSuspiciousCommaIngComplement — target true', () => {
  it('fires on the exact target sentence shape', () => {
    const sentence =
      'In section 3, we describe the Collection 6 algorithm, emphasizing those aspects that have changed since Collection 5.'
    const c = core({
      pattern: 'SVOC',
      subject: spanIn(sentence, 'we'),
      verb: spanIn(sentence, 'describe'),
      object: spanIn(sentence, 'the Collection 6 algorithm'),
      complement: spanIn(sentence, 'emphasizing those aspects that have changed since Collection 5'),
    })
    expect(isSuspiciousCommaIngComplement(sentence, c)).toBe(true)
  })
})

describe('isSuspiciousCommaIngComplement — comma + V-ing true when SVOC', () => {
  it('fires for a generic comma + V-ing SVOC shape', () => {
    const sentence = 'We describe the method, emphasizing its advantages.'
    const c = core({
      pattern: 'SVOC',
      object: spanIn(sentence, 'the method'),
      complement: spanIn(sentence, 'emphasizing its advantages'),
    })
    expect(isSuspiciousCommaIngComplement(sentence, c)).toBe(true)
  })
})

describe('isSuspiciousCommaIngComplement — negative controls', () => {
  it('does not fire when there is no comma between object and complement (true SVOC)', () => {
    const sentence = 'We found the sensor operating normally.'
    const c = core({
      pattern: 'SVOC',
      object: spanIn(sentence, 'the sensor'),
      complement: spanIn(sentence, 'operating normally'),
    })
    expect(isSuspiciousCommaIngComplement(sentence, c)).toBe(false)
  })

  it('does not fire for an adjective complement (not -ing), even with a comma', () => {
    const sentence = 'We found the result, reliable and accurate.'
    const c = core({
      pattern: 'SVOC',
      object: spanIn(sentence, 'the result'),
      complement: spanIn(sentence, 'reliable and accurate'),
    })
    expect(isSuspiciousCommaIngComplement(sentence, c)).toBe(false)
  })

  it('does not fire for a gerund SUBJECT (pattern is not SVOC at all)', () => {
    const sentence = 'Collecting reliable field data takes considerable time.'
    const c = core({
      pattern: 'SVO',
      subject: spanIn(sentence, 'Collecting reliable field data'),
      verb: spanIn(sentence, 'takes'),
    })
    expect(isSuspiciousCommaIngComplement(sentence, c)).toBe(false)
  })

  it('does not fire for a plain SVO sentence (no complement at all)', () => {
    const sentence = 'The sensor recorded data.'
    const c = core({ pattern: 'SVO', object: spanIn(sentence, 'data') })
    expect(isSuspiciousCommaIngComplement(sentence, c)).toBe(false)
  })

  it('does not fire when object or complement span is ungrounded (-1,-1)', () => {
    const sentence = 'We describe the method, emphasizing its advantages.'
    const c = core({
      pattern: 'SVOC',
      object: { text: 'the method', start: -1, end: -1 },
      complement: spanIn(sentence, 'emphasizing its advantages'),
    })
    expect(isSuspiciousCommaIngComplement(sentence, c)).toBe(false)
  })

  it('does not fire when complement comes before object (malformed/reordered spans)', () => {
    const sentence = 'emphasizing X, we describe the method.'
    const c = core({
      pattern: 'SVOC',
      object: spanIn(sentence, 'the method'),
      complement: spanIn(sentence, 'emphasizing X'),
    })
    expect(isSuspiciousCommaIngComplement(sentence, c)).toBe(false)
  })

  it('does not fire when the complement does not start with an -ing token', () => {
    const sentence = 'We found the sensor, broken beyond repair.'
    const c = core({
      pattern: 'SVOC',
      object: spanIn(sentence, 'the sensor'),
      complement: spanIn(sentence, 'broken beyond repair'),
    })
    expect(isSuspiciousCommaIngComplement(sentence, c)).toBe(false)
  })
})
