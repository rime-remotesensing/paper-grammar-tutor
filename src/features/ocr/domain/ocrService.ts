import * as Tesseract from 'tesseract.js'
import { OCR_CORE_PATH, OCR_LANG_PATH, OCR_WORKER_PATH } from '../../../config/settings'
import type { OcrPageCacheKey, OcrWord } from './ocrTypes'

/** The minimal shape `recognizePage` needs from a Tesseract worker — narrow enough to
 * substitute a stub in tests, the same way tests inject a StubProvider for LLMProvider. */
export interface OcrEngine {
  recognizePage(canvas: HTMLCanvasElement): Promise<Tesseract.Page>
}

/**
 * Lazily-created, session-lifetime Tesseract worker. Module-scope memoization (not a
 * React ref/effect) so it survives across every OCR request and every component
 * re-render, and so concurrent callers before the first resolution share the same
 * in-flight promise instead of racing to spawn two workers (this also makes it immune to
 * React StrictMode's double-invoke of effects, since nothing here runs inside an effect).
 *
 * All three asset paths are pinned to same-origin static files under `public/tesseract/`
 * (see settings.ts) — Tesseract.js's own defaults reach out to jsDelivr's CDN for the
 * worker script, WASM core, and English traineddata, which this project must never do.
 */
let workerPromise: Promise<Tesseract.Worker> | null = null

function getWorker(): Promise<Tesseract.Worker> {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
      workerPath: OCR_WORKER_PATH,
      corePath: OCR_CORE_PATH,
      langPath: OCR_LANG_PATH,
      gzip: true,
    })
  }
  return workerPromise
}

function getDefaultEngine(): Promise<OcrEngine> {
  return getWorker().then((worker) => ({
    async recognizePage(canvas: HTMLCanvasElement) {
      const { data } = await worker.recognize(canvas, {}, { blocks: true })
      return data
    },
  }))
}

/** Explicit teardown for callers that reach a well-defined "OCR is no longer needed"
 * point (there isn't one yet in this single-page app — see README). Never call this
 * automatically from a component unmount/effect cleanup; workers are meant to outlive
 * individual renders. */
export async function terminateOcrWorker(): Promise<void> {
  if (!workerPromise) return
  const worker = await workerPromise
  workerPromise = null
  await worker.terminate()
}

function toWords(page: Tesseract.Page): OcrWord[] {
  const words: OcrWord[] = []
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          words.push({ text: word.text, confidence: word.confidence, bbox: word.bbox })
        }
      }
    }
  }
  return words
}

function cacheKeyOf({ documentToken, pageNumber, scale }: OcrPageCacheKey): string {
  return `${documentToken}:${pageNumber}:${scale}`
}

/** In-memory page-wide OCR cache, keyed by document+page+scale so the same page is never
 * OCR'd twice in a session. Values are promises (not resolved results) so two requests
 * for the same not-yet-finished page share one Tesseract call instead of racing. Cleared
 * wholesale on `resetOcrCache` (called whenever a new PDF is loaded) — this app only
 * needs the current document's cache, never several documents' at once. */
let pageCache = new Map<string, Promise<OcrWord[]>>()

export function resetOcrCache(): void {
  pageCache = new Map()
}

/**
 * Runs (or reuses a cached) page-wide OCR pass over `canvas`, returning a flat list of
 * recognized words with pixel-space bounding boxes. Never invoked automatically — only
 * from the user-triggered "OCRで読み直す" flow (see OcrFallbackPanel).
 *
 * `engine` defaults to the real, lazily-initialized Tesseract worker; tests inject a stub
 * so they never touch the actual WASM/worker/language-data assets.
 */
export async function recognizePage(
  key: OcrPageCacheKey,
  canvas: HTMLCanvasElement,
  engine: Promise<OcrEngine> = getDefaultEngine(),
): Promise<OcrWord[]> {
  const cacheKey = cacheKeyOf(key)
  const cached = pageCache.get(cacheKey)
  if (cached) return cached

  const promise = (async () => {
    const resolvedEngine = await engine
    const page = await resolvedEngine.recognizePage(canvas)
    return toWords(page)
  })()

  pageCache.set(cacheKey, promise)
  // A failed OCR pass shouldn't be remembered as "the" result for this page — the next
  // request should get a clean retry rather than the same rejected promise forever.
  promise.catch(() => {
    if (pageCache.get(cacheKey) === promise) pageCache.delete(cacheKey)
  })
  return promise
}
