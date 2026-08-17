import { describe, expect, it } from 'vitest'
import {
  buildSelectionResult,
  computeNormalizedSelectionRects,
  isReadingOrderBefore,
  pageNumbersInRange,
  resetForNewDocument,
  sliceBetweenCaretOffsets,
} from '../../src/features/pdf/domain/pdfViewerState'
import { PDF_DEFAULT_SCALE } from '../../src/config/settings'

describe('resetForNewDocument', () => {
  it('always returns page 1 at the default scale', () => {
    expect(resetForNewDocument()).toEqual({ pageNumber: 1, scale: PDF_DEFAULT_SCALE })
  })
})

describe('pageNumbersInRange — Prototype 2.4B item 22/74', () => {
  it('returns a single-element array for a same-page drag', () => {
    expect(pageNumbersInRange(3, 3)).toEqual([3])
  })

  it('returns the ascending inclusive range for a forward drag', () => {
    expect(pageNumbersInRange(2, 4)).toEqual([2, 3, 4])
  })

  it('normalizes a backward drag to the same ascending range', () => {
    expect(pageNumbersInRange(4, 2)).toEqual([2, 3, 4])
  })

  it('handles adjacent pages', () => {
    expect(pageNumbersInRange(5, 6)).toEqual([5, 6])
    expect(pageNumbersInRange(6, 5)).toEqual([5, 6])
  })
})

describe('buildSelectionResult', () => {
  it('normalizes the raw selection and keeps the page number', () => {
    expect(buildSelectionResult('The proposed\nmethod', 3)).toEqual({
      rawText: 'The proposed\nmethod',
      normalizedText: 'The proposed method',
      pageNumber: 3,
      ocrRects: [],
      scientificTokens: [],
    })
  })

  it('carries through the provided ocrRects unchanged', () => {
    const rects = [{ x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.4 }]
    expect(buildSelectionResult('Text', 1, rects)?.ocrRects).toEqual(rects)
  })

  it('carries through the provided scientificTokens unchanged', () => {
    const tokens = [{ text: '0·8', rects: [{ x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.4 }] }]
    expect(buildSelectionResult('Text', 1, [], tokens)?.scientificTokens).toEqual(tokens)
  })

  it('returns null for a whitespace-only selection', () => {
    expect(buildSelectionResult('   \n  ', 1)).toBeNull()
  })

  it('returns null for an empty selection', () => {
    expect(buildSelectionResult('', 1)).toBeNull()
  })
})

describe('computeNormalizedSelectionRects', () => {
  const canvasRect = { left: 100, top: 200, width: 800, height: 1000 }

  it('normalizes a single rect to a 0..1 fraction of the canvas', () => {
    const rects = [{ left: 300, top: 400, right: 500, bottom: 450, width: 200, height: 50 }]
    expect(computeNormalizedSelectionRects(rects, canvasRect)).toEqual([
      { x0: 0.25, y0: 0.2, x1: 0.5, y1: 0.25 },
    ])
  })

  it('filters out zero-width ghost rects', () => {
    const rects = [
      { left: 100, top: 200, right: 100, bottom: 221, width: 0, height: 21 },
      { left: 300, top: 400, right: 500, bottom: 450, width: 200, height: 50 },
    ]
    expect(computeNormalizedSelectionRects(rects, canvasRect)).toHaveLength(1)
  })

  it('filters out zero-height ghost rects', () => {
    const rects = [
      { left: 300, top: 400, right: 500, bottom: 400, width: 200, height: 0 },
      { left: 300, top: 400, right: 500, bottom: 450, width: 200, height: 50 },
    ]
    expect(computeNormalizedSelectionRects(rects, canvasRect)).toHaveLength(1)
  })

  it('keeps multiple real rects independent (never unions them)', () => {
    const rects = [
      { left: 300, top: 400, right: 500, bottom: 450, width: 200, height: 50 },
      { left: 150, top: 460, right: 350, bottom: 510, width: 200, height: 50 },
    ]
    const result = computeNormalizedSelectionRects(rects, canvasRect)
    expect(result).toHaveLength(2)
    expect(result[0].x0).toBeCloseTo(0.25)
    expect(result[1].x0).toBeCloseTo(0.0625)
  })

  it('returns an empty array for a degenerate (zero-size) canvas rect', () => {
    const rects = [{ left: 300, top: 400, right: 500, bottom: 450, width: 200, height: 50 }]
    expect(computeNormalizedSelectionRects(rects, { left: 0, top: 0, width: 0, height: 0 })).toEqual([])
  })
})

describe('isReadingOrderBefore', () => {
  it('orders two points on clearly different lines by Y alone', () => {
    expect(isReadingOrderBefore({ x: 700, y: 400 }, { x: 100, y: 450 })).toBe(true)
    expect(isReadingOrderBefore({ x: 100, y: 450 }, { x: 700, y: 400 })).toBe(false)
  })

  it('falls back to X when two points are within the same-line Y tolerance', () => {
    // 2px apart vertically — well within the default 4px tolerance for one visual line.
    expect(isReadingOrderBefore({ x: 200, y: 500 }, { x: 600, y: 502 })).toBe(true)
    expect(isReadingOrderBefore({ x: 600, y: 502 }, { x: 200, y: 500 })).toBe(false)
  })

  it('treats an identical point as before-or-equal itself', () => {
    expect(isReadingOrderBefore({ x: 300, y: 500 }, { x: 300, y: 500 })).toBe(true)
  })

  it('respects a custom line tolerance', () => {
    // 5px apart — outside a tight 2px tolerance, so this must fall back to Y comparison
    // even though the right-hand point has a smaller X (as it would for a line-end point
    // being compared against the start of a lower, wrapped line).
    expect(isReadingOrderBefore({ x: 700, y: 500 }, { x: 120, y: 505 }, 2)).toBe(true)
  })
})

describe('sliceBetweenCaretOffsets — Prototype 2.6A half-open endpoints', () => {
  const line = 'in LSM (Lima et al. 2022). In the present study'
  const citationEnd = line.indexOf(' In the present study')

  it('stops before the next sentence capital', () => {
    expect(sliceBetweenCaretOffsets(line, 0, citationEnd)).toBe('in LSM (Lima et al. 2022).')
  })

  it('can end at the entire line', () => {
    expect(sliceBetweenCaretOffsets(line, 0, line.length)).toBe(line)
  })

  it('includes the next sentence when its endpoint actually reaches it', () => {
    const intentionalEnd = line.indexOf(' study')
    expect(sliceBetweenCaretOffsets(line, 0, intentionalEnd)).toBe('in LSM (Lima et al. 2022). In the present')
  })

  it('preserves intentional multiple-sentence selections', () => {
    expect(sliceBetweenCaretOffsets('First. Second. Third.', 0, 14)).toBe('First. Second.')
  })

  it('preserves a legitimate isolated capital ending', () => {
    expect(sliceBetweenCaretOffsets('parameter I', 0, 11)).toBe('parameter I')
  })

  it('uses offsets rather than searching repeated text', () => {
    expect(sliceBetweenCaretOffsets('In result. In result.', 11, 20)).toBe('In result')
  })

  it('uses the same half-open span for forward and backward drags', () => {
    expect(sliceBetweenCaretOffsets(line, 0, citationEnd)).toBe(sliceBetweenCaretOffsets(line, citationEnd, 0))
  })

  it('clamps offsets without including an extra character', () => {
    expect(sliceBetweenCaretOffsets('case B', -5, 99)).toBe('case B')
  })
})
