// Line-wrap hyphenation: a hyphen immediately followed by a line break (with only
// whitespace in between) is almost always a mid-word wrap artifact ("signifi-\ncant"),
// not a real compound word — a genuine compound hyphen ("state-of-the-art") essentially
// never falls exactly at a rendered line boundary. When we can't tell, we leave the
// original text alone rather than guessing.
const WRAP_HYPHENATION = /([A-Za-z])-\s*\n\s*([A-Za-z])/g

/**
 * Minimal normalization for text extracted from a PDF text-layer selection, per the
 * Prototype 1 spec: undo ordinary line-wrap breaks, join wrap-hyphenated words, and
 * collapse irregular whitespace. This is deliberately NOT a general PDF text
 * reconstructor — it does not attempt reading-order recovery, column detection, or
 * anything beyond what a single user selection needs before being handed to
 * GrammarAnalyzer (which still receives the user's own final edit, since the UI lets
 * them review/correct this before analyzing).
 */
export function normalizePdfSelectionText(rawText: string): string {
  return rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(WRAP_HYPHENATION, '$1$2')
    .replace(/\n+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}
