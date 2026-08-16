/**
 * Prototype 2.4A item 26-30 — pure text-joining rules for combining cross-page selection
 * fragments into one flowing sentence. Deterministic, no LLM, no dictionary-based guessing
 * (item 30) — original text fidelity is the priority, never reconstructed wording.
 */

const SOFT_HYPHEN = '­'
/** Punctuation a next fragment can start with where inserting a boundary space would be
 * wrong (item 27): "the sensor" + ", which measured" must join as "the sensor, which
 * measured", not "the sensor , which measured". */
const LEADING_PUNCTUATION = /^[,.;:)\]]/

function joinTwo(a: string, b: string): string {
  if (a.length === 0) return b
  if (b.length === 0) return a
  // Item 28: an explicit soft hyphen is an invisible mid-word wrap marker -- safe to strip
  // and join solid ("charac­teristics" -> "characteristics").
  if (a.endsWith(SOFT_HYPHEN)) return a.slice(0, -1) + b
  // Item 29: a VISIBLE hyphen is never auto-removed or dictionary-guessed -- "high-" +
  // "resolution" and "charac-" + "teristics" are structurally identical from the printed
  // text alone, so both are joined with no boundary space, keeping the hyphen exactly as
  // printed ("high-resolution" / "charac-teristics") rather than guessing which is a
  // genuine compound and which is a wrap artifact.
  if (a.endsWith('-')) return a + b
  if (LEADING_PUNCTUATION.test(b)) return a + b
  return `${a} ${b}`
}

/**
 * Joins fragment texts (already individually trimmed/normalized by the caller) into one
 * sentence, trimming each piece and collapsing the boundary to a single space by default
 * (item 26), skipping empty fragments entirely.
 */
export function joinFragmentTexts(texts: readonly string[]): string {
  return texts
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .reduce((acc, t) => joinTwo(acc, t), '')
}
