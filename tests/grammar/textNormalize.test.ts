import { describe, expect, it } from 'vitest'
import { normalizeSentence } from '../../src/utils/textNormalize'

describe('normalizeSentence', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeSentence('  Hello world.  ')).toBe('Hello world.')
  })

  it('collapses non-breaking spaces to plain spaces', () => {
    const nbsp = String.fromCharCode(0x00a0)
    expect(normalizeSentence(`Hello${nbsp}world.`)).toBe('Hello world.')
  })

  it('removes zero-width spaces', () => {
    const zwsp = String.fromCharCode(0x200b)
    expect(normalizeSentence(`Hello${zwsp}world.`)).toBe('Helloworld.')
  })

  it('normalizes CRLF to LF', () => {
    expect(normalizeSentence('Line one\r\nLine two')).toBe('Line one\nLine two')
  })
})
