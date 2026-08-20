import { describe, expect, it } from 'vitest'
import { isSameVisualLine, joinTextSegments, type TextSegment, type VerticalExtent } from '../../src/features/pdf/domain/sameLineTextReconstruction.ts'

/**
 * Prototype 2.6G2.5A -- mirrors the backend's own calibration
 * (services/pymupdf_layout/tests/test_intraline_word_boundary.py): at fontSize 12, a gap
 * below ~1.2 (10% of 12) never gets a space, a gap of ~1.5+ (12.5%) does.
 */
function seg(text: string, left: number, right: number, fontSize = 12): TextSegment {
  return { text, left, right, fontSize }
}

describe('Prototype 2.6G2.5A -- joinTextSegments', () => {
  it('(A) separate word segments with no literal spaces but a visible x-gap get reconstructed with one space', () => {
    const segments = [seg('training', 0, 40), seg('and', 41.5, 55), seg('testing', 56.5, 90)]
    expect(joinTextSegments(segments)).toBe('training and testing')
  })

  it('(B) adjacent style-change segments inside one word with near-zero gap stay fused', () => {
    const segments = [seg('trai', 0, 20), seg('ning', 20, 40)]
    expect(joinTextSegments(segments)).toBe('training')
  })

  it('(C) explicit trailing space already present is never doubled', () => {
    const segments = [seg('training ', 0, 44), seg('and testing', 44, 90)]
    expect(joinTextSegments(segments)).toBe('training and testing')
    expect(joinTextSegments(segments)).not.toContain('  ')
  })

  it('(D) punctuation followed by a normal word gap gets reconstructed', () => {
    const segments = [seg('steps:', 0, 30), seg('next', 31.5, 50)]
    expect(joinTextSegments(segments)).toBe('steps: next')
  })

  it('(E) multiple consecutive word segments all get exactly one space each', () => {
    const segments = [seg('the', 0, 15), seg('training', 16.5, 55), seg('and', 56.5, 70), seg('testing', 71.5, 105), seg('datasets', 106.5, 145)]
    expect(joinTextSegments(segments)).toBe('the training and testing datasets')
  })

  it('touching glyphs (zero gap) never get a spurious space', () => {
    const segments = [seg('train', 0, 20), seg('ing', 20, 35)]
    expect(joinTextSegments(segments)).toBe('training')
  })

  it('a gap below the font-size-normalized threshold is not treated as a word boundary', () => {
    const segments = [seg('train', 0, 20), seg('ing', 20.5, 35)] // 0.5px gap at fontSize 12 (~4%)
    expect(joinTextSegments(segments)).toBe('training')
  })

  it('threshold scales with font size, not a fixed pixel number', () => {
    // A 3px gap is a genuine word boundary at a small font size...
    const small = [seg('a', 0, 10, 8), seg('b', 13, 20, 8)] // gap=3, 37.5% of 8
    expect(joinTextSegments(small)).toBe('a b')
    // ...but the SAME 3px gap must not be treated as significant at a much larger font size
    // where intra-word kerning gaps can be proportionally similar in absolute pixels.
    const large = [seg('a', 0, 10, 60), seg('b', 13, 20, 60)] // gap=3, 5% of 60
    expect(joinTextSegments(large)).toBe('ab')
  })

  it('preserves existing whitespace and never inserts a second space at a real gap', () => {
    const segments = [seg('hello ', 0, 30), seg('world', 40, 70)]
    expect(joinTextSegments(segments)).toBe('hello world')
  })

  it('hyphenation-style adjacency (touching, no gap) stays joined without a space', () => {
    const segments = [seg('multi-', 0, 30), seg('temporal', 30, 70)]
    expect(joinTextSegments(segments)).toBe('multi-temporal')
  })

  it('empty segments are skipped without producing stray spaces', () => {
    const segments = [seg('training', 0, 40), seg('', 40, 40), seg('and', 41.5, 55)]
    expect(joinTextSegments(segments)).toBe('training and')
  })

  it('a single segment is returned unchanged', () => {
    expect(joinTextSegments([seg('training', 0, 40)])).toBe('training')
  })

  it('an empty segment list returns an empty string', () => {
    expect(joinTextSegments([])).toBe('')
  })
})

/**
 * Prototype 2.6G2.8D1 -- geometric same-visual-line test. Added because a real live trace
 * (2.6G2.8C) proved the DOM-structural `<br>` check `extractWithinLine` (PdfViewer.tsx) used
 * alone is not reliable: an italic variable ("k") with no DOM text-node representation at all
 * left pdf.js without a `<br>` at that line's true end either, so a forward walk silently
 * continued onto the next visual line. This function is the general, glyph-independent
 * geometric line-boundary check added alongside (never replacing) the `<br>` check.
 */
function vext(top: number, bottom: number, fontSize = 12): VerticalExtent {
  return { top, bottom, fontSize }
}

describe('Prototype 2.6G2.8D1 -- isSameVisualLine', () => {
  it('two segments with identical vertical extent are the same line', () => {
    expect(isSameVisualLine(vext(100, 116), vext(100, 116))).toBe(true)
  })

  it('ordinary sub-pixel line-height jitter within one line stays the same line', () => {
    expect(isSameVisualLine(vext(100, 116), vext(101, 117))).toBe(true)
  })

  it('a superscript/subscript baseline shift within the same line is still the same line', () => {
    // A ~30% font-size vertical shift (typical superscript offset), well under the tolerance.
    expect(isSameVisualLine(vext(100, 116), vext(96, 112))).toBe(true)
  })

  it('a genuinely adjacent visual line (about one line-height apart) is a different line', () => {
    // fontSize 12, line box 16 tall -- the next line's box starts about a full line-height
    // below, e.g. centered around 118 vs this line's center at 108.
    expect(isSameVisualLine(vext(100, 116, 12), vext(118, 134, 12))).toBe(false)
  })

  it('scales with font size, not a fixed pixel number -- the same absolute gap flips at a different size', () => {
    // A 10px center-to-center gap is within tolerance at fontSize 30 (0.5*30=15)...
    expect(isSameVisualLine(vext(100, 130, 30), vext(110, 140, 30))).toBe(true)
    // ...but the SAME 10px gap is a different line at a much smaller font size (0.5*8=4).
    expect(isSameVisualLine(vext(100, 108, 8), vext(110, 118, 8))).toBe(false)
  })

  it('is symmetric -- order of reference/candidate never changes the result', () => {
    const a = vext(100, 116)
    const b = vext(140, 156)
    expect(isSameVisualLine(a, b)).toBe(isSameVisualLine(b, a))
  })

  it('regression: the exact traced shape -- a missing-glyph gap must not bridge two real lines', () => {
    // Modeling the real 2.6G2.8C trace geometry class: line 0 ("In the case of lower") and
    // line 1 ("values, the denominator is increased and") are on two different visual lines
    // despite the invisible "k" glyph between them having no DOM node of its own to stop at.
    const line0 = vext(300, 316, 12)
    const line1 = vext(318, 334, 12) // next line, ~one line-height below
    expect(isSameVisualLine(line0, line1)).toBe(false)
  })
})
