/**
 * Prototype 2.4A — deterministic, position+repetition-based classification of a page's text
 * lines into BODY / REPEATED_HEADER / REPEATED_FOOTER / PAGE_NUMBER / UNKNOWN (item 19). NOT
 * a layout parser (item 20): no figure/table/section/column understanding — only "is this
 * line, sitting in a page margin band, the same text/number as a nearby page's line at a
 * similar position." Never uses an LLM (item 23). UNKNOWN is always treated as KEEP, exactly
 * like BODY (item 14/17/44) — the only lines ever filtered out are REPEATED_HEADER/
 * REPEATED_FOOTER/PAGE_NUMBER, and only when the repetition evidence itself is present, never
 * from position alone (item 15/17/44's false-positive protection).
 */

/** Minimal structural shape of a pdf.js TextItem this module actually reads — kept
 * independent of pdfjs-dist's own type so this file stays pure/testable with plain fixtures. */
export interface RawTextItem {
  str: string
  /** [a, b, c, d, e, f] — pdf.js's affine transform; e/f are the item's x/y origin in PDF
   * user space (y increases UPWARD from the page's bottom edge). */
  transform: number[]
  height: number
  width: number
  /** True when pdf.js considers a line break to follow this item. */
  hasEOL?: boolean
}

export interface PageLine {
  text: string
  /** Normalized top-down fraction of page height, 0 = top edge, 1 = bottom edge. */
  yTop: number
  yBottom: number
  /** Normalized (0-1) horizontal extent of the line. Not read by this module's own
   * classification logic (margin-band + repetition only); kept on the shape as general
   * per-line geometry. */
  xStart: number
  xEnd: number
  /** Prototype 2.4B-R5B item 6: the line's dominant (median-of-items) rendered font size, in
   * PDF points -- pdf.js's own `TextItem.height` is a stable, always-available field (unlike
   * `fontName`, which varies for incidental reasons like ligature/small-caps runs within the
   * same visual style). Confirmed via real-PDF measurement (R5A): body text and footnote/
   * figure-caption text consistently differ by ~20% in this field, making it a reliable,
   * non-semantic signal for separating them at the block-segmentation level. */
  fontHeight: number
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/**
 * Groups raw pdf.js text items into lines using each item's own `hasEOL` flag (pdf.js
 * already marks line boundaries; this never re-derives them from Y-clustering heuristics,
 * which would be far more error-prone). Items are joined with a single space and then
 * whitespace-collapsed — robust to pdf.js sometimes splitting one visual word across
 * multiple items with no explicit space character between them.
 */
function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export function extractPageLines(items: readonly RawTextItem[], pageHeight: number, pageWidth = 1): PageLine[] {
  if (pageHeight <= 0) return []
  const lines: PageLine[] = []
  let texts: string[] = []
  let itemHeights: number[] = []
  let minY = Infinity
  let maxY = -Infinity
  let minX = Infinity
  let maxX = -Infinity

  const flush = () => {
    const text = texts.join(' ').replace(/\s+/g, ' ').trim()
    if (text.length > 0 && minY !== Infinity) {
      lines.push({
        text,
        yTop: clamp01(1 - maxY / pageHeight),
        yBottom: clamp01(1 - minY / pageHeight),
        xStart: pageWidth > 0 ? clamp01(minX / pageWidth) : 0,
        xEnd: pageWidth > 0 ? clamp01(maxX / pageWidth) : 0,
        fontHeight: medianOf(itemHeights),
      })
    }
    texts = []
    itemHeights = []
    minY = Infinity
    maxY = -Infinity
    minX = Infinity
    maxX = -Infinity
  }

  for (const item of items) {
    if (item.str) {
      texts.push(item.str)
      const y = item.transform[5] ?? 0
      const x = item.transform[4] ?? 0
      const h = item.height || 0
      const w = item.width || 0
      if (h > 0) itemHeights.push(h)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y + h)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x + w)
    }
    if (item.hasEOL) flush()
  }
  flush()
  return lines
}

/** Comparison-only normalization (item 22): trim, collapse whitespace, lowercase. No digit
 * removal, no fuzzy matching — kept deliberately minimal. */
export function normalizeLineText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

export type LineClassification = 'BODY' | 'REPEATED_HEADER' | 'REPEATED_FOOTER' | 'PAGE_NUMBER' | 'UNKNOWN'

export interface ClassifiedLine extends PageLine {
  classification: LineClassification
}

export interface NeighborPageLines {
  /** Signed page distance from the page being classified (e.g. -2, -1, +1, +2). */
  pageDistance: number
  lines: PageLine[]
}

