import { PADDLE_HEALTH_TIMEOUT_MS, PADDLE_OCR_TIMEOUT_MS, PADDLE_SERVICE_URL } from '../../../config/settings'
import { paddlePageResultSchema, type PaddlePageResult } from '../schemas/paddleOcr.schema'
import { checkPaddleHealth, requestPaddleOcr, type PaddleAvailability } from './paddleOcrClient'
import type { OcrPageCacheKey } from './ocrTypes'

export type { PaddleAvailability }

/** Never cached — a stopped/restarted service must be detected on the very next check,
 * not remembered as "available" from an earlier click (see docs/design-notes.md,
 * Prototype 1.4B, "explicit fallback" design). */
export async function checkPaddleAvailability(): Promise<PaddleAvailability> {
  return checkPaddleHealth(PADDLE_SERVICE_URL, PADDLE_HEALTH_TIMEOUT_MS)
}

/**
 * In-memory page-wide OCR cache, entirely separate from the Tesseract path's own cache
 * (ocrService.ts) — a different module-level Map, not just a differently-prefixed key in
 * a shared one, so the two engines' cached results can never collide or be confused with
 * each other (see docs/design-notes.md, Prototype 1.4B, "cache engine separation").
 * Keyed by document+page+scale, same shape as the Tesseract cache key. Values are
 * promises so concurrent requests for the same not-yet-finished page share one HTTP call.
 */
let pageCache = new Map<string, Promise<PaddlePageResult>>()

export function resetPaddleCache(): void {
  pageCache = new Map()
}

function cacheKeyOf({ documentToken, pageNumber, scale }: OcrPageCacheKey): string {
  return `${documentToken}:${pageNumber}:${scale}`
}

/**
 * Runs (or reuses a cached) page-wide Paddle OCR pass over `canvas`, returning the
 * validated line/word DTO. Never invoked automatically — only from the user-triggered
 * "OCRで読み直す" flow, after `checkPaddleAvailability` has already confirmed the service
 * is usable.
 */
export async function recognizePageWithPaddle(key: OcrPageCacheKey, canvas: HTMLCanvasElement): Promise<PaddlePageResult> {
  const cacheKey = cacheKeyOf(key)
  const cached = pageCache.get(cacheKey)
  if (cached) return cached

  const promise = (async () => {
    const raw = await requestPaddleOcr(PADDLE_SERVICE_URL, canvas, PADDLE_OCR_TIMEOUT_MS)
    const parsed = paddlePageResultSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`高精度OCRサービスの応答を検証できませんでした: ${parsed.error.issues.map((i) => i.message).join('; ')}`)
    }
    return parsed.data
  })()

  pageCache.set(cacheKey, promise)
  // A failed OCR pass shouldn't be remembered as "the" result for this page — the next
  // request should get a clean retry rather than the same rejected promise forever.
  promise.catch(() => {
    if (pageCache.get(cacheKey) === promise) pageCache.delete(cacheKey)
  })
  return promise
}
