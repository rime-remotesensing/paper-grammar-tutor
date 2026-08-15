/**
 * Prototype 2.3D item 9/10 — CONSERVATIVE, presentation-only parser for a coordination
 * list living INSIDE a single node's text (e.g. a subjectModifier leaf like "of California
 * buckwheat, white peppermint and sycamore"). This is deliberately NOT a general English
 * coordination parser (item 10 explicitly forbids building one): it only recognizes the
 * single, unambiguous "A, B and C" / "A, B, and C" shape — one comma-separated run ending
 * in exactly one "and"/"or". Anything else (zero or 2+ conjunctions, an empty head/tail)
 * returns null, and the caller falls back to showing the original text on one line
 * unmodified (item 10: "分割しない方を優先"; item 11: raw text is never altered).
 */

const FINAL_CONJUNCTION = /\s+(and|or)\s+/gi

/**
 * Small, FIXED, closed set of common short prepositions — not a POS tagger. Only used to
 * visually hoist a leading preposition (e.g. "of" in "of California buckwheat, white
 * peppermint and sycamore") out of the first list item for display; if the leading word
 * isn't in this set, it simply stays attached to the first item instead (no guessing
 * beyond this fixed vocabulary — item 10's conservatism applies here too).
 */
const LEADING_PREPOSITIONS = new Set([
  'of', 'in', 'on', 'with', 'for', 'by', 'at', 'under', 'over', 'between', 'among', 'from', 'to', 'about',
])

export interface ParsedCoordinationList {
  /** A literal leading substring of the original text (e.g. "of"), or null. Never
   * fabricated — always exactly the first whitespace-delimited word of the text. */
  prefix: string | null
  /** Each item is a literal substring of the original text (after removing prefix/commas/
   * the conjunction word itself) — see item 11: raw source text is never altered, only
   * re-segmented for display. */
  items: string[]
  /** The literal conjunction word found ("and" or "or"), case as it appeared in source. */
  conjunction: string
}

export function parseSimpleCoordinationList(text: string): ParsedCoordinationList | null {
  const matches = [...text.matchAll(FINAL_CONJUNCTION)]
  if (matches.length !== 1) return null // zero or ambiguous (2+) conjunctions -> no split

  const [match] = matches
  const conjunction = match[1]
  const head = text.slice(0, match.index).trim()
  const tail = text.slice(match.index + match[0].length).trim()
  if (!head || !tail) return null

  const headParts = head
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  if (headParts.length === 0) return null

  let items = [...headParts, tail]
  let prefix: string | null = null

  const firstWords = items[0].split(/\s+/)
  if (firstWords.length >= 2 && LEADING_PREPOSITIONS.has(firstWords[0].toLowerCase())) {
    prefix = firstWords[0]
    items = [firstWords.slice(1).join(' '), ...items.slice(1)]
  }

  if (items.length < 2 || items.some((item) => item.length === 0)) return null

  return { prefix, items, conjunction }
}
