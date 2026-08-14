import type { PaddleLine, PaddleWord } from '../schemas/paddleOcr.schema'
import type { PixelRect } from './ocrTypes'

/**
 * Turns the paddle_ocr service's line/word DTO into the selection's candidate text.
 * Production port of the Prototype 1.4A spike adapter, adjusted in one important way:
 * the spike silently dropped a line whose word tokens didn't reassemble its own
 * `line.text` ("alignment failure"). Production instead poisons the *whole* candidate
 * when that happens (see extractPaddleCandidate) — a partially-reconstructed sentence
 * shown as "high-accuracy OCR" is more dangerous than an outright failure message.
 */

interface AlignedRange {
  start: number
  end: number
  bbox: PaddleWord['bbox']
}

interface LineAlignment {
  ranges: AlignedRange[]
  alignmentFailed: boolean
}

/**
 * Sequentially aligns a line's word tokens against its own recognized text, character by
 * character. Paddle's word tokens already include whitespace/punctuation as their own
 * entries (confirmed in Prototype 1.4A — e.g. `"0·05"` tokenizes as `["0", "·", "05"]`),
 * so concatenating them with no separator reproduces `lineText` verbatim when alignment
 * succeeds. This locates each word's `[start, end)` character range within `lineText` on
 * that assumption, rather than ever rebuilding the string from the words themselves —
 * see `line.text` authority note on `extractPaddleCandidate`.
 *
 * Stops and reports `alignmentFailed: true` the moment a word doesn't match at the
 * current cursor position — no fuzzy correction.
 */
export function alignWordsToLine(lineText: string, words: readonly PaddleWord[]): LineAlignment {
  const ranges: AlignedRange[] = []
  let cursor = 0
  for (const word of words) {
    if (lineText.slice(cursor, cursor + word.text.length) !== word.text) {
      return { ranges, alignmentFailed: true }
    }
    ranges.push({ start: cursor, end: cursor + word.text.length, bbox: word.bbox })
    cursor += word.text.length
  }
  return { ranges, alignmentFailed: false }
}

function rectOverlapsLineVertically(rect: PixelRect, lineBbox: PaddleLine['bbox'], tolerancePx: number): boolean {
  const rectCenterY = (rect.top + rect.bottom) / 2
  return rectCenterY >= lineBbox[1] - tolerancePx && rectCenterY <= lineBbox[3] + tolerancePx
}

function rectOverlapsLineHorizontally(rect: PixelRect, lineBbox: PaddleLine['bbox']): boolean {
  return rect.left < lineBbox[2] && rect.right > lineBbox[0]
}

/** Finds the single Paddle line a selection rect belongs to, by vertical-center +
 * horizontal overlap against Paddle's own detected line boxes. */
function findLineForRect(rect: PixelRect, lines: readonly PaddleLine[], tolerancePx: number): PaddleLine | null {
  let best: PaddleLine | null = null
  let bestDist = Infinity
  for (const line of lines) {
    if (!rectOverlapsLineVertically(rect, line.bbox, tolerancePx)) continue
    if (!rectOverlapsLineHorizontally(rect, line.bbox)) continue
    const lineCenterY = (line.bbox[1] + line.bbox[3]) / 2
    const rectCenterY = (rect.top + rect.bottom) / 2
    const dist = Math.abs(lineCenterY - rectCenterY)
    if (dist < bestDist) {
      bestDist = dist
      best = line
    }
  }
  return best
}

export interface PaddleExtractionResult {
  /** The candidate string, or null when nothing could be safely extracted. */
  text: string | null
  /** True when a matched line's words couldn't be aligned to its own text, or when no
   * selected line produced any usable text — see module doc for why this poisons the
   * whole result rather than silently dropping just that line. */
  failed: boolean
}

/**
 * Top-level extraction: selection rects (pixel space, from the unchanged production
 * `toPixelRect`) → matched Paddle line → substring of `line.text` → joined top-to-bottom
 * with a single space between lines. Union bounding boxes are never used for the
 * selection geometry itself (each rect is matched to its own line independently, same
 * principle as the Tesseract path's `ocrGeometry.matchWordsToRects` — see
 * Prototype 1.2C).
 *
 * `line.text` is the string authority throughout: candidates are built by *slicing*
 * `line.text`, never by `words.map(w => w.text).join(' ')` (that would insert spaces
 * between tokens that were never spaced in the original, e.g. turning `"0·05"` into
 * `"0 · 05"` — see docs/design-notes.md, Prototype 1.4A/1.4B).
 *
 * Matching is grouped **by line, not by rect**: a single visual line of selected text can
 * produce several overlapping `getClientRects()` fragments (pdf.js emits one rect per
 * text span plus letter-spacing filler elements — Prototype 1.2B). Extracting a
 * substring independently per rect and joining them would emit the same words multiple
 * times (confirmed empirically in the Prototype 1.4A spike — e.g.
 * `"materials materials were were"`). Every rect that maps to the same line instead
 * contributes to one shared matched-word `Set` for that line, and exactly one substring
 * is extracted per line.
 */
export function extractPaddleCandidate(
  lines: readonly PaddleLine[],
  selectionRectsPixel: readonly PixelRect[],
  tolerancePx: number,
): PaddleExtractionResult {
  const lineState = new Map<PaddleLine, { alignment: LineAlignment; matchedIndices: Set<number> }>()

  for (const rect of selectionRectsPixel) {
    const line = findLineForRect(rect, lines, tolerancePx)
    if (!line) continue

    if (!lineState.has(line)) {
      lineState.set(line, { alignment: alignWordsToLine(line.text, line.words), matchedIndices: new Set() })
    }
    const entry = lineState.get(line)
    if (!entry || entry.alignment.alignmentFailed) continue

    entry.alignment.ranges.forEach((range, index) => {
      const cx = (range.bbox[0] + range.bbox[2]) / 2
      const cy = (range.bbox[1] + range.bbox[3]) / 2
      const inRect =
        cx >= rect.left - tolerancePx &&
        cx <= rect.right + tolerancePx &&
        cy >= rect.top - tolerancePx &&
        cy <= rect.bottom + tolerancePx
      if (inRect) entry.matchedIndices.add(index)
    })
  }

  const entries = [...lineState.values()]
  if (entries.some((entry) => entry.alignment.alignmentFailed)) {
    return { text: null, failed: true }
  }

  const orderedLines = [...lineState.entries()].sort((a, b) => a[0].bbox[1] - b[0].bbox[1])
  const parts: string[] = []
  for (const [line, entry] of orderedLines) {
    if (entry.matchedIndices.size === 0) continue
    const matchedRanges = [...entry.matchedIndices].map((i) => entry.alignment.ranges[i])
    const start = Math.min(...matchedRanges.map((r) => r.start))
    const end = Math.max(...matchedRanges.map((r) => r.end))
    parts.push(line.text.slice(start, end))
  }

  if (parts.length === 0) return { text: null, failed: true }
  return { text: parts.join(' '), failed: false }
}
