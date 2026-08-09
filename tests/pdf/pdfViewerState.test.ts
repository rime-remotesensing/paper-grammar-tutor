import { describe, expect, it } from 'vitest'
import {
  buildSelectionResult,
  isReadingOrderBefore,
  resetForNewDocument,
} from '../../src/features/pdf/domain/pdfViewerState'
import { PDF_DEFAULT_SCALE } from '../../src/config/settings'

describe('resetForNewDocument', () => {
  it('always returns page 1 at the default scale', () => {
    expect(resetForNewDocument()).toEqual({ pageNumber: 1, scale: PDF_DEFAULT_SCALE })
  })
})

describe('buildSelectionResult', () => {
  it('normalizes the raw selection and keeps the page number', () => {
    expect(buildSelectionResult('The proposed\nmethod', 3)).toEqual({
      rawText: 'The proposed\nmethod',
      normalizedText: 'The proposed method',
      pageNumber: 3,
    })
  })

  it('returns null for a whitespace-only selection', () => {
    expect(buildSelectionResult('   \n  ', 1)).toBeNull()
  })

  it('returns null for an empty selection', () => {
    expect(buildSelectionResult('', 1)).toBeNull()
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
