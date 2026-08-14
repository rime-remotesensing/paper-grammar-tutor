import type { SelectedLineRange } from './paddleAdapter'
import type { PaddleLineRecognitionResult } from '../schemas/paddleLinesResult.schema'

/**
 * Maps the selected `[start, end)` character range within a Paddle 2x line's own text
 * onto the *different* recognition of the same physical line produced by the 6x
 * high-resolution second-pass (Prototype 1.5D geometry, Prototype 1.5I recognition
 * engine — the same full det+rec pipeline `/ocr/page` uses). No fuzzy semantic
 * correction happens here — this is purely a character-alignment problem (the two texts
 * describe the same printed line, usually near-identical) so a partial-line selection
 * doesn't pull in unselected text from elsewhere on the line, and so a selection that
 * starts/ends mid-line stays anchored to the same relative position after the line is
 * re-recognized.
 */

const MAX_ALIGNMENT_EDIT_RATIO = 0.3

/**
 * Builds a boundary-position map from string `a` to string `b` via a standard
 * edit-distance DP + backward traceback: `boundaryMap[i]` is the position in `b` that
 * corresponds to the boundary just before character `i` of `a` (so it's valid to index
 * with any `start`/`end` in `[0, a.length]`, matching `PaddleAdapter`'s half-open
 * `[start, end)` selection ranges).
 */
function buildBoundaryMap(a: string, b: string): { boundaryMap: number[]; editDistance: number } {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 0; i <= n; i++) dp[i][0] = i
  for (let j = 0; j <= m; j++) dp[0][j] = j
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }

  const boundaryMap = new Array<number>(n + 1).fill(-1)
  boundaryMap[n] = m
  boundaryMap[0] = 0
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    if (dp[i][j] === dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      i--
      j--
      boundaryMap[i] = j
    } else if (dp[i][j] === dp[i - 1][j] + 1) {
      i--
      boundaryMap[i] = j
    } else {
      j--
    }
  }
  while (i > 0) {
    i--
    boundaryMap[i] = 0
  }

  return { boundaryMap, editDistance: dp[n][m] }
}

export interface HighResExtractionResult {
  /** The candidate string, or null when nothing could be safely extracted. */
  text: string | null
  /** True when a selected line's baseline/high-res texts couldn't be reliably aligned
   * (too different to trust a position mapping), or the request/response shapes didn't
   * match — the whole candidate is withheld rather than showing a partially-wrong
   * result (same whole-result-poisoning policy as paddleAdapter.ts). */
  failed: boolean
}

/**
 * `selectedLineRanges` (from `paddleAdapter.extractSelectedLineRanges`, run against the
 * 2x baseline) and `highResResults` (from `/ocr/lines`) must be the same length and in
 * the same top-to-bottom order — the caller is responsible for uploading line crops in
 * that order, since the recognition-only response carries no bbox to re-derive it from.
 */
export function extractHighResCandidate(
  selectedLineRanges: readonly SelectedLineRange[],
  highResResults: readonly PaddleLineRecognitionResult[],
): HighResExtractionResult {
  if (selectedLineRanges.length === 0) return { text: null, failed: true }
  if (selectedLineRanges.length !== highResResults.length) return { text: null, failed: true }

  const parts: string[] = []
  for (let i = 0; i < selectedLineRanges.length; i++) {
    const { line, start, end } = selectedLineRanges[i]
    const highResText = highResResults[i].text
    // detectionCount !== 1 (0 or multiple regions in that line's crop) surfaces here as
    // text === null — the service never guesses a result in that case, and neither do
    // we: the whole candidate is withheld (Prototype 1.5I item 7).
    if (highResText === null) return { text: null, failed: true }

    const { boundaryMap, editDistance } = buildBoundaryMap(line.text, highResText)
    const maxLen = Math.max(line.text.length, highResText.length, 1)
    if (editDistance / maxLen > MAX_ALIGNMENT_EDIT_RATIO) {
      return { text: null, failed: true }
    }

    const hiStart = boundaryMap[start]
    const hiEnd = boundaryMap[end]
    if (hiStart === undefined || hiEnd === undefined || hiStart < 0 || hiEnd < hiStart) {
      return { text: null, failed: true }
    }
    parts.push(highResText.slice(hiStart, hiEnd))
  }

  if (parts.length === 0) return { text: null, failed: true }
  return { text: parts.join(' '), failed: false }
}
