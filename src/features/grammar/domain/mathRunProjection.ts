/**
 * Prototype 2.6G2.8M2 — Stanza projection policy for detected math runs (item 8's own
 * requirement: SOURCE SEGMENTATION is a separate decision from GRAMMAR PROJECTION POLICY —
 * a run can be a MathSegment while remaining LITERAL for Stanza). Only runs whose source
 * text contains a relational/assignment operator character are replaced with the internal
 * "MATH_EXPR" token; every other detected run (a bare symbol, "cos i"-style short run, a
 * superscript/subscript-decorated variable) is left completely untouched in the analysis
 * text, exactly as it appears in the source.
 *
 * This policy is evidence-based, not assumption-based (M1.1 item 9's own live-traced Stanza
 * matrix): "t = 0.5" fabricated a spurious embedded clause (`nsubj`/`xcomp` structure around
 * the "=" token) while bare "k"/"R²"/"cos i" parsed with ordinary, stable dependency
 * structure. "MATH_EXPR" itself was live-verified (5 sentence positions, see the M1.1
 * report) to always tag as a plain PROPN with ordinary `obl`/`nsubj` attachment — never a
 * spurious clause, never leaked to the user (restored/never-shown exactly like the existing
 * "[EQUATION_N]" placeholder convention this mirrors).
 */
import { containsRelationalOperator, detectMathRuns } from './mathRunDetection.ts'
import { replaceRangeWithSynthetic, type Projection } from './textProjection.ts'

const MATH_EXPR_TOKEN = 'MATH_EXPR'

/**
 * String-based twin of `shieldRelationalMathRuns`. Detection always runs against
 * `sourceText` (matching the Projection twin's own semantics — detection is independent of
 * how many other steps already transformed the text), but `sourceText` and `currentText`
 * (the already citation/equation/display-shielded string) are different strings with
 * possibly different offsets — since a plain string carries no positional index the way a
 * `Projection` does, each run's own literal TEXT is located in `currentText` via a
 * monotonically-advancing forward scan (mirroring `resolveSpanAfter`'s own established
 * "search after the previous match" discipline elsewhere in this codebase), never an
 * unscoped/first-occurrence search. Abstains (leaves that one run untouched) if a run's text
 * can't be found at or after the current cursor — never guesses.
 */
export function shieldRelationalMathRunsForAnalysis(sourceText: string, currentText: string): string {
  const relationalRuns = detectMathRuns(sourceText).filter((run) => containsRelationalOperator(run.text))
  let result = currentText
  let cursor = 0
  for (const run of relationalRuns) {
    const idx = result.indexOf(run.text, cursor)
    if (idx === -1) continue
    result = result.slice(0, idx) + MATH_EXPR_TOKEN + result.slice(idx + run.text.length)
    cursor = idx + MATH_EXPR_TOKEN.length
  }
  return result
}

/**
 * Prototype 2.6G2.8M2 — `Projection`-carrying twin. Detects math runs directly against
 * `sourceText` (never against `input.text`, which may already differ from the source by the
 * time this runs) and replaces only the RELATIONAL/ASSIGNMENT-evidenced ones with the
 * internal neutral token, via `replaceRangeWithSynthetic` — so each replacement also records
 * a `SyntheticRunSourceRange`, keeping the complete original math run highlightable.
 */
export function shieldRelationalMathRuns(input: Projection, sourceText: string): Projection {
  // Natural (ascending) source order -- unlike a naive string-slice splice, this is safe
  // regardless of order: `replaceRangeWithSynthetic` relocates each source range via a fresh
  // `sourceIndexOf` scan every time, so an earlier replacement never invalidates a later
  // one's lookup. Ascending order also keeps `syntheticRunSourceRanges` in source order.
  const relationalRuns = detectMathRuns(sourceText).filter((run) => containsRelationalOperator(run.text))
  let result = input
  for (const run of relationalRuns) {
    result = replaceRangeWithSynthetic(result, run.start, run.end, MATH_EXPR_TOKEN)
  }
  return result
}
