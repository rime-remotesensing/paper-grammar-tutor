import { describe, expect, it } from 'vitest'
import { resolveSpan } from '../../src/utils/spanMatch'

const SENTENCE = 'The results obtained in the previous experiment indicate that the method is effective.'

describe('resolveSpan', () => {
  it('accepts correct offsets as-is', () => {
    const result = resolveSpan(SENTENCE, { text: 'The results', start: 0, end: 11 })
    expect(result).toEqual({ text: 'The results', start: 0, end: 11, resolved: true, corrected: false })
  })

  it('corrects wrong offsets when the text is an exact substring', () => {
    const result = resolveSpan(SENTENCE, { text: 'indicate', start: 0, end: 0 })
    expect(result.resolved).toBe(true)
    expect(result.corrected).toBe(true)
    expect(result.start).toBe(SENTENCE.indexOf('indicate'))
    expect(result.end).toBe(SENTENCE.indexOf('indicate') + 'indicate'.length)
  })

  it('falls back to whitespace-insensitive matching', () => {
    const result = resolveSpan(SENTENCE, {
      text: 'The results  obtained\nin the previous experiment',
      start: 0,
      end: 0,
    })
    expect(result.resolved).toBe(true)
    expect(result.text).toBe('The results obtained in the previous experiment')
  })

  it('flags spans that cannot be located at all', () => {
    const result = resolveSpan(SENTENCE, { text: 'a phrase not in the sentence', start: 0, end: 0 })
    expect(result.resolved).toBe(false)
    expect(result.start).toBe(-1)
    expect(result.end).toBe(-1)
  })
})
