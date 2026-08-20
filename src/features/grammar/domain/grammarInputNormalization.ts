/**
 * Prototype 2.5H item 5 — the single boundary where source/display text (whatever the
 * user sees in the textarea, PDF-derived or manually typed) is converted to the form sent
 * to grammar analysis. Composes three independent normalization steps in order (item 11 —
 * citation removal only ever matches pure-digit brackets and never touches "[式 (N)]", so it
 * is safe before equation-placeholder renaming; display-equation shielding must run LAST,
 * after the placeholder has its final "[EQUATION_N]" analysis-facing spelling):
 *
 *   source text
 *   -> remove citation markers
 *   -> normalize equation placeholders ("[式 (N)]" -> "[EQUATION_N]")
 *   -> shield display equations for Stanza (Prototype 2.6G2.8A)
 *   -> analysis text
 *
 * Called from exactly one place (App.tsx's handleAnalyze) so there is one place, not
 * scattered regex replacements across components, that decides what Stanza/the grammar
 * pipeline actually sees. The source textarea/PDF display is never touched by this pipeline.
 */
import { removeCitationMarkersForAnalysis, removeCitationMarkersFromProjection } from './citationNormalization.ts'
import { normalizeEquationPlaceholdersForAnalysis, normalizeEquationPlaceholdersInProjection } from './equationPlaceholder.ts'
import { shieldRelationalMathRuns, shieldRelationalMathRunsForAnalysis } from './mathRunProjection.ts'
import { shieldDisplayEquationsForAnalysis, shieldDisplayEquationsInProjection } from './scientificTextShielding.ts'
import { projectionFromSource, type Projection } from './textProjection.ts'

/**
 * Prototype 2.6G2.8M2: math-run DETECTION always runs against the raw source text (item 8's
 * own requirement — detection is a SOURCE SEGMENTATION concern, independent of citation/
 * equation handling), but the actual MATH_EXPR substitution is applied LAST, after every
 * other step, so it never needs those steps to thread a math-run-specific side-channel
 * through their own (unrelated) transforms — `replaceRangeWithSynthetic`'s own source-index
 * scan finds the right position regardless of how many prior steps already ran.
 */
export function normalizeSentenceForGrammarAnalysis(sourceText: string): string {
  const citationsRemoved = removeCitationMarkersForAnalysis(sourceText)
  const equationsNamed = normalizeEquationPlaceholdersForAnalysis(citationsRemoved)
  const displayShielded = shieldDisplayEquationsForAnalysis(equationsNamed)
  return shieldRelationalMathRunsForAnalysis(sourceText, displayShielded)
}

/**
 * Prototype 2.6G2.8E — `Projection`-carrying twin of `normalizeSentenceForGrammarAnalysis`,
 * composing the same four steps in the same order via their Projection-based counterparts.
 * `.text` is byte-identical to `normalizeSentenceForGrammarAnalysis(sourceText)` (see
 * tests/grammar/grammarInputNormalization.test.ts) — this function additionally carries the
 * exact analysis-index -> source-index mapping through every step, so a Tree span can be
 * projected back to its true source range by index lookup, never text search.
 */
export function projectSentenceForGrammarAnalysis(sourceText: string): Projection {
  const citationsRemoved = removeCitationMarkersFromProjection(projectionFromSource(sourceText))
  const equationsNamed = normalizeEquationPlaceholdersInProjection(citationsRemoved)
  const displayShielded = shieldDisplayEquationsInProjection(equationsNamed)
  // Prototype 2.6G2.8M2: applied LAST -- see this file's own `normalizeSentenceForGrammarAnalysis`
  // doc comment for why (analysisStart/analysisEnd in the recorded SyntheticRunSourceRange
  // stay valid only because nothing runs after this step).
  return shieldRelationalMathRuns(displayShielded, sourceText)
}

/**
 * Prototype 2.6G2.8M2.2c -- MATH_EXPR is a Stanza SYNTAX-SHIELDING token (item 2's own
 * explicit requirement): it exists solely because Stanza demonstrably fabricates structure
 * around a relational/assignment expression (the live-traced "t = 0.5" fake clause). It must
 * never automatically become the input every OTHER analysis consumer receives.
 *
 * `normalizeSentenceForReadingGuide` is the SAME first three steps as
 * `normalizeSentenceForGrammarAnalysis` (citation removal, equation-placeholder renaming,
 * display-equation shielding -- all of which ReadingGuide genuinely needs, same as Stanza)
 * WITHOUT the final math-shielding step -- so ReadingGuide/Ollama sees source-faithful
 * relational math ("t = 200,000 m², a = 5,000 m², c = 0.3, and r = 10") exactly as printed,
 * never the internal placeholder. Deliberately string-only (no Projection twin): ReadingGuide
 * grounding (`resolveSpanAfter`) does its own independent text search against whatever string
 * it is given and has no dependency on E1's source-index machinery.
 */
export function normalizeSentenceForReadingGuide(sourceText: string): string {
  const citationsRemoved = removeCitationMarkersForAnalysis(sourceText)
  const equationsNamed = normalizeEquationPlaceholdersForAnalysis(citationsRemoved)
  return shieldDisplayEquationsForAnalysis(equationsNamed)
}
