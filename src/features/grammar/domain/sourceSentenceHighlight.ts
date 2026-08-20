import { resolveSpan } from '../../../utils/spanMatch.ts'
import type { Projection } from './textProjection.ts'
import type { SourceSpan } from './treeReadingMatching.ts'

export interface SourceHighlightSegments {
  before: string
  active: string | null
  after: string
}

/** Splits the normalized analysis sentence using only the active Tree node's grounded
 * coordinates. No text search is involved, so repeated phrases remain unambiguous. */
export function buildSourceHighlightSegments(
  sentence: string,
  activeSpan: SourceSpan | null,
): SourceHighlightSegments {
  if (
    activeSpan === null ||
    !Number.isInteger(activeSpan.start) ||
    !Number.isInteger(activeSpan.end) ||
    activeSpan.start < 0 ||
    activeSpan.end <= activeSpan.start ||
    activeSpan.end > sentence.length
  ) {
    return { before: sentence, active: null, after: '' }
  }

  return {
    before: sentence.slice(0, activeSpan.start),
    active: sentence.slice(activeSpan.start, activeSpan.end),
    after: sentence.slice(activeSpan.end),
  }
}

/**
 * Prototype 2.6G2.8B — the user-visible "英文" panel must show the TRUE selected/reconstructed
 * source sentence (citations, equation placeholders, and every scientific glyph intact), never
 * the internal Stanza-facing analysis projection (which strips citations and shields display
 * equations with an internal-only surrogate -- see scientificTextShielding.ts). The active
 * Tree span's OFFSETS are only valid against the analysis projection; they cannot be applied
 * directly to `sourceText`, which is a different string with different character positions.
 *
 * Instead, this looks up the active span's own TEXT (sliced from the projection using its
 * offsets) and searches for that exact text within `sourceText` via the same span-resolution
 * utility ReadingGuide grounding already trusts (spanMatch.ts). This correctly highlights the
 * large majority of Tree nodes, whose text never touched a citation/equation shield. When the
 * span's text cannot be located in `sourceText` at all (a node whose grounded text came from
 * material the projection removed or replaced -- e.g. text spanning a shielded equation), this
 * deliberately shows the source with NO highlight rather than an incorrect/drifted one:
 * per-item requirement, source highlight must never drift.
 *
 * Known limitation: unlike `buildSourceHighlightSegments` (offset-based, so a repeated exact
 * phrase is always unambiguous), this is text-search-based -- if the exact span text repeats
 * verbatim elsewhere in `sourceText` before its true occurrence, the FIRST occurrence is
 * highlighted instead. This only arises when source and projection diverge (a citation/
 * equation was removed) AND the highlighted text itself repeats; accepted as a rare, harmless
 * (never-wrong-content, at-worst-imprecise) trade-off rather than building full segment-based
 * offset mapping for this presentation-only concern.
 *
 * Prototype 2.6G2.8E: live-verified WRONG for short scientific variables ("b" in "a and b"
 * resolved to the "b" inside "be rotated", nowhere near the true occurrence). Text search can
 * never be a source-of-truth mapping. This function is DEMOTED to diagnostic/fallback use
 * only (see item 3 of the phase spec) and MUST NOT be wired to the visible "英文" panel
 * highlight — use `projectAnalysisSpanToSourceHighlight` (exact index lookup via `Projection`)
 * instead.
 */
export function buildSourceHighlightSegmentsFromSourceText(
  sourceText: string,
  projectionText: string,
  activeSpan: SourceSpan | null,
): SourceHighlightSegments {
  if (
    activeSpan === null ||
    !Number.isInteger(activeSpan.start) ||
    !Number.isInteger(activeSpan.end) ||
    activeSpan.start < 0 ||
    activeSpan.end <= activeSpan.start ||
    activeSpan.end > projectionText.length
  ) {
    return { before: sourceText, active: null, after: '' }
  }

  const activeSpanText = projectionText.slice(activeSpan.start, activeSpan.end)
  const resolved = resolveSpan(sourceText, { text: activeSpanText, start: 0, end: 0 })
  if (!resolved.resolved) {
    return { before: sourceText, active: null, after: '' }
  }

  return {
    before: sourceText.slice(0, resolved.start),
    active: sourceText.slice(resolved.start, resolved.end),
    after: sourceText.slice(resolved.end),
  }
}

