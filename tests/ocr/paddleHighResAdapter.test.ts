import { describe, expect, it } from 'vitest'
import { extractHighResCandidate } from '../../src/features/ocr/domain/paddleHighResAdapter'
import type { SelectedLineRange } from '../../src/features/ocr/domain/paddleAdapter'
import type { PaddleLine } from '../../src/features/ocr/schemas/paddleOcr.schema'
import type { PaddleLineRecognitionResult } from '../../src/features/ocr/schemas/paddleLinesResult.schema'

function paddleLine(text: string, y0 = 0): PaddleLine {
  return { text, confidence: 0.9, bbox: [0, y0, 100, y0 + 20], words: [] }
}

function range(line: PaddleLine, start: number, end: number): SelectedLineRange {
  return { line, start, end }
}

function recog(text: string, confidence = 0.95): PaddleLineRecognitionResult {
  return { text, confidence, detectionCount: 1 }
}

function recogFailed(detectionCount: number): PaddleLineRecognitionResult {
  return { text: null, confidence: null, detectionCount }
}

describe('extractHighResCandidate', () => {
  it('returns the same text when baseline and second-pass agree exactly (full-line selection)', () => {
    const line = paddleLine('The signal is recorded on 1 nm centres.')
    const result = extractHighResCandidate([range(line, 0, line.text.length)], [recog(line.text)])
    expect(result).toEqual({ text: 'The signal is recorded on 1 nm centres.', failed: false })
  })

  it('recovers a dropped µ (full-line selection)', () => {
    const baselineText = 'from 0·8 to 2·5 m.'
    const secondPassText = 'from 0.8 to 2.5 µm.'
    const line = paddleLine(baselineText)
    const result = extractHighResCandidate([range(line, 0, baselineText.length)], [recog(secondPassText)])
    expect(result).toEqual({ text: 'from 0.8 to 2.5 µm.', failed: false })
  })

  it('reflects the second-pass text verbatim, including a middle-dot -> period difference unrelated to the selected span', () => {
    // The candidate is never reconciled against the baseline's punctuation — it is the
    // raw recognition-only result, shown as its own independent candidate (Prototype 1.5D
    // item 18/21 — no automatic consensus/normalization here).
    const baselineText = '0·8 to 2·5 range'
    const secondPassText = '0.8 to 2.5 range'
    const line = paddleLine(baselineText)
    const result = extractHighResCandidate([range(line, 0, baselineText.length)], [recog(secondPassText)])
    expect(result.text).toBe('0.8 to 2.5 range')
  })

  it('joins a multi-line selection with a single space, each line resolved independently', () => {
    const line1 = paddleLine('first line text', 0)
    const line2 = paddleLine('second line text', 30)
    const result = extractHighResCandidate(
      [range(line1, 0, line1.text.length), range(line2, 0, line2.text.length)],
      [recog('first line text'), recog('second line text')],
    )
    expect(result).toEqual({ text: 'first line text second line text', failed: false })
  })

  it('extracts only the corresponding substring for a partial-line (mid-line) selection', () => {
    const baselineText = 'before SELECTED after'
    const line = paddleLine(baselineText)
    const start = baselineText.indexOf('SELECTED')
    const end = start + 'SELECTED'.length
    // Second-pass text is identical here, so the substring should be exactly "SELECTED".
    const result = extractHighResCandidate([range(line, start, end)], [recog(baselineText)])
    expect(result).toEqual({ text: 'SELECTED', failed: false })
  })

  it('extracts a shifted partial-line substring when the second-pass text length differs (µ insertion before the selection)', () => {
    const baselineText = 'signal at 0·8 m in the SELECTED region'
    const secondPassText = 'signal at 0.8 µm in the SELECTED region'
    const line = paddleLine(baselineText)
    const start = baselineText.indexOf('SELECTED')
    const end = start + 'SELECTED'.length
    const result = extractHighResCandidate([range(line, start, end)], [recog(secondPassText)])
    expect(result).toEqual({ text: 'SELECTED', failed: false })
  })

  it('fails (no candidate) when baseline and second-pass are too different to align safely', () => {
    const line = paddleLine('The quick brown fox jumps over the lazy dog')
    const result = extractHighResCandidate([range(line, 0, 5)], [recog('completely unrelated garbled nonsense output')])
    expect(result).toEqual({ text: null, failed: true })
  })

  it('fails when there are no selected line ranges', () => {
    const result = extractHighResCandidate([], [])
    expect(result).toEqual({ text: null, failed: true })
  })

  it('fails when the number of ranges and recognition results do not match', () => {
    const line = paddleLine('some text here')
    const result = extractHighResCandidate([range(line, 0, 4)], [])
    expect(result).toEqual({ text: null, failed: true })
  })

  it('fails when the service reports zero detections for a line (Prototype 1.5I)', () => {
    const line = paddleLine('some text here')
    const result = extractHighResCandidate([range(line, 0, 4)], [recogFailed(0)])
    expect(result).toEqual({ text: null, failed: true })
  })

  it('fails when the service reports multiple detections for a line (Prototype 1.5I)', () => {
    const line = paddleLine('some text here')
    const result = extractHighResCandidate([range(line, 0, 4)], [recogFailed(2)])
    expect(result).toEqual({ text: null, failed: true })
  })
})
