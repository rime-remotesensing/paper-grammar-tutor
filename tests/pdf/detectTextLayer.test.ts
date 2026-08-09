import { describe, expect, it } from 'vitest'
import { hasExtractableText } from '../../src/features/pdf/domain/detectTextLayer'

describe('hasExtractableText', () => {
  it('treats an all-zero sample as scanned/no text layer', () => {
    expect(hasExtractableText([0, 0, 0])).toBe(false)
  })

  it('treats a tiny total (e.g. a stray page number) as scanned/no text layer', () => {
    expect(hasExtractableText([2, 0, 1])).toBe(false)
  })

  it('treats a normal amount of extracted text as a real text layer', () => {
    expect(hasExtractableText([1200, 980, 1500])).toBe(true)
  })

  it('handles a single sampled page', () => {
    expect(hasExtractableText([500])).toBe(true)
    expect(hasExtractableText([0])).toBe(false)
  })

  it('handles an empty sample', () => {
    expect(hasExtractableText([])).toBe(false)
  })
})
