import { describe, expect, it } from 'vitest'
import { alignWordsToLine, extractPaddleCandidate } from '../../src/features/ocr/domain/paddleAdapter'
import type { PaddleLine, PaddleWord } from '../../src/features/ocr/schemas/paddleOcr.schema'
import type { PixelRect } from '../../src/features/ocr/domain/ocrTypes'

function paddleWord(text: string, x0: number, y0: number, x1: number, y1: number): PaddleWord {
  return { text, confidence: 0.9, bbox: [x0, y0, x1, y1] }
}

function paddleLine(text: string, words: PaddleWord[], y0: number, y1: number): PaddleLine {
  const x0 = Math.min(...words.map((w) => w.bbox[0]))
  const x1 = Math.max(...words.map((w) => w.bbox[2]))
  return { text, confidence: 0.9, bbox: [x0, y0, x1, y1], words }
}

function rect(left: number, top: number, right: number, bottom: number): PixelRect {
  return { left, top, right, bottom }
}

describe('alignWordsToLine', () => {
  it('aligns word tokens that reconstruct the line text exactly, including a whitespace token', () => {
    const words = [paddleWord('The', 0, 0, 30, 20), paddleWord(' ', 30, 0, 35, 20), paddleWord('signal', 35, 0, 80, 20)]
    const result = alignWordsToLine('The signal', words)
    expect(result.alignmentFailed).toBe(false)
    expect(result.ranges).toEqual([
      { start: 0, end: 3, bbox: [0, 0, 30, 20] },
      { start: 3, end: 4, bbox: [30, 0, 35, 20] },
      { start: 4, end: 10, bbox: [35, 0, 80, 20] },
    ])
  })

  it('reports alignmentFailed the moment a token does not match at the cursor', () => {
    const words = [paddleWord('The', 0, 0, 30, 20), paddleWord('XYZ', 30, 0, 35, 20)]
    const result = alignWordsToLine('The signal', words)
    expect(result.alignmentFailed).toBe(true)
  })
})

