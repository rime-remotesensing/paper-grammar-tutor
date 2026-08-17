/**
 * Prototype 2.5H — removes numeric bibliographic citation markers ("[9]", "[1]–[3], [9],
 * [11]") from the sentence sent to grammar analysis. Citations are metadata, not
 * grammatical constituents (product decision) — they stay fully visible in the source
 * textarea/PDF, but must never appear as a clause/object/complement/modifier node.
 *
 * Deliberately narrow, matching the same "high-confidence only" discipline as
 * services/pymupdf_layout's equation-number guard: a citation token is a bracket
 * containing ONLY digits ("[9]"), nothing else. "[Equation]", "[x]", "[see Appendix A]",
 * "[式 (5)]", "[EQUATION_5]", and malformed lookalikes ("[9a]", "[1-foo]") never match —
 * their bracket contents aren't purely digits, so this never needs to know about equation
 * placeholders specifically to leave them alone (item 10/22: order-independent by
 * construction, not by careful sequencing).
 *
 * A run of citation tokens joined by a range dash ("[1]–[3]") or list commas
 * ("[9], [11]") is removed as ONE unit (item 8), together with exactly one adjacent
 * whitespace character, so removal never leaves double spaces or a dangling leading space
 * before trailing punctuation (item 7/19).
 */

const CITATION_TOKEN = '\\[\\d{1,4}\\]'
const CITATION_CONNECTOR = '(?:\\s*[\\u2013-]\\s*|\\s*,\\s*)' // en dash (–) or hyphen for ranges; comma for lists
const CITATION_SEQUENCE_SOURCE = `${CITATION_TOKEN}(?:${CITATION_CONNECTOR}${CITATION_TOKEN})*`

/** "...as a moderator [9] for..." -> "...as a moderator for..."
 *  "...areas [1]–[3], [9], [11] and..." -> "...areas and..." */
export function removeCitationMarkersForAnalysis(text: string): string {
  let result = text
    // The overwhelmingly common shape: citation(s) preceded by a space ("word [9]") —
    // remove the sequence together with that leading space.
    .replace(new RegExp(`\\s+(?:${CITATION_SEQUENCE_SOURCE})`, 'g'), '')
    // Fallback: a citation sequence opening the string, with no leading space to consume —
    // remove it together with one trailing space instead.
    .replace(new RegExp(`^(?:${CITATION_SEQUENCE_SOURCE})\\s*`), '')
  // Safety net: collapse any doubled spaces the removal might still have left behind
  // (e.g. two adjacent, independently-removed citation groups).
  result = result.replace(/[ \t]{2,}/g, ' ')
  return result.trim()
}