/** One exact, contiguous run of source-text characters that a Tree span maps to. Multiple
 * runs occur when the span crosses removed/synthetic content in the projection (e.g. a
 * stripped citation, or the boundary of a shielded display equation) — each surviving
 * contiguous stretch of real source characters becomes its own run. */
export interface SourceHighlightRun {
  /** Inclusive start index into `sourceText`. */
  start: number
  /** Exclusive end index into `sourceText`. */
  end: number
}

export interface SourceHighlightResult {
  sourceText: string
  /** Sorted, non-overlapping. Empty when the active span has no literal source origin at all
   * (e.g. it falls entirely within a synthetic surrogate like "the formula") — the panel must
   * render `sourceText` with no highlight in that case, never a drifted guess. */
  activeRuns: SourceHighlightRun[]
}

/**
 * Prototype 2.6G2.8E — the authoritative source-highlight mapping. Projects an analysis-side
 * Tree span back to `sourceText` via EXACT index lookup against `projection.sourceIndexOf`
 * (built up character-by-character through every pre-Stanza transform — see textProjection.ts),
 * never by searching for the span's text. This is what makes repeated short variables ("b" in
 * "a and b are...", occurring earlier as part of "be rotated") resolve to their true, exact
 * occurrence: the mapping was carried forward from the real transformation, not re-derived by
 * matching content afterward.
 *
 * A span that partially or fully falls on synthetic (source-less) analysis characters
 * contributes no run for that portion — synthetic tokens (the "the formula" surrogate, an
 * appended closing period) must never cause a visible highlight on arbitrary source text.
 */
export function projectAnalysisSpanToSourceHighlight(
  sourceText: string,
  projection: Projection,
  activeSpan: SourceSpan | null,
): SourceHighlightResult {
  if (
    activeSpan === null ||
    !Number.isInteger(activeSpan.start) ||
    !Number.isInteger(activeSpan.end) ||
    activeSpan.start < 0 ||
    activeSpan.end <= activeSpan.start ||
    activeSpan.end > projection.text.length
  ) {
    return { sourceText, activeRuns: [] }
  }

  // Prototype 2.6G2.8M2: a math-run placeholder (e.g. an internal "MATH_EXPR" token
  // standing in for "k = 0.5") is entirely synthetic character-by-character, so the
  // ordinary per-character lookup below would find nothing -- but unlike the equation
  // surrogate ("the formula", which stands in for REMOVED content with no source range left
  // to show), the WHOLE original source run is still known here. A span contained within a
  // recorded synthetic run highlights that run's complete original source range as one run.
  const syntheticRun = (projection.syntheticRunSourceRanges ?? []).find(
    (range) => activeSpan.start >= range.analysisStart && activeSpan.end <= range.analysisEnd,
  )
  if (syntheticRun) {
    return { sourceText, activeRuns: [{ start: syntheticRun.sourceStart, end: syntheticRun.sourceEnd }] }
  }

  const runs: SourceHighlightRun[] = []
  let runStart: number | null = null
  let runEnd: number | null = null // exclusive

  for (let i = activeSpan.start; i < activeSpan.end; i++) {
    const sourceIndex = projection.sourceIndexOf[i]
    if (sourceIndex === null) {
      if (runStart !== null) {
        runs.push({ start: runStart, end: runEnd as number })
        runStart = null
        runEnd = null
      }
      continue
    }
    if (runStart !== null && sourceIndex === runEnd) {
      runEnd = sourceIndex + 1
    } else {
      if (runStart !== null) runs.push({ start: runStart, end: runEnd as number })
      runStart = sourceIndex
      runEnd = sourceIndex + 1
    }
  }
  if (runStart !== null) runs.push({ start: runStart, end: runEnd as number })

  return { sourceText, activeRuns: runs }
}