describe('extractPaddleCandidate', () => {
  it('extracts the full line text when a rect covers the whole line', () => {
    const words = [paddleWord('The', 0, 0, 30, 20), paddleWord(' ', 30, 0, 35, 20), paddleWord('signal', 35, 0, 80, 20)]
    const line = paddleLine('The signal', words, 0, 20)
    const result = extractPaddleCandidate([line], [rect(0, 0, 80, 20)], 3)
    expect(result).toEqual({ text: 'The signal', failed: false })
  })

  it('reconstructs a line whose punctuation is its own token, unmodified', () => {
    const words = [
      paddleWord('signal', 0, 0, 50, 20),
      paddleWord(',', 50, 0, 55, 20),
      paddleWord(' ', 55, 0, 60, 20),
      paddleWord('noise', 60, 0, 110, 20),
    ]
    const line = paddleLine('signal, noise', words, 0, 20)
    const result = extractPaddleCandidate([line], [rect(0, 0, 110, 20)], 3)
    expect(result).toEqual({ text: 'signal, noise', failed: false })
  })

  it('preserves a literal decimal middle-dot 0·05 (never rebuilt via words.join)', () => {
    const words = [paddleWord('0', 0, 0, 10, 20), paddleWord('·', 10, 0, 20, 20), paddleWord('05', 20, 0, 40, 20)]
    const line = paddleLine('0·05', words, 0, 20)
    const result = extractPaddleCandidate([line], [rect(0, 0, 40, 20)], 3)
    expect(result.text).toBe('0·05')
  })

  it('preserves a literal decimal middle-dot 0·8', () => {
    const words = [paddleWord('0', 0, 0, 10, 20), paddleWord('·', 10, 0, 20, 20), paddleWord('8', 20, 0, 30, 20)]
    const line = paddleLine('0·8', words, 0, 20)
    const result = extractPaddleCandidate([line], [rect(0, 0, 30, 20)], 3)
    expect(result.text).toBe('0·8')
  })

  it('preserves a literal decimal middle-dot 2·5', () => {
    const words = [paddleWord('2', 0, 0, 10, 20), paddleWord('·', 10, 0, 20, 20), paddleWord('5', 20, 0, 30, 20)]
    const line = paddleLine('2·5', words, 0, 20)
    const result = extractPaddleCandidate([line], [rect(0, 0, 30, 20)], 3)
    expect(result.text).toBe('2·5')
  })

  it('preserves the micro sign (µ, U+00B5) literally, with no normalization to Greek mu', () => {
    const words = [paddleWord('0.86', 0, 0, 40, 20), paddleWord('µm', 40, 0, 60, 20)]
    const line = paddleLine('0.86µm', words, 0, 20)
    const result = extractPaddleCandidate([line], [rect(0, 0, 60, 20)], 3)
    expect(result.text).toBe('0.86µm')
    expect(result.text).toContain('µ')
  })

  it('preserves the Greek small letter mu (μ, U+03BC) literally, with no normalization to the micro sign', () => {
    const words = [paddleWord('0.86', 0, 0, 40, 20), paddleWord('μm', 40, 0, 60, 20)]
    const line = paddleLine('0.86μm', words, 0, 20)
    const result = extractPaddleCandidate([line], [rect(0, 0, 60, 20)], 3)
    expect(result.text).toBe('0.86μm')
    expect(result.text).toContain('μ')
  })

  it('joins two selected lines top-to-bottom with a single space, each line unmodified internally', () => {
    const line1 = paddleLine('first', [paddleWord('first', 0, 0, 40, 20)], 0, 20)
    const line2 = paddleLine('second', [paddleWord('second', 0, 30, 50, 50)], 30, 50)
    const result = extractPaddleCandidate([line1, line2], [rect(0, 0, 40, 20), rect(0, 30, 50, 50)], 3)
    expect(result).toEqual({ text: 'first second', failed: false })
  })

  it('orders lines top-to-bottom regardless of input array order', () => {
    const line1 = paddleLine('first', [paddleWord('first', 0, 0, 40, 20)], 0, 20)
    const line2 = paddleLine('second', [paddleWord('second', 0, 30, 50, 50)], 30, 50)
    const result = extractPaddleCandidate([line2, line1], [rect(0, 30, 50, 50), rect(0, 0, 40, 20)], 3)
    expect(result).toEqual({ text: 'first second', failed: false })
  })

  it('does not duplicate text when multiple overlapping rects map to the same line (pdf.js multi-rect quirk)', () => {
    const words = [paddleWord('materials', 0, 0, 80, 20), paddleWord(' ', 80, 0, 85, 20), paddleWord('were', 85, 0, 120, 20)]
    const line = paddleLine('materials were', words, 0, 20)
    const rectA = rect(0, 0, 85, 20)
    const rectB = rect(70, 0, 120, 20) // overlaps rectA over the same visual line
    const result = extractPaddleCandidate([line], [rectA, rectB], 3)
    expect(result).toEqual({ text: 'materials were', failed: false })
  })

  it('treats the whole candidate as failed when any selected line fails alignment', () => {
    const goodLine = paddleLine('ok', [paddleWord('ok', 0, 0, 20, 20)], 0, 20)
    const badLine = paddleLine('bad', [paddleWord('XYZ', 0, 30, 30, 50)], 30, 50)
    const result = extractPaddleCandidate([goodLine, badLine], [rect(0, 0, 20, 20), rect(0, 30, 30, 50)], 3)
    expect(result).toEqual({ text: null, failed: true })
  })

  it('reports failure when no selection rect overlaps any line', () => {
    const line = paddleLine('text', [paddleWord('text', 0, 0, 40, 20)], 0, 20)
    const result = extractPaddleCandidate([line], [rect(500, 500, 540, 520)], 3)
    expect(result).toEqual({ text: null, failed: true })
  })
})
