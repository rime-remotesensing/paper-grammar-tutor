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

/** A selection fragment's bounding rect as a fraction (0..1) of the page canvas's
 * displayed CSS size at selection time. Page-relative rather than pixel-absolute so it
 * stays valid after the user zooms or re-renders the page at a different scale (e.g. the
 * OCR fallback's own render pass) — see resolveOcrPixelRect in the ocr feature. */
export interface NormalizedRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** A candidate scientific token found within the selected embedded text (currently just
 * `digit·digit` middle-dot decimals — Rule A's trigger pattern; see
 * scientificNormalization.ts), together with its own tight geometry — never the
 * containing span's whole rect — so it can later be spatially cross-validated against the
 * OCR word at that exact position. */
export interface EmbeddedScientificToken {
  text: string
  rects: NormalizedRect[]
}

export interface PdfSelectionResult {
  rawText: string
  normalizedText: string
  pageNumber: number
  /** One entry per real (non-degenerate) `Range.getClientRects()` fragment, for the OCR
   * fallback's spatial word-matching. Deliberately not merged into one bounding box: a
   * multi-line selection's first/last line only has the actually-selected portion
   * selected, and a single bbox spanning the full selection would swallow whatever
   * unselected text sits to the left/right on those edge lines (verified during the
   * Prototype 1.2B/1.2C spikes — see docs/design-notes.md). */
  ocrRects: NormalizedRect[]
  /** Candidate scientific tokens for Rule A, captured at selection time (see
   * EmbeddedScientificToken). Empty when the selection contains no `digit·digit`. */
  scientificTokens: EmbeddedScientificToken[]
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

/** A DOMRect-shaped value; accepts the real DOM type or a plain object (for tests). */
export interface RectLike {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/**
 * Converts a selection's raw `Range.getClientRects()` output into page-relative
 * normalized rects, for later reuse against a page image rendered at a different scale
 * (the OCR fallback's own render, independent of the viewer's current zoom).
 *
 * Filters out zero-width/zero-height "ghost" rects: Chromium emits an extra phantom rect
 * at each line-wrap boundary of a multi-line Range, positioned at the text-layer
 * container's own top-left corner rather than anywhere near the actual text. Including
 * it would corrupt any bounding-box computation downstream (confirmed during the
 * Prototype 1.2B spike — see docs/design-notes.md).
 */
export function computeNormalizedSelectionRects(
  clientRects: readonly RectLike[],
  canvasRect: { left: number; top: number; width: number; height: number },
): NormalizedRect[] {
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return []
  return clientRects
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({
      x0: (r.left - canvasRect.left) / canvasRect.width,
      y0: (r.top - canvasRect.top) / canvasRect.height,
      x1: (r.right - canvasRect.left) / canvasRect.width,
      y1: (r.bottom - canvasRect.top) / canvasRect.height,
    }))
}

export interface TextMatch {
  text: string
  start: number
  end: number
}

/**
 * Finds every `digit·digit` substring in `text` — Rule A's trigger pattern (a literal
 * middle-dot, U+00B7, directly between two digit runs, e.g. "0·8" or "0·05"). Pure text
 * scan; the caller turns each match's [start,end) offset into a DOM sub-range (see
 * PdfViewer's extractScientificTokens) rather than using the containing span/text node's
 * whole rect, so an unrelated adjacent number in the same span never gets swept in.
 *
 * Deliberately narrow: only a literal "·" triggers a match. Real hyphen/en-dash ranges
 * ("2-5", "1775-1795") never match this pattern at all, by construction — see
 * scientificNormalization.ts for why that matters.
 */
export function findDigitMiddotMatches(text: string): TextMatch[] {
  const matches: TextMatch[] = []
  const pattern = /\d+·\d+/g
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    matches.push({ text: m[0], start: m.index, end: m.index + m[0].length })
  }
  return matches
}

/**
 * Turns a raw browser text-layer selection into the structured, normalized form the
 * UI hands to the (editable) sentence textarea. Returns null for an empty/whitespace
 * selection so callers can ignore accidental clicks without special-casing blank text.
 */
export function buildSelectionResult(
  rawText: string,
  pageNumber: number,
  ocrRects: NormalizedRect[] = [],
  scientificTokens: EmbeddedScientificToken[] = [],
): PdfSelectionResult | null {
  const normalizedText = normalizePdfSelectionText(rawText)
  if (normalizedText.length === 0) return null
  return { rawText, normalizedText, pageNumber, ocrRects, scientificTokens }
}
