import { describe, expect, it } from 'vitest'
import { parseSimpleCoordinationList } from '../../src/features/grammar/domain/coordinationListParser'

// Prototype 2.3D item 18 — internal phrase list parser tests.

describe('parseSimpleCoordinationList — success cases', () => {
  it('splits "A, B and C" (no Oxford comma)', () => {
    const result = parseSimpleCoordinationList('A, B and C')
    expect(result).toEqual({ prefix: null, items: ['A', 'B', 'C'], conjunction: 'and' })
  })

  it('splits "A, B, and C" (Oxford comma)', () => {
    const result = parseSimpleCoordinationList('A, B, and C')
    expect(result).toEqual({ prefix: null, items: ['A', 'B', 'C'], conjunction: 'and' })
  })

  it('splits "A or B"', () => {
    const result = parseSimpleCoordinationList('A or B')
    expect(result).toEqual({ prefix: null, items: ['A', 'B'], conjunction: 'or' })
  })

  it('hoists a recognized leading preposition out of the first item (the exact green-leaves case)', () => {
    const result = parseSimpleCoordinationList('of California buckwheat, white peppermint and sycamore')
    expect(result).toEqual({
      prefix: 'of',
      items: ['California buckwheat', 'white peppermint', 'sycamore'],
      conjunction: 'and',
    })
  })

  it('keeps a multi-word first item intact when no recognized prefix word is present', () => {
    const result = parseSimpleCoordinationList('California buckwheat, white peppermint and sycamore')
    expect(result?.prefix).toBeNull()
    expect(result?.items).toEqual(['California buckwheat', 'white peppermint', 'sycamore'])
  })
})

describe('parseSimpleCoordinationList — ambiguous / no-split cases (precision over recall)', () => {
  it('returns null when there are TWO conjunctions (ambiguous)', () => {
    expect(parseSimpleCoordinationList('A and B and C')).toBeNull()
  })

  it('returns null when there is no conjunction at all', () => {
    expect(parseSimpleCoordinationList('A, B, C')).toBeNull()
  })

  it('returns null for plain unrelated text', () => {
    expect(parseSimpleCoordinationList('within 1 hour of collection')).toBeNull()
  })

  it('returns null when the head (before the conjunction) is empty', () => {
    expect(parseSimpleCoordinationList('and C')).toBeNull()
  })

  it('returns null when the tail (after the conjunction) is empty', () => {
    expect(parseSimpleCoordinationList('A, B and')).toBeNull()
  })
})

describe('parseSimpleCoordinationList — raw text integrity (item 11)', () => {
  it('every returned item and the prefix are literal substrings of the original text', () => {
    const text = 'of California buckwheat, white peppermint and sycamore'
    const result = parseSimpleCoordinationList(text)
    expect(result).not.toBeNull()
    if (!result) return
    if (result.prefix) expect(text).toContain(result.prefix)
    for (const item of result.items) expect(text).toContain(item)
    expect(text).toContain(result.conjunction)
  })
})
