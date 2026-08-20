/**
 * Prototype 2.6G2.7C part B: a newly-loaded PDF should already use the PDF pane's available
 * width instead of forcing the user to press 拡大 repeatedly. `ZoomMode` distinguishes the
 * automatic FIT_WIDTH state (scale is derived from live geometry) from MANUAL (the user's own
 * 縮小/拡大 choice, preserved across ordinary container resizes -- see PdfViewer.tsx).
 */
export type ZoomMode = 'fit-width' | 'manual'

/**
 * Computes the scale that makes a PDF.js page (whose viewport width at scale 1 is
 * `basePageWidth`) fill `availableWidth`, clamped to `[minScale, maxScale]`. Never returns a
 * magic fixed default (e.g. 300%) -- the result is always derived from the actual PDF.js page
 * dimensions and the actual measured pane width. Falls back to `minScale` when either input is
 * non-positive (not yet measurable), never zero/negative/NaN.
 */
export function computeFitWidthScale(
  availableWidth: number,
  basePageWidth: number,
  minScale: number,
  maxScale: number,
): number {
  if (availableWidth <= 0 || basePageWidth <= 0) return minScale
  const raw = availableWidth / basePageWidth
  return Math.min(maxScale, Math.max(minScale, raw))
}
