import { describe, expect, it } from 'vitest'
import type Tesseract from 'tesseract.js'
import { recognizePage, resetOcrCache, type OcrEngine } from '../../src/features/ocr/domain/ocrService'

function fixturePage(words: string[]): Tesseract.Page {
  return {
    blocks: [
      {
        text: words.join(' '),
        confidence: 90,
        bbox: { x0: 0, y0: 0, x1: 100, y1: 20 },
        blocktype: 'TEXT',
        page: undefined as unknown as Tesseract.Page,
        paragraphs: [
          {
            text: words.join(' '),
            confidence: 90,
            bbox: { x0: 0, y0: 0, x1: 100, y1: 20 },
            is_ltr: true,
            lines: [
              {
                text: words.join(' '),
                confidence: 90,
                bbox: { x0: 0, y0: 0, x1: 100, y1: 20 },
                baseline: { x0: 0, y0: 20, x1: 100, y1: 20 },
                rowAttributes: undefined as unknown as Tesseract.RowAttributes,
                words: words.map((text, i) => ({
                  text,
                  confidence: 90,
                  bbox: { x0: i * 10, y0: 0, x1: i * 10 + 8, y1: 20 },
                  font_name: 'stub',
                  symbols: [],
                  choices: [],
                })),
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Tesseract.Page
}

class StubEngine implements OcrEngine {
  calls: HTMLCanvasElement[] = []
  page: Tesseract.Page
  constructor(page: Tesseract.Page) {
    this.page = page
  }
  async recognizePage(canvas: HTMLCanvasElement): Promise<Tesseract.Page> {
    this.calls.push(canvas)
    return this.page
  }
}

class ThrowingEngine implements OcrEngine {
  async recognizePage(): Promise<Tesseract.Page> {
    throw new Error('OCR engine failed')
  }
}

function fakeCanvas(): HTMLCanvasElement {
  return {} as HTMLCanvasElement
}

describe('recognizePage', () => {
  it('flattens blocks/paragraphs/lines/words into a flat word list', async () => {
    const engine = new StubEngine(fixturePage(['The', 'signal']))
    const words = await recognizePage(
      { documentToken: 'doc-1', pageNumber: 4, scale: 2 },
      fakeCanvas(),
      Promise.resolve(engine),
    )
    expect(words).toEqual([
      { text: 'The', confidence: 90, bbox: { x0: 0, y0: 0, x1: 8, y1: 20 } },
      { text: 'signal', confidence: 90, bbox: { x0: 10, y0: 0, x1: 18, y1: 20 } },
    ])
  })

  it('returns an empty word list when blocks is null', async () => {
    const engine = new StubEngine({ blocks: null } as unknown as Tesseract.Page)
    const words = await recognizePage({ documentToken: 'doc-1', pageNumber: 1, scale: 2 }, fakeCanvas(), Promise.resolve(engine))
    expect(words).toEqual([])
  })

  it('reuses the cached result for the same document+page+scale without calling the engine again', async () => {
    resetOcrCache()
    const engine = new StubEngine(fixturePage(['Cached']))
    const key = { documentToken: 'doc-2', pageNumber: 4, scale: 2 }
    await recognizePage(key, fakeCanvas(), Promise.resolve(engine))
    await recognizePage(key, fakeCanvas(), Promise.resolve(engine))
    expect(engine.calls).toHaveLength(1)
  })

  it('treats a different page number as a cache miss', async () => {
    resetOcrCache()
    const engine = new StubEngine(fixturePage(['Page']))
    await recognizePage({ documentToken: 'doc-3', pageNumber: 1, scale: 2 }, fakeCanvas(), Promise.resolve(engine))
    await recognizePage({ documentToken: 'doc-3', pageNumber: 2, scale: 2 }, fakeCanvas(), Promise.resolve(engine))
    expect(engine.calls).toHaveLength(2)
  })

  it('treats a different scale as a cache miss', async () => {
    resetOcrCache()
    const engine = new StubEngine(fixturePage(['Scale']))
    await recognizePage({ documentToken: 'doc-4', pageNumber: 1, scale: 2 }, fakeCanvas(), Promise.resolve(engine))
    await recognizePage({ documentToken: 'doc-4', pageNumber: 1, scale: 3 }, fakeCanvas(), Promise.resolve(engine))
    expect(engine.calls).toHaveLength(2)
  })

  it('invalidates the cache for a previous document after resetOcrCache (new PDF loaded)', async () => {
    const engine = new StubEngine(fixturePage(['Doc']))
    const key = { documentToken: 'doc-5', pageNumber: 1, scale: 2 }
    await recognizePage(key, fakeCanvas(), Promise.resolve(engine))
    resetOcrCache()
    await recognizePage(key, fakeCanvas(), Promise.resolve(engine))
    expect(engine.calls).toHaveLength(2)
  })

  it('does not poison the cache with a failed OCR attempt — a later retry gets a clean call', async () => {
    resetOcrCache()
    const key = { documentToken: 'doc-6', pageNumber: 1, scale: 2 }
    await expect(recognizePage(key, fakeCanvas(), Promise.resolve(new ThrowingEngine()))).rejects.toThrow(
      'OCR engine failed',
    )
    const engine = new StubEngine(fixturePage(['Retry']))
    const words = await recognizePage(key, fakeCanvas(), Promise.resolve(engine))
    expect(words).toEqual([{ text: 'Retry', confidence: 90, bbox: { x0: 0, y0: 0, x1: 8, y1: 20 } }])
  })
})
