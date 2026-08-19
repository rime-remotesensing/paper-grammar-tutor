/**
 * Prototype 2.6G2.5A -- geometry-aware same-line text reconstruction.
 *
 * Some PDFs position adjacent words using only a text-positioning (TJ) offset rather than an
 * embedded space glyph -- pdf.js usually reconstructs the missing space into a TextItem's own
 * `str` via its internal heuristic, but that heuristic is not guaranteed for every font/PDF.
 * When a visual line is split across multiple TextItems/DOM spans, naively concatenating each
 * item's own text (`extractWithinLine`'s and `Range.toString()`'s prior behavior) loses the
 * gap between items entirely, regardless of whether either item's OWN text already has
 * internal spacing.
 *
 * This is the SAME general principle already applied on the backend
 * (services/pymupdf_layout/main.py's `_reconstruct_line_span_texts`): a single space is
 * synthesized between two adjacent segments ONLY when their geometry proves a real gap,
 * normalized by font size, never a fixed pixel number, never a dictionary/known-phrase rule.
 */

export interface TextSegment {
  text: string
  /** Left edge of this segment's own bounding box, in a single consistent coordinate space
   * (CSS pixels from getBoundingClientRect() in production; any consistent unit in tests). */
  left: number
  /** Right edge of this segment's own bounding box, same coordinate space as `left`. */
  right: number
  /** This segment's own font size (or another representative glyph-scale measure, e.g. its
   * rendered box height) in the SAME coordinate space as `left`/`right` -- used to normalize
   * the gap threshold instead of a fixed absolute number. */
  fontSize: number
}

/** A gap wider than this fraction of the larger neighboring font size is treated as a
 * genuine word boundary -- calibrated (Prototype 2.6G2.5A) against a real failing PDF where
 * a missing inter-word gap measured ~14.8% of font size while every intra-word glyph-to-glyph
 * gap measured ~0%; comfortably below the former, comfortably above the latter. Kept
 * identical in spirit to the backend's own `_WORD_GAP_RATIO`/`_WORD_GAP_MIN_PT`. */
const WORD_GAP_RATIO = 0.1
const WORD_GAP_MIN_PX = 0.4

function hasWordGap(prevRight: number, prevSize: number, nextLeft: number, nextSize: number): boolean {
  const gap = nextLeft - prevRight
  const size = Math.max(prevSize, nextSize) || 1
  return gap > Math.max(WORD_GAP_MIN_PX, WORD_GAP_RATIO * size)
}

/**
 * Joins segments in the given (source/reading) order into one string, inserting a single
 * space between two consecutive segments only when：(a) neither segment already starts/ends
 * with whitespace at that boundary (never double a space that's already there), and (b) the
 * geometric gap between them exceeds the font-size-normalized threshold. Never alters any
 * segment's own text otherwise -- purely an insertion of a single space character at a
 * proven boundary, in the same "preserve existing whitespace, add only where geometry proves
 * a gap" discipline as the backend's own reconstruction.
 */
export function joinTextSegments(segments: readonly TextSegment[]): string {
  let result = ''
  let prev: TextSegment | null = null
  for (const segment of segments) {
    if (segment.text.length === 0) continue
    if (prev !== null) {
      const prevEndsWithSpace = /\s$/.test(prev.text)
      const nextStartsWithSpace = /^\s/.test(segment.text)
      if (!prevEndsWithSpace && !nextStartsWithSpace && hasWordGap(prev.right, prev.fontSize, segment.left, segment.fontSize)) {
        result += ' '
      }
    }
    result += segment.text
    prev = segment
  }
  return result
}
