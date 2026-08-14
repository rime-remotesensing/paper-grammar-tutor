import type { NormalizedRect, OcrWord, PixelRect } from './ocrTypes'

/** Converts a page-relative normalized rect (0..1, captured at selection time against
 * the viewer's on-screen canvas) into pixel coordinates of a page image rendered at a
 * different scale — the OCR fallback's own render, independent of the viewer's current
 * zoom. Multiplying a 0..1 fraction by the OCR canvas's own width/height is exactly
 * equivalent to the CSS-px → PDF-point → OCR-px chain used during the Prototype 1.2B/1.2C
 * spikes (both reduce to `relX * pageWidthInPoints * ocrScale / canvasDisplayWidth`), but
 * doesn't need to know the viewer's current zoom at extraction time. */
export function toPixelRect(normalized: NormalizedRect, ocrCanvasWidth: number, ocrCanvasHeight: number): PixelRect {
  return {
    left: normalized.x0 * ocrCanvasWidth,
    top: normalized.y0 * ocrCanvasHeight,
    right: normalized.x1 * ocrCanvasWidth,
    bottom: normalized.y1 * ocrCanvasHeight,
  }
}

/**
 * Matches OCR words against a set of independent selection rects (one per original
 * `getClientRects()` fragment — never a single merged bounding box; see
 * computeNormalizedSelectionRects) and returns them in reading order.
 *
 * A word is included if its own bbox center falls inside any rect, expanded by
 * `tolerancePx` on each side. Reading order processes rects top-to-bottom (bucketed by a
 * coarse line tolerance, since pdf.js emits several rects per visual line — one per text
 * span plus letter-spacing filler elements — whose `top` can differ by a stray 1-2px from
 * layout rounding even though they belong to the same line) and, within each rect,
 * matched words left-to-right by their own x0. This intentionally does NOT re-cluster
 * lines from the OCR words' own y0: ascender/descender-only words can report a visibly
 * different bbox y0 on the very same baseline, which was found (Prototype 1.2C) to
 * scramble word order if used as the primary sort key.
 *
 * A word matching more than one rect (possible when two fragments are close together) is
 * only emitted once, at its first match.
 */
export function matchWordsToRects(rects: readonly PixelRect[], words: readonly OcrWord[], tolerancePx: number): OcrWord[] {
  const LINE_BUCKET_PX = 10
  const sortedRects = [...rects].sort((a, b) => {
    const lineA = Math.round(a.top / LINE_BUCKET_PX)
    const lineB = Math.round(b.top / LINE_BUCKET_PX)
    if (lineA !== lineB) return lineA - lineB
    return a.left - b.left
  })

  const seen = new Set<OcrWord>()
  const ordered: OcrWord[] = []
  for (const rect of sortedRects) {
    const inRect = words.filter((word) => {
      const cx = (word.bbox.x0 + word.bbox.x1) / 2
      const cy = (word.bbox.y0 + word.bbox.y1) / 2
      return (
        cx >= rect.left - tolerancePx &&
        cx <= rect.right + tolerancePx &&
        cy >= rect.top - tolerancePx &&
        cy <= rect.bottom + tolerancePx
      )
    })
    inRect.sort((a, b) => a.bbox.x0 - b.bbox.x0)
    for (const word of inRect) {
      if (seen.has(word)) continue
      seen.add(word)
      ordered.push(word)
    }
  }
  return ordered
}

/** Joins matched words into the raw OCR candidate string shown to the user. Deliberately
 * no scientific-token normalization or embedded-text merging — see docs/design-notes.md. */
export function joinOcrWords(words: readonly OcrWord[]): string {
  return words.map((w) => w.text).join(' ')
}
