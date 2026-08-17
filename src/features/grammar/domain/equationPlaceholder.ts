/**
 * Prototype 2.5G — deterministic conversion between the PDF-selection display form of a
 * display-equation placeholder ("[式 (5)]", produced by services/pymupdf_layout when a
 * selection crosses from prose into a numbered display equation — see
 * docs/design-notes.md) and the analysis-facing form ("[EQUATION_5]") the grammar prompt
 * is instructed to treat as one opaque unit (see src/llm/prompts/grammarAnalysisPrompt.ts).
 *
 * This is a language-analysis representation concern, not PDF geometry — kept in
 * src/features/grammar (item 49), separate from src/features/pdf. Exact syntax only
 * (item 45): a malformed lookalike like "[式 abc]" is never normalized, and ordinary
 * Japanese text containing "式" elsewhere is never touched.
 */

const DISPLAY_PLACEHOLDER = /\[式\s*(?:\((\d{1,3})\))?\]/g
const ANALYSIS_PLACEHOLDER = /\[EQUATION(?:_(\d{1,3}))?\]/g

/** "[式 (5)]" -> "[EQUATION_5]", "[式]" -> "[EQUATION]". Called once, at the grammar-input
 * boundary, before a sentence is ever sent to the LLM (item 9/10). */
export function normalizeEquationPlaceholdersForAnalysis(text: string): string {
  return text.replace(DISPLAY_PLACEHOLDER, (_match, number: string | undefined) => (number ? `[EQUATION_${number}]` : '[EQUATION]'))
}

/** "[EQUATION_5]" -> "[式 (5)]", "[EQUATION]" -> "[式]". Applied ONLY to free-text fields
 * the LLM generated on its own (readingHint, referenceTranslation, vocabulary/phrase/
 * modifier/clause explanation text) — never to span-derived `.text` excerpts or
 * originalText/normalizedText, whose character positions remain authoritative against the
 * analysis-facing (normalized) text (item 13: no fuzzy bridging between representations). */
export function restoreEquationPlaceholdersForDisplay(text: string): string {
  return text.replace(ANALYSIS_PLACEHOLDER, (_match, number: string | undefined) => (number ? `[式 (${number})]` : '[式]'))
}

/** Minimal structural shape this module needs from a GrammarAnalysis-like object — kept
 * local (not importing the full schema type) so this stays a small, dependency-light
 * utility; callers pass their own already-typed object and get the same shape back. */
interface FreeTextAnalysisFields {
  readingHint: string[]
  referenceTranslation: string | null
  vocabulary: { word: string; contextualMeaning: string; partOfSpeech: string }[]
  phrases: { meaning: string }[]
  modifiers: { explanation: string }[]
  clauses: { roleExplanation: string }[]
}

/**
 * Restores "[式 (N)]" display form within the LLM-GENERATED free-text explanation fields
 * only (item 12/13 option B: presentation-layer-only conversion). Deliberately does NOT
 * touch `originalText`/`normalizedText` or any span-derived `.text` excerpt (sentenceCore,
 * chunks, modifiers[].phrase, clauses[].span, phrases[].span) — those remain in the
 * analysis-facing ("[EQUATION_5]") form their character offsets were resolved against.
 */
export function restoreEquationPlaceholdersInFreeText<T extends FreeTextAnalysisFields>(analysis: T): T {
  return {
    ...analysis,
    readingHint: analysis.readingHint.map(restoreEquationPlaceholdersForDisplay),
    referenceTranslation: analysis.referenceTranslation === null ? null : restoreEquationPlaceholdersForDisplay(analysis.referenceTranslation),
    vocabulary: analysis.vocabulary.map((v) => ({ ...v, contextualMeaning: restoreEquationPlaceholdersForDisplay(v.contextualMeaning) })),
    phrases: analysis.phrases.map((p) => ({ ...p, meaning: restoreEquationPlaceholdersForDisplay(p.meaning) })),
    modifiers: analysis.modifiers.map((m) => ({ ...m, explanation: restoreEquationPlaceholdersForDisplay(m.explanation) })),
    clauses: analysis.clauses.map((c) => ({ ...c, roleExplanation: restoreEquationPlaceholdersForDisplay(c.roleExplanation) })),
  }
}
