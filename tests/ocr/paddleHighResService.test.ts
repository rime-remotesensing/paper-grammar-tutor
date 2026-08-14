import { afterEach, describe, expect, it, vi } from 'vitest'

// cropCanvasToPngBlob uses browser-only Canvas APIs (document.createElement) that don't
// exist in this project's Node test environment — stubbed here the same way other
// domain tests inject a fake engine/client rather than touching the DOM. padAndClampRect
// is pure math and left real.
vi.mock('../../src/features/ocr/domain/canvasCrop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/features/ocr/domain/canvasCrop')>()
  return {
    ...actual,
    cropCanvasToPngBlob: vi.fn(async () => new Blob(['fake-crop'])),
  }
})

vi.mock('../../src/features/ocr/domain/paddleLineRecognitionClient', () => ({
  requestLineRecognition: vi.fn(),
}))

import { requestLineRecognition } from '../../src/features/ocr/domain/paddleLineRecognitionClient'
import { cropCanvasToPngBlob } from '../../src/features/ocr/domain/canvasCrop'
import { recognizeSelectedLinesHighRes } from '../../src/features/ocr/domain/paddleHighResService'
import { resetHighResRenderCache } from '../../src/features/ocr/domain/highResPageCache'
import type { PaddleLine } from '../../src/features/ocr/schemas/paddleOcr.schema'
import type { PixelRect } from '../../src/features/ocr/domain/ocrTypes'

const requestLineRecognitionMock = vi.mocked(requestLineRecognition)
const cropCanvasToPngBlobMock = vi.mocked(cropCanvasToPngBlob)

function fakeCanvas(width: number, height: number): HTMLCanvasElement {
  return { width, height } as HTMLCanvasElement
}

function line(text: string, bbox: [number, number, number, number]): PaddleLine {
  return { text, confidence: 0.9, bbox, words: [{ text, confidence: 0.9, bbox }] }
}

afterEach(() => {
  requestLineRecognitionMock.mockReset()
  cropCanvasToPngBlobMock.mockClear()
  resetHighResRenderCache()
})

const baselineLine = line('The signal is recorded.', [10, 10, 200, 30])
const selectionRect: PixelRect = { left: 10, top: 10, right: 200, bottom: 30 }

describe('recognizeSelectedLinesHighRes', () => {
  it('renders once and reuses the cached render for a second selection on the same page', async () => {
    requestLineRecognitionMock.mockResolvedValue({ lines: [{ text: 'The signal is recorded.', confidence: 0.9, detectionCount: 1 }] })
    const renderHighRes = vi.fn(async () => fakeCanvas(600, 90))
    const params = {
      key: { documentToken: 'doc-1', pageNumber: 4, scale: 6 },
      lines: [baselineLine],
      baselineImageWidth: 200,
      baselineImageHeight: 40,
      selectionRectsPixel: [selectionRect],
      tolerancePx: 3,
      renderHighRes,
    }
    const result = await recognizeSelectedLinesHighRes(params)
    expect(result).toEqual({ text: 'The signal is recorded.', failed: false })
    const result2 = await recognizeSelectedLinesHighRes(params)
    expect(result2).toEqual({ text: 'The signal is recorded.', failed: false })
    expect(renderHighRes).toHaveBeenCalledTimes(1)
  })

  it('sends one crop per selected line', async () => {
    requestLineRecognitionMock.mockResolvedValue({ lines: [{ text: 'The signal is recorded.', confidence: 0.9, detectionCount: 1 }] })
    await recognizeSelectedLinesHighRes({
      key: { documentToken: 'doc-2', pageNumber: 1, scale: 6 },
      lines: [baselineLine],
      baselineImageWidth: 200,
      baselineImageHeight: 40,
      selectionRectsPixel: [selectionRect],
      tolerancePx: 3,
      renderHighRes: async () => fakeCanvas(600, 90),
    })
    expect(cropCanvasToPngBlobMock).toHaveBeenCalledTimes(1)
  })

  it('returns failed when the service reports zero or multiple detections for a line', async () => {
    requestLineRecognitionMock.mockResolvedValue({ lines: [{ text: null, confidence: null, detectionCount: 0 }] })
    const result = await recognizeSelectedLinesHighRes({
      key: { documentToken: 'doc-2b', pageNumber: 1, scale: 6 },
      lines: [baselineLine],
      baselineImageWidth: 200,
      baselineImageHeight: 40,
      selectionRectsPixel: [selectionRect],
      tolerancePx: 3,
      renderHighRes: async () => fakeCanvas(600, 90),
    })
    expect(result).toEqual({ text: null, failed: true })
  })

  it('returns failed when the service response fails DTO validation', async () => {
    requestLineRecognitionMock.mockResolvedValue({ notLines: 'invalid shape' })
    const result = await recognizeSelectedLinesHighRes({
      key: { documentToken: 'doc-3', pageNumber: 1, scale: 6 },
      lines: [baselineLine],
      baselineImageWidth: 200,
      baselineImageHeight: 40,
      selectionRectsPixel: [selectionRect],
      tolerancePx: 3,
      renderHighRes: async () => fakeCanvas(600, 90),
    })
    expect(result).toEqual({ text: null, failed: true })
  })

  it('returns failed without calling the client when no selection line can be resolved', async () => {
    const farRect: PixelRect = { left: 5000, top: 5000, right: 5100, bottom: 5100 }
    const result = await recognizeSelectedLinesHighRes({
      key: { documentToken: 'doc-4', pageNumber: 1, scale: 6 },
      lines: [baselineLine],
      baselineImageWidth: 200,
      baselineImageHeight: 40,
      selectionRectsPixel: [farRect],
      tolerancePx: 3,
      renderHighRes: async () => fakeCanvas(600, 90),
    })
    expect(result).toEqual({ text: null, failed: true })
    expect(requestLineRecognitionMock).not.toHaveBeenCalled()
  })
})
