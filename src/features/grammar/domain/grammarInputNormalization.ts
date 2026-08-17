/**
 * Prototype 2.5H item 5 — the single boundary where source/display text (whatever the
 * user sees in the textarea, PDF-derived or manually typed) is converted to the form sent
 * to grammar analysis. Composes the two independent normalization steps in the
 * recommended order (item 11 — either order is safe by construction, since citation
 * removal only ever matches pure-digit brackets and never touches "[式 (N)]"):
 *
 *   source text -> remove citation markers -> normalize equation placeholders -> analysis text
 *
 * Called from exactly one place (App.tsx's handleAnalyze) so there is one place, not
 * scattered regex replacements across components, that decides what the LLM actually sees.
 */
import { removeCitationMarkersForAnalysis } from './citationNormalization.ts'
import { normalizeEquationPlaceholdersForAnalysis } from './equationPlaceholder.ts'

export function normalizeSentenceForGrammarAnalysis(sourceText: string): string {
  return normalizeEquationPlaceholdersForAnalysis(removeCitationMarkersForAnalysis(sourceText))
}
