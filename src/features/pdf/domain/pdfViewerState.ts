import { PDF_DEFAULT_SCALE } from '../../../config/settings'
import { normalizePdfSelectionText } from '../utils/pdfTextNormalize'

export interface PdfViewerState {
  pageNumber: number
  scale: number
}

/**
 * Per-document viewer state (current page, zoom). Used both as the initial state and
 * to reset the viewer whenever the user opens a different PDF file, so page/zoom from
 * the previous document never leaks into the new one.
 */
export function resetForNewDocument(): PdfViewerState {
  return { pageNumber: 1, scale: PDF_DEFAULT_SCALE }
}

export interface PdfSelectionResult {
  rawText: string
  normalizedText: string
  pageNumber: number
}

export interface PointerPoint {
  x: number
  y: number
}

/**
 * Reading-order comparison for two viewport points on the same text-layer page, used to
 * decide which end of a rebuilt selection range is the start vs. the end regardless of
 * which direction the user physically dragged (down-right, up-left, ...). Points within
 * `lineTolerancePx` of each other vertically are treated as being on the same line and
 * compared by X only, since pdf.js line spans can differ by a pixel or two in baseline Y
 * even within one visual line.
 */
export function isReadingOrderBefore(a: PointerPoint, b: PointerPoint, lineTolerancePx = 4): boolean {
  if (Math.abs(a.y - b.y) > lineTolerancePx) return a.y < b.y
  return a.x <= b.x
}

/**
 * Turns a raw browser text-layer selection into the structured, normalized form the
 * UI hands to the (editable) sentence textarea. Returns null for an empty/whitespace
 * selection so callers can ignore accidental clicks without special-casing blank text.
 */
export function buildSelectionResult(rawText: string, pageNumber: number): PdfSelectionResult | null {
  const normalizedText = normalizePdfSelectionText(rawText)
  if (normalizedText.length === 0) return null
  return { rawText, normalizedText, pageNumber }
}
