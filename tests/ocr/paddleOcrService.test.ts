import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/features/ocr/domain/paddleOcrClient', () => ({
  requestPaddleOcr: vi.fn(),
  checkPaddleHealth: vi.fn(),
}))

import { requestPaddleOcr } from '../../src/features/ocr/domain/paddleOcrClient'
import { recognizePageWithPaddle, resetPaddleCache } from '../../src/features/ocr/domain/paddleOcrService'
import { recognizePage, resetOcrCache, type OcrEngine } from '../../src/features/ocr/domain/ocrService'
import type Tesseract from 'tesseract.js'

const requestPaddleOcrMock = vi.mocked(requestPaddleOcr)

function fakeCanvas(): HTMLCanvasElement {
  return {} as HTMLCanvasElement
}

function validDto(lineText = 'stub') {
  return {
    imageWidth: 100,
    imageHeight: 200,
    lines: [{ text: lineText, confidence: 0.9, bbox: [0, 0, 10, 10], words: [] }],
  }
}

afterEach(() => {
  requestPaddleOcrMock.mockReset()
  resetPaddleCache()
})

describe('recognizePageWithPaddle', () => {
  it('calls the client and returns the validated DTO on a cache miss', async () => {
    requestPaddleOcrMock.mockResolvedValue(validDto('first'))
    const result = await recognizePageWithPaddle({ documentToken: 'doc-1', pageNumber: 1, scale: 2 }, fakeCanvas())
    expect(result.lines[0]?.text).toBe('first')
    expect(requestPaddleOcrMock).toHaveBeenCalledTimes(1)
  })

  it('reuses the cached result for the same document+page+scale without calling the service again', async () => {
    requestPaddleOcrMock.mockResolvedValue(validDto('cached'))
    const key = { documentToken: 'doc-2', pageNumber: 4, scale: 2 }
    await recognizePageWithPaddle(key, fakeCanvas())
    await recognizePageWithPaddle(key, fakeCanvas())
    expect(requestPaddleOcrMock).toHaveBeenCalledTimes(1)
  })

  it('treats a different page number as a cache miss', async () => {
    requestPaddleOcrMock.mockResolvedValue(validDto())
    await recognizePageWithPaddle({ documentToken: 'doc-3', pageNumber: 1, scale: 2 }, fakeCanvas())
    await recognizePageWithPaddle({ documentToken: 'doc-3', pageNumber: 2, scale: 2 }, fakeCanvas())
    expect(requestPaddleOcrMock).toHaveBeenCalledTimes(2)
  })

  it('treats a different document token as a cache miss', async () => {
    requestPaddleOcrMock.mockResolvedValue(validDto())
    await recognizePageWithPaddle({ documentToken: 'doc-4a', pageNumber: 1, scale: 2 }, fakeCanvas())
    await recognizePageWithPaddle({ documentToken: 'doc-4b', pageNumber: 1, scale: 2 }, fakeCanvas())
    expect(requestPaddleOcrMock).toHaveBeenCalledTimes(2)
  })

  it('clears the cache after resetPaddleCache (new PDF loaded)', async () => {
    requestPaddleOcrMock.mockResolvedValue(validDto())
    const key = { documentToken: 'doc-5', pageNumber: 1, scale: 2 }
    await recognizePageWithPaddle(key, fakeCanvas())
    resetPaddleCache()
    await recognizePageWithPaddle(key, fakeCanvas())
    expect(requestPaddleOcrMock).toHaveBeenCalledTimes(2)
  })

  it('rejects and does not poison the cache when the service returns an invalid DTO', async () => {
    requestPaddleOcrMock.mockResolvedValue({ imageWidth: 'not-a-number', lines: [] })
    const key = { documentToken: 'doc-6', pageNumber: 1, scale: 2 }
    await expect(recognizePageWithPaddle(key, fakeCanvas())).rejects.toThrow()

    requestPaddleOcrMock.mockResolvedValue(validDto('retry'))
    const result = await recognizePageWithPaddle(key, fakeCanvas())
    expect(result.lines[0]?.text).toBe('retry')
  })

  it('does not share cache entries with a differently-scaled request for the same page', async () => {
    requestPaddleOcrMock.mockResolvedValue(validDto())
    await recognizePageWithPaddle({ documentToken: 'doc-7', pageNumber: 1, scale: 2 }, fakeCanvas())
    await recognizePageWithPaddle({ documentToken: 'doc-7', pageNumber: 1, scale: 3 }, fakeCanvas())
    expect(requestPaddleOcrMock).toHaveBeenCalledTimes(2)
  })

  it('keeps its cache entirely separate from the Tesseract path cache, even for the identical key', async () => {
    resetOcrCache()
    requestPaddleOcrMock.mockResolvedValue(validDto('paddle-result'))
    const tesseractPage = {
      blocks: [],
    } as unknown as Tesseract.Page
    class StubEngine implements OcrEngine {
      calls = 0
      async recognizePage(): Promise<Tesseract.Page> {
        this.calls += 1
        return tesseractPage
      }
    }
    const engine = new StubEngine()
    const key = { documentToken: 'doc-8', pageNumber: 1, scale: 2 }

    // Both engines see the identical cache key — a shared Map would make the second
    // call here a cache hit against the other engine's entry.
    await recognizePageWithPaddle(key, fakeCanvas())
    await recognizePage(key, fakeCanvas(), Promise.resolve(engine))

    expect(requestPaddleOcrMock).toHaveBeenCalledTimes(1)
    expect(engine.calls).toBe(1)
    resetOcrCache()
  })
})