/** Top/bottom fraction of page height treated as the margin band where header/footer/
 * page-number candidates can even be considered (item 15.A/16). A line entirely outside
 * both bands is unconditionally BODY — never evaluated against repetition evidence at all. */
const MARGIN_BAND = 0.12
/** How close (as a fraction of page height) a candidate match on a neighbor page's line
 * must be, vertically, to count as "the same position" (item 15.B). */
const Y_BAND_TOLERANCE = 0.05
/** Item 15.C's "複数ページで反復" (repeats across multiple pages) — at least this many
 * neighbor pages must show the same normalized text at a similar position. */
const MIN_REPEAT_COUNT = 2
const PAGE_NUMBER_PATTERN = /^\d{1,4}$/

/** Replaces every run of digits with a single "#" placeholder -- used only to compare two
 * margin-band lines that are identical apart from an embedded page number (item 51/52's
 * live-discovered real-world layout). Never used outside the already-gated margin-band
 * repetition check, so it can't cause a body-text false positive. */
function maskDigitRuns(text: string): string {
  return text.replace(/\d+/g, '#')
}

function findYMatch(line: PageLine, candidates: PageLine[]): PageLine | undefined {
  return candidates.find((c) => Math.abs(c.yTop - line.yTop) <= Y_BAND_TOLERANCE)
}

function classifyOneLine(line: PageLine, neighbors: NeighborPageLines[]): ClassifiedLine {
  const inTopMargin = line.yTop <= MARGIN_BAND
  const inBottomMargin = line.yBottom >= 1 - MARGIN_BAND
  if (!inTopMargin && !inBottomMargin) {
    return { ...line, classification: 'BODY' }
  }

  const normalized = normalizeLineText(line.text)
  if (normalized.length === 0) {
    return { ...line, classification: 'UNKNOWN' }
  }

  // Page number: isolated short numeric line, confirmed by at least one neighbor page
  // showing a numeric line at a similar position whose value differs by exactly that
  // neighbor's page distance (item 18's "monotonic sequence" requirement) -- an isolated
  // number with no such confirming neighbor is never classified as PAGE_NUMBER (item 40.G).
  if (PAGE_NUMBER_PATTERN.test(normalized)) {
    const thisNumber = Number(normalized)
    const confirmed = neighbors.some((neighbor) => {
      const match = neighbor.lines.find((l) => {
        if (Math.abs(l.yTop - line.yTop) > Y_BAND_TOLERANCE) return false
        const nText = normalizeLineText(l.text)
        return PAGE_NUMBER_PATTERN.test(nText) && Number(nText) === thisNumber + neighbor.pageDistance
      })
      return match !== undefined
    })
    if (confirmed) {
      return { ...line, classification: 'PAGE_NUMBER' }
    }
  }

  // Repeated header/footer: exact (normalized) text match at a similar Y position on at
  // least MIN_REPEAT_COUNT neighbor pages -- item 15.B/C, item 16. ALSO tried with a
  // digit-masked comparison (every digit run replaced with "#") -- real academic PDFs
  // (confirmed live, item 51/52) frequently place the page number INSIDE the same running-
  // header text with no line-break between them (e.g. "139 W. Xu et al. / Remote Sensing of
  // Environment 193 (2017) 138-149", or "Remote Sens. 2016, 8, 535 2 of 13"), so an exact
  // match never fires (the embedded number differs every page) even though the line is
  // unmistakably the same repeating header. Masking digits is still position+repetition
  // based, not fuzzy/dictionary matching (item 23), and stays gated to the margin band only
  // -- it can never reclassify ordinary body text, since two DIFFERENT body sentences would
  // also need every non-digit character to match to trigger this.
  const maskedNormalized = maskDigitRuns(normalized)
  const repeatCount = neighbors.filter((neighbor) => {
    const match = findYMatch(line, neighbor.lines)
    if (match === undefined) return false
    const matchNormalized = normalizeLineText(match.text)
    return matchNormalized === normalized || maskDigitRuns(matchNormalized) === maskedNormalized
  }).length
  if (repeatCount >= MIN_REPEAT_COUNT) {
    return { ...line, classification: inTopMargin ? 'REPEATED_HEADER' : 'REPEATED_FOOTER' }
  }

  // In-margin but no repetition evidence: section headings, table/figure captions, and any
  // other one-off page-top/bottom text all land here and are treated as KEEP, same as BODY
  // (item 17/44's explicit false-positive protection).
  return { ...line, classification: 'UNKNOWN' }
}

export function classifyPageLines(currentLines: readonly PageLine[], neighbors: readonly NeighborPageLines[]): ClassifiedLine[] {
  return currentLines.map((line) => classifyOneLine(line, neighbors as NeighborPageLines[]))
}
