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
