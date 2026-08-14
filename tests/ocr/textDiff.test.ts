import { describe, expect, it } from 'vitest'
import { diffForDisplay } from '../../src/features/ocr/domain/textDiff'

function joined(segments: readonly { text: string }[]): string {
  return segments.map((s) => s.text).join('')
}

describe('diffForDisplay', () => {
  it('marks nothing as changed for identical strings', () => {
    const { aSegments, bSegments } = diffForDisplay('hello world', 'hello world')
    expect(aSegments.every((s) => !s.changed)).toBe(true)
    expect(bSegments.every((s) => !s.changed)).toBe(true)
    expect(joined(aSegments)).toBe('hello world')
    expect(joined(bSegments)).toBe('hello world')
  })

  it('marks a µm/m substitution: "m region" is a pure LCS match, so only the inserted µ is changed', () => {
    // "m region" is a substring of "µm region", so a correct LCS diff finds it entirely
    // in common — only the extra "µ" that `b` has and `a` doesn't is a real difference.
    const { aSegments, bSegments } = diffForDisplay('0·8 m region', '0·8 µm region')
    expect(joined(aSegments)).toBe('0·8 m region')
    expect(joined(bSegments)).toBe('0·8 µm region')
    expect(aSegments.every((s) => !s.changed)).toBe(true)
    expect(bSegments.some((s) => s.changed && s.text === 'µ')).toBe(true)
  })

  it('marks a lost decimal separator ("1·0" -> "10") as a change, even though "1" and "0" both still appear in order', () => {
    // "1" and "0" are a common subsequence of both "1·0" and "10", so a pure LCS diff
    // correctly attributes the difference entirely to the deleted "·" -- this is still
    // enough for the UI to flag the line as different, which is what matters here.
    const { aSegments, bSegments } = diffForDisplay('beyond 1·0 µm region', 'beyond 10 µm region')
    expect(joined(aSegments)).toBe('beyond 1·0 µm region')
    expect(joined(bSegments)).toBe('beyond 10 µm region')
    expect(aSegments.some((s) => s.changed && s.text === '·')).toBe(true)
  })

  it('treats µ (U+00B5) and μ (U+03BC) as different raw characters (no normalization)', () => {
    const { aSegments, bSegments } = diffForDisplay('0.8 µm', '0.8 μm')
    // Everything up to the unit symbol matches; the symbol itself differs.
    const aChanged = aSegments.filter((s) => s.changed).map((s) => s.text).join('')
    const bChanged = bSegments.filter((s) => s.changed).map((s) => s.text).join('')
    expect(aChanged).toContain('µ')
    expect(bChanged).toContain('μ')
    expect(aChanged).not.toContain('μ')
    expect(bChanged).not.toContain('µ')
  })

  it('marks a punctuation-only difference as changed', () => {
    const { aSegments, bSegments } = diffForDisplay('case, 77%', 'case. 77%')
    expect(aSegments.some((s) => s.changed && s.text.includes(','))).toBe(true)
    expect(bSegments.some((s) => s.changed && s.text.includes('.'))).toBe(true)
  })

  it('never alters the reconstructable text on either side', () => {
    const a = 'The signal is recorded on 1 nm centres in the 0·4 to 0·8 µm region'
    const b = 'The signal is recorded on 1 nm centres in the 0.4 to 0.8 m region'
    const { aSegments, bSegments } = diffForDisplay(a, b)
    expect(joined(aSegments)).toBe(a)
    expect(joined(bSegments)).toBe(b)
  })

  it('marks entirely different strings as fully changed where they share no characters', () => {
    const { aSegments, bSegments } = diffForDisplay('xyz', 'abc')
    expect(aSegments.every((s) => s.changed)).toBe(true)
    expect(bSegments.every((s) => s.changed)).toBe(true)
  })
})
