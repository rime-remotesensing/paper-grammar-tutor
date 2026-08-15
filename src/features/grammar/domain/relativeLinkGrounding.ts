import type { Span } from '../schemas/grammarAnalysis.schema.ts'
import type { LlmFocusedRelativeLinkRelation, RelativeWord } from '../schemas/focusedRelativeLink.schema.ts'

/** A relation whose three text fields have all been grounded to exact source spans and
 * passed mechanical sanity (item 12) — the only shape presentation code is allowed to use. */
export interface GroundedRelativeLinkRelation {
  antecedent: string
  relativeWord: RelativeWord
  relativeClause: string
  antecedentSpan: Span
  relativeWordSpan: Span
  relativeClauseSpan: Span
}

const PERMITTED_RELATIVE_WORDS = new Set<RelativeWord>(['that', 'which', 'who'])

/**
 * Finds the exact substring `needle` in `haystack`, starting the search at or after
 * `fromIndex` (item 11: source-grounded only, no LLM offsets trusted). Returns null if the
 * LLM's text isn't a literal substring of the original sentence at all.
 */
function resolveSpan(haystack: string, needle: string, fromIndex: number): Span | null {
  if (!needle) return null
  const start = haystack.indexOf(needle, fromIndex)
  if (start < 0) return null
  return { text: needle, start, end: start + needle.length }
}

/**
 * Grounds one raw LLM relation against `originalText` and applies mechanical sanity (item
 * 12) — the exact checklist from the 2.3O order:
 * 1-3. antecedent/relativeWord/relativeClause all resolve to a literal substring.
 * 4. relativeWord span sits within relativeClause span.
 * 5. relativeClause starts exactly at relativeWord's own span (2.3N validated this holds
 *    reliably across 200+ live runs; no fuzzy whitespace/punctuation slack needed in
 *    practice, so none is taken — item 13's "exact relation over fuzzy" principle).
 * 6. antecedent ends at/before relativeClause starts.
 * 7. relativeWord is one of the 3 production-scope words -- defense in depth even though
 *    the Zod/JSON schema already restrict this at generation time (item 10's "schema AND
 *    mechanical validation" requirement; this is the exact check whose ABSENCE let the
 *    Prototype 2.3N zero-relative hallucination ("we" reported as relativeWord) slip through
 *    the spike's original, more permissive string-only schema).
 *
 * Returns null (discard) on any failure -- never partially trusts a relation.
 */
export function groundRelativeLinkRelation(
  originalText: string,
  relation: LlmFocusedRelativeLinkRelation,
): GroundedRelativeLinkRelation | null {
  if (!PERMITTED_RELATIVE_WORDS.has(relation.relativeWord)) return null

  const antecedentSpan = resolveSpan(originalText, relation.antecedent, 0)
  if (!antecedentSpan) return null
  const relativeWordSpan = resolveSpan(originalText, relation.relativeWord, antecedentSpan.end)
  if (!relativeWordSpan) return null
  const relativeClauseSpan = resolveSpan(originalText, relation.relativeClause, antecedentSpan.end)
  if (!relativeClauseSpan) return null

  if (relativeWordSpan.start !== relativeClauseSpan.start) return null
  if (relativeWordSpan.end > relativeClauseSpan.end) return null
  if (antecedentSpan.end > relativeClauseSpan.start) return null

  return {
    antecedent: relation.antecedent,
    relativeWord: relation.relativeWord,
    relativeClause: relation.relativeClause,
    antecedentSpan,
    relativeWordSpan,
    relativeClauseSpan,
  }
}

/** Grounds every relation in a raw LLM result, silently dropping any that fail (item 12:
 * "失敗relationはdiscard" — never surfaces a partial/invalid relation to presentation). */
export function groundRelativeLinkRelations(
  originalText: string,
  relations: LlmFocusedRelativeLinkRelation[],
): GroundedRelativeLinkRelation[] {
  const grounded: GroundedRelativeLinkRelation[] = []
  for (const r of relations) {
    const g = groundRelativeLinkRelation(originalText, r)
    if (g) grounded.push(g)
  }
  return grounded
}
