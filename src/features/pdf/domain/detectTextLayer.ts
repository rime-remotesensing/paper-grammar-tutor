import { PDF_SCANNED_CHECK_MIN_CHARS } from '../../../config/settings'

/**
 * Prototype 1 only supports PDFs with a real text layer (see spec: no OCR). This is a
 * best-effort heuristic, not a certainty: it sums the extracted-text length across a
 * few sampled pages and treats the document as scanned/textless if that total is
 * below a small threshold. A legitimately text-light page (e.g. a title page) sampled
 * alone could be a false positive, which is why callers sample multiple pages.
 */
export function hasExtractableText(sampledPageTextLengths: number[]): boolean {
  const total = sampledPageTextLengths.reduce((sum, n) => sum + n, 0)
  return total >= PDF_SCANNED_CHECK_MIN_CHARS
}
