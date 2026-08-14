import {
  PADDLE_HIGH_RES_PADDING_FRAC,
  PADDLE_LINES_TIMEOUT_MS,
  PADDLE_SERVICE_URL,
} from '../../../config/settings'
import { paddleLinesResultSchema } from '../schemas/paddleLinesResult.schema'
import type { PaddleLine } from '../schemas/paddleOcr.schema'
import { requestLineRecognition } from './paddleLineRecognitionClient'
import { getOrRenderHighRes } from './highResPageCache'
import { padAndClampRect, cropCanvasToPngBlob } from './canvasCrop'
import { extractSelectedLineRanges } from './paddleAdapter'
import { extractHighResCandidate, type HighResExtractionResult } from './paddleHighResAdapter'
import type { OcrPageCacheKey, PixelRect } from './ocrTypes'

export interface RecognizeSelectedLinesHighResParams {
  /** documentToken/pageNumber/scale (scale should be PADDLE_HIGH_RES_SCALE) — used as the
   * high-res render cache key. */
  key: OcrPageCacheKey
  /** The 2x baseline page's Paddle lines (same object the primary candidate was already
   * extracted from). */
  lines: readonly PaddleLine[]
  /** The 2x baseline page's own reported image dimensions — the scale factor to the
   * high-res render is computed from actual measured canvas widths, not a magic
   * multiplier (Prototype 1.5B/C methodology). */
  baselineImageWidth: number
  baselineImageHeight: number
  /** Selection rects in the SAME 2x pixel space as `lines`' bboxes. */
  selectionRectsPixel: readonly PixelRect[]
  tolerancePx: number
  /** Bound to `PdfViewerHandle.renderPageForOcr(pageNumber, PADDLE_HIGH_RES_SCALE)` by
   * the caller — this module has no direct dependency on the PDF viewer. */
  renderHighRes: () => Promise<HTMLCanvasElement>
}

/**
 * Orchestrates the Prototype 1.5D high-resolution second-pass: locate the selected
 * line(s) from the already-fetched 2x baseline result, render (or reuse a cached render
 * of) the same page at PADDLE_HIGH_RES_SCALE from the raw PDF, crop each selected line
 * with padding, batch them into one `/ocr/lines` request, validate the response, and map
 * the result back onto the originally-selected span per line.
 *
 * Never merges into the 2x baseline text — returns its own independent candidate (or a
 * failure), left for the caller (App.tsx) to compare against the baseline candidate and
 * decide whether to show it at all (Prototype 1.5D item 18: identical → hide, different
 * → show both, caller never auto-adopts either).
 */
export async function recognizeSelectedLinesHighRes(
  params: RecognizeSelectedLinesHighResParams,
): Promise<HighResExtractionResult> {
  const { key, lines, baselineImageWidth, baselineImageHeight, selectionRectsPixel, tolerancePx, renderHighRes } = params

  const { ranges, failed } = extractSelectedLineRanges(lines, selectionRectsPixel, tolerancePx)
  if (failed || ranges.length === 0) return { text: null, failed: true }

  const highResCanvas = await getOrRenderHighRes(key, renderHighRes)
  const scaleFactorX = highResCanvas.width / baselineImageWidth
  const scaleFactorY = highResCanvas.height / baselineImageHeight

  const crops: Blob[] = []
  for (const range of ranges) {
    const [x0, y0, x1, y1] = range.line.bbox
    const charHeight = y1 - y0
    const padPx = charHeight * PADDLE_HIGH_RES_PADDING_FRAC
    // Pad in the baseline (2x) pixel space first, then scale the padded rect to the
    // high-res render's pixel space — matching the Prototype 1.5B/C benchmark order
    // exactly (padding is not re-tuned here).
    const paddedBaselineRect: PixelRect = { left: x0 - padPx, top: y0 - padPx, right: x1 + padPx, bottom: y1 + padPx }
    const scaledRect: PixelRect = {
      left: paddedBaselineRect.left * scaleFactorX,
      top: paddedBaselineRect.top * scaleFactorY,
      right: paddedBaselineRect.right * scaleFactorX,
      bottom: paddedBaselineRect.bottom * scaleFactorY,
    }
    const clampedRect = padAndClampRect(scaledRect, 0, highResCanvas.width, highResCanvas.height)
    crops.push(await cropCanvasToPngBlob(highResCanvas, clampedRect))
  }

  const raw = await requestLineRecognition(PADDLE_SERVICE_URL, crops, PADDLE_LINES_TIMEOUT_MS)
  const parsed = paddleLinesResultSchema.safeParse(raw)
  if (!parsed.success || parsed.data.lines.length !== ranges.length) {
    return { text: null, failed: true }
  }

  return extractHighResCandidate(ranges, parsed.data.lines)
}
