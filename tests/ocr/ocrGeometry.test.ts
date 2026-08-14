import { describe, expect, it } from 'vitest'
import { joinOcrWords, matchWordsToRects, toPixelRect } from '../../src/features/ocr/domain/ocrGeometry'
import type { OcrWord, PixelRect } from '../../src/features/ocr/domain/ocrTypes'

function word(text: string, x0: number, y0: number, x1: number, y1: number, confidence = 90): OcrWord {
  return { text, confidence, bbox: { x0, y0, x1, y1 } }
}

describe('toPixelRect', () => {
  it('scales a normalized (0..1) rect to the OCR canvas pixel size', () => {
    expect(toPixelRect({ x0: 0.25, y0: 0.2, x1: 0.5, y1: 0.4 }, 2000, 1000)).toEqual({
      left: 500,
      top: 200,
      right: 1000,
      bottom: 400,
    })
  })

  it('handles a full-page rect', () => {
    expect(toPixelRect({ x0: 0, y0: 0, x1: 1, y1: 1 }, 1200, 1600)).toEqual({
      left: 0,
      top: 0,
      right: 1200,
      bottom: 1600,
    })
  })
})

describe('matchWordsToRects', () => {
  it('matches a word whose center falls inside the rect', () => {
    const rect: PixelRect = { left: 100, top: 100, right: 300, bottom: 130 }
    const w = word('signal', 150, 105, 200, 125)
    expect(matchWordsToRects([rect], [w], 3)).toEqual([w])
  })

  it('excludes a word whose center falls outside the rect and its tolerance', () => {
    const rect: PixelRect = { left: 100, top: 100, right: 300, bottom: 130 }
    const w = word('elsewhere', 500, 105, 550, 125)
    expect(matchWordsToRects([rect], [w], 3)).toEqual([])
  })

  it('includes a boundary word within the tolerance margin', () => {
    const rect: PixelRect = { left: 100, top: 100, right: 300, bottom: 130 }
    // Center at x=301.5 (2px past `right`), well within a 3px tolerance.
    const w = word('edge', 300, 105, 303, 125)
    expect(matchWordsToRects([rect], [w], 3)).toEqual([w])
  })

  it('excludes a word just past the tolerance margin', () => {
    const rect: PixelRect = { left: 100, top: 100, right: 300, bottom: 130 }
    // Center at x=305 (5px past `right`), outside a 3px tolerance.
    const w = word('toofar', 300, 105, 310, 125)
    expect(matchWordsToRects([rect], [w], 3)).toEqual([])
  })

  it('returns an empty array when no words match any rect', () => {
    const rect: PixelRect = { left: 100, top: 100, right: 300, bottom: 130 }
    expect(matchWordsToRects([rect], [], 3)).toEqual([])
  })

  it('orders matched words left-to-right within a single rect', () => {
    const rect: PixelRect = { left: 100, top: 100, right: 400, bottom: 130 }
    const w2 = word('second', 250, 105, 300, 125)
    const w1 = word('first', 110, 105, 160, 125)
    // Passed in reverse order on purpose — output order must be geometric, not input order.
    expect(matchWordsToRects([rect], [w2, w1], 3)).toEqual([w1, w2])
  })

  it('processes multiple line rects top-to-bottom, left-to-right within each', () => {
    const line1: PixelRect = { left: 100, top: 100, right: 400, bottom: 130 }
    const line2: PixelRect = { left: 100, top: 140, right: 400, bottom: 170 }
    const wordLine2 = word('from', 150, 145, 200, 165)
    const wordLine1b = word('signal', 300, 105, 350, 125)
    const wordLine1a = word('The', 110, 105, 140, 125)
    // Rects and words both passed out of order; output must still read top-to-bottom.
    expect(matchWordsToRects([line2, line1], [wordLine2, wordLine1b, wordLine1a], 3)).toEqual([
      wordLine1a,
      wordLine1b,
      wordLine2,
    ])
  })

  it('tolerates ~1-2px same-line rect jitter without misordering lines', () => {
    // Simulates pdf.js emitting several fragment rects for one visual line (one per text
    // span plus letter-spacing filler), whose `top` differs by a stray sub-pixel amount.
    const fragmentA: PixelRect = { left: 100, top: 100.9, right: 200, bottom: 130 }
    const fragmentB: PixelRect = { left: 200, top: 99.8, right: 400, bottom: 130 }
    const nextLine: PixelRect = { left: 100, top: 140, right: 400, bottom: 170 }
    const wA = word('Figure', 110, 105, 190, 125)
    const wB = word('One', 210, 105, 390, 125)
    const wNext = word('caption', 150, 145, 250, 165)
    expect(matchWordsToRects([nextLine, fragmentB, fragmentA], [wNext, wB, wA], 3)).toEqual([wA, wB, wNext])
  })

  it('deduplicates a word matched by more than one overlapping rect', () => {
    const rectA: PixelRect = { left: 100, top: 100, right: 250, bottom: 130 }
    const rectB: PixelRect = { left: 200, top: 100, right: 400, bottom: 130 }
    const w = word('overlap', 220, 105, 260, 125) // center falls inside both rects
    expect(matchWordsToRects([rectA, rectB], [w], 3)).toEqual([w])
  })

  it('excludes words outside every selection rect (no surrounding-text leakage)', () => {
    const rect: PixelRect = { left: 200, top: 100, right: 400, bottom: 130 }
    const before = word('unselected-before', 50, 105, 100, 125)
    const inside = word('selected', 250, 105, 300, 125)
    const after = word('unselected-after', 420, 105, 470, 125)
    expect(matchWordsToRects([rect], [before, inside, after], 3)).toEqual([inside])
  })
})

describe('joinOcrWords', () => {
  it('joins words with single spaces, unmodified', () => {
    const words = [word('The', 0, 0, 1, 1), word('signal', 0, 0, 1, 1), word('is', 0, 0, 1, 1)]
    expect(joinOcrWords(words)).toBe('The signal is')
  })

  it('returns an empty string for no matched words', () => {
    expect(joinOcrWords([])).toBe('')
  })
})
