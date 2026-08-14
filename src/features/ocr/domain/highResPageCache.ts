import type { OcrPageCacheKey } from './ocrTypes'

/**
 * In-memory cache of the *rendered canvas* for the high-resolution second-pass
 * (Prototype 1.5D) — deliberately a separate `Map` from both the 2x Paddle OCR result
 * cache (paddleOcrService.ts) and the Tesseract page cache (ocrService.ts), matching the
 * project's "cache engine/purpose separation" principle (see docs/design-notes.md,
 * Prototype 1.4B). This cache stores the *render*, not an OCR result — a page is
 * rendered once at PADDLE_HIGH_RES_SCALE and then cropped from repeatedly as the user
 * makes further selections on the same page, instead of re-rendering from the PDF each
 * time (Prototype 1.5B measured the 6x render itself, not recognition, as the dominant
 * per-selection cost on a cache miss).
 */
let renderCache = new Map<string, Promise<HTMLCanvasElement>>()

export function resetHighResRenderCache(): void {
  renderCache = new Map()
}

function cacheKeyOf({ documentToken, pageNumber, scale }: OcrPageCacheKey): string {
  return `${documentToken}:${pageNumber}:${scale}`
}

/**
 * Returns the cached high-resolution render for `key`, or invokes `render()` on a cache
 * miss and caches the resulting promise (so concurrent requests for the same not-yet-
 * rendered page share one render instead of racing). `render` is expected to be
 * `PdfViewerHandle.renderPageForOcr` bound to `(pageNumber, scale)` — this module has no
 * direct dependency on the PDF viewer, matching how `ocrService.recognizePage` takes an
 * injectable engine rather than importing Tesseract directly.
 */
export async function getOrRenderHighRes(key: OcrPageCacheKey, render: () => Promise<HTMLCanvasElement>): Promise<HTMLCanvasElement> {
  const cacheKey = cacheKeyOf(key)
  const cached = renderCache.get(cacheKey)
  if (cached) return cached

  const promise = render()
  renderCache.set(cacheKey, promise)
  // A failed render shouldn't be remembered as "the" result for this page — the next
  // request should get a clean retry rather than the same rejected promise forever.
  promise.catch(() => {
    if (renderCache.get(cacheKey) === promise) renderCache.delete(cacheKey)
  })
  return promise
}
