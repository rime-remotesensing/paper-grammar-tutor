/**
 * Prototype 2.5H — removes numeric bibliographic citation markers ("[9]", "[1]–[3], [9],
 * [11]") from the sentence sent to grammar analysis. Citations are metadata, not
 * grammatical constituents (product decision) — they stay fully visible in the source
 * textarea/PDF, but must never appear as a clause/object/complement/modifier node.
 * Parenthetical author-year citations ("(Smith et al., 2020; Jones, 2021)") are removed
 * under the same policy -- see `AUTHOR_YEAR_CITATION_SOURCE` below.
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
import { collapseInternalSpaces, removeMatches, type Projection } from './textProjection.ts'

const CITATION_TOKEN = '\\[\\d{1,4}\\]'
const CITATION_CONNECTOR = '(?:\\s*[\\u2013-]\\s*|\\s*,\\s*)' // en dash (–) or hyphen for ranges; comma for lists
// Prototype 2.6G2.8A: a citation list/range can also be written as ONE bracket containing
// multiple numbers joined internally by a dash/en dash (range, "[3-6]"/"[3–6]") or comma
// (list, "[5, 7]") -- distinct from the sequence-of-separate-brackets shape above
// ("[5], [7]"), which papers also use. Requires at least two numbers so this never
// re-matches a plain "[9]" a second way, and "\d{1,4}" on both sides of the connector keeps
// a malformed lookalike like "[1-foo]" unmatched (item 30's own existing negative control).
const CITATION_LIST_TOKEN = `\\[\\d{1,4}(?:${CITATION_CONNECTOR}\\d{1,4})+\\]`
const CITATION_UNIT = `(?:${CITATION_LIST_TOKEN}|${CITATION_TOKEN})`
const CITATION_SEQUENCE_SOURCE = `${CITATION_UNIT}(?:${CITATION_CONNECTOR}${CITATION_UNIT})*`

// Parenthetical author-year citations: "(Smith, 2020)", "(Smith et al., 2020)",
// "(Smith, 2020; Jones & Brown, 2021)". Left in the analysis text, Stanza parses the authors
// as real syntax (dep/conj/nmod of the preceding noun) and the Tree surfaces each surname as a
// coordination member. Same "high-confidence only" discipline as the numeric rule: the WHOLE
// parenthetical must consist of citation items and nothing else, and every item must end in a
// year, so "(2000)", "(n = 2000)", "(ML)", "(Fig. 2)", "(A and B)", "(Smith)" and
// "(2020–2022)" can never match.
//  - surname: one capitalized word (Unicode letters, apostrophes, hyphens -- "García",
//    "O'Connor", "Li", "Smith-Jones"), optionally preceded by lowercase name particles
//    ("van der Meer", "de la Cruz"). Deliberately never a multi-word capitalized phrase, so an
//    ordinary "(Machine Learning, 2020)"-style aside is not mistaken for an author.
//  - item: "Surname et al.[,] Year" (comma optional -- "et al." alone is decisive), or
//    "Surname[ & / and Surname], Year" (comma required); one or more comma-joined years,
//    each optionally lettered ("2020a").
//  - items are joined by semicolons.
const NAME_PARTICLE = '(?:(?:van|von|der|den|de|del|della|da|di|du|dos|la|le|ten|ter)\\s+)*'
const SURNAME = `${NAME_PARTICLE}\\p{Lu}[\\p{L}\\p{M}'\\u2019-]*`
const CITATION_YEAR = '(?:1[5-9]|20)\\d{2}[a-z]?'
const CITATION_YEARS = `${CITATION_YEAR}(?:\\s*,\\s*${CITATION_YEAR})*`
const AUTHOR_YEAR_ITEM = `(?:${SURNAME}\\s+et\\s+al\\.,?\\s*${CITATION_YEARS}|${SURNAME}(?:\\s*(?:&|and)\\s*${SURNAME})?,\\s*${CITATION_YEARS})`
const AUTHOR_YEAR_CITATION_SOURCE = `\\(\\s*${AUTHOR_YEAR_ITEM}(?:\\s*;\\s*${AUTHOR_YEAR_ITEM})*\\s*\\)`

/** "...as a moderator [9] for..." -> "...as a moderator for..."
 *  "...areas [1]–[3], [9], [11] and..." -> "...areas and..."
 *  "...multiple models (Smith, 2020; Jones et al., 2021)." -> "...multiple models." */
export function removeCitationMarkersForAnalysis(text: string): string {
  let result = text
    // The overwhelmingly common shape: citation(s) preceded by a space ("word [9]") —
    // remove the sequence together with that leading space.
    .replace(new RegExp(`\\s+(?:${CITATION_SEQUENCE_SOURCE})`, 'g'), '')
    // Fallback: a citation sequence opening the string, with no leading space to consume —
    // remove it together with one trailing space instead.
    .replace(new RegExp(`^(?:${CITATION_SEQUENCE_SOURCE})\\s*`), '')
    // The same two shapes for a parenthetical author-year citation.
    .replace(new RegExp(`\\s+${AUTHOR_YEAR_CITATION_SOURCE}`, 'gu'), '')
    .replace(new RegExp(`^${AUTHOR_YEAR_CITATION_SOURCE}\\s*`, 'u'), '')
  // Safety net: collapse any doubled spaces the removal might still have left behind
  // (e.g. two adjacent, independently-removed citation groups).
  result = result.replace(/[ \t]{2,}/g, ' ')
  return result.trim()
}

/**
 * Prototype 2.6G2.8E — `Projection`-carrying twin of `removeCitationMarkersForAnalysis`,
 * mirroring its exact same three-step regex sequence (space-preceded removal, start-anchored
 * removal, double-space collapse -- `.trim()` is intentionally NOT applied here; the shared
 * pipeline in grammarInputNormalization.ts trims once, at the very end, after every step).
 * Reuses the SAME `CITATION_SEQUENCE_SOURCE`/`AUTHOR_YEAR_CITATION_SOURCE` patterns so the two
 * functions can never drift apart -- this is not a reimplementation of the citation rule,
 * only of how its removal is recorded against the source mapping.
 */
export function removeCitationMarkersFromProjection(input: Projection): Projection {
  let result = removeMatches(input, new RegExp(`\\s+(?:${CITATION_SEQUENCE_SOURCE})`, 'g'))
  result = removeMatches(result, new RegExp(`^(?:${CITATION_SEQUENCE_SOURCE})\\s*`, 'g'))
  result = removeMatches(result, new RegExp(`\\s+${AUTHOR_YEAR_CITATION_SOURCE}`, 'gu'))
  result = removeMatches(result, new RegExp(`^${AUTHOR_YEAR_CITATION_SOURCE}\\s*`, 'gu'))
  result = collapseInternalSpaces(result)
  return result
}
