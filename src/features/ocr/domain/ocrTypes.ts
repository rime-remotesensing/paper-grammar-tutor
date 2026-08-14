import type { EmbeddedScientificToken, NormalizedRect } from '../../pdf/domain/pdfViewerState'

/** A lightweight projection of Tesseract's per-word result — just enough to do spatial
 * matching and display raw candidate text. Tesseract's full response tree (blocks →
 * paragraphs → lines → words → symbols → choices) is much larger and is never retained
 * beyond the conversion step; see ocrService.recognizePage. */
export interface OcrWord {
  text: string
  confidence: number
  /** Pixel-space bounding box within the page image that was OCR'd (i.e. the OCR-scale
   * render, not the viewer's on-screen canvas). */
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

/** A selection rect (or any rect) in the pixel space of a specific OCR-scale page render. */
export interface PixelRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface OcrPageCacheKey {
  documentToken: string
  pageNumber: number
  scale: number
}

export type { EmbeddedScientificToken, NormalizedRect }
