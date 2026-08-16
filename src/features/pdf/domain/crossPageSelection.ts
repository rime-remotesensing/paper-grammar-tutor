import type { PdfSelectionResult } from './pdfViewerState.ts'
import { normalizePdfSelectionText } from '../utils/pdfTextNormalize.ts'
import { normalizeLineText } from './pageTextClassifier.ts'
import { joinFragmentTexts } from './fragmentJoin.ts'

/**
 * Prototype 2.4A — one page's contribution to a cross-page selection (item 6). Wraps the
 * EXISTING, unchanged `PdfSelectionResult` rather than inventing a parallel geometry/text
 * shape — `filteredText` is the only new derived value, computed once when the fragment is
 * finalized (marginal-text stripped, then run through the same, unchanged
 * `normalizePdfSelectionText` every single-page selection already uses).
 */
export interface SelectionFragment {
  pageNumber: number
  selection: PdfSelectionResult
  filteredText: string
}

/**
 * Strips any raw-text line whose normalized form the caller's classifier flagged as nuisance
 * (item 24: only REPEATED_HEADER/REPEATED_FOOTER/PAGE_NUMBER — BODY/UNKNOWN always survive),
 * then runs the survivors through the same normalization every ordinary single-page
 * selection already goes through. Operates on `rawText` (still newline-delimited per visual
 * line) rather than `normalizedText` (which has already collapsed line breaks into spaces by
 * the time a plain PdfSelectionResult reaches this function) — line-level filtering has to
 * happen before that collapse.
 */
export function buildFilteredFragmentText(rawText: string, isNuisanceLine: (normalizedLine: string) => boolean): string {
  const survivingLines = rawText.split('\n').filter((line) => !isNuisanceLine(normalizeLineText(line)))
  return normalizePdfSelectionText(survivingLines.join('\n'))
}

/** Collapses ALL whitespace (not just runs of it) -- a fallback comparison key, see
 * `buildNuisancePredicate`'s doc comment for why this is needed on top of
 * `normalizeLineText`'s ordinary space-collapsing. */
function stripAllWhitespace(text: string): string {
  return text.replace(/\s+/g, '')
}

/**
 * Builds a nuisance-line predicate from already-classified lines (item 24) — the only
 * classifications ever stripped are REPEATED_HEADER/REPEATED_FOOTER/PAGE_NUMBER; BODY and
 * UNKNOWN are never matched, so they always survive `buildFilteredFragmentText`.
 *
 * Prototype 2.4B: matches on BOTH the ordinary space-normalized text AND an all-whitespace-
 * stripped fallback. Discovered via live-data simulation (real Elsevier/MDPI PDFs, item 51):
 * the classified nuisance line's text comes from `extractPageLines`, which joins pdf.js text
 * items with a literal space between every pair ("Remote Sens. 2016 , 8 , 535"); the RAW
 * selection line being checked against it comes from the browser's own `Range.toString()`
 * (no synthetic spacing inserted, since pdf.js's own item text already carries whatever
 * spacing it has — "Remote Sens. 2016, 8, 535", no space before the comma). Both strings
 * are the SAME header, byte-identical apart from where a space happens to land next to
 * punctuation -- `normalizeLineText` alone (collapse, don't insert) can't bridge that, so a
 * whitespace-insensitive fallback comparison is used, still an exact (not fuzzy) match on
 * every non-whitespace character.
 */
export function buildNuisancePredicate(
  classifiedLines: readonly { text: string; classification: string }[],
): (normalizedLine: string) => boolean {
  const nuisanceLines = classifiedLines
    .filter((l) => l.classification === 'REPEATED_HEADER' || l.classification === 'REPEATED_FOOTER' || l.classification === 'PAGE_NUMBER')
    .map((l) => normalizeLineText(l.text))
  const nuisanceTexts = new Set(nuisanceLines)
  const nuisanceTextsStripped = new Set(nuisanceLines.map(stripAllWhitespace))
  return (normalizedLine: string) => nuisanceTexts.has(normalizedLine) || nuisanceTextsStripped.has(stripAllWhitespace(normalizedLine))
}

/** Combines every fragment's already-filtered text into the final sentence (item 5: works
 * for any number of fragments, not just two). */
export function combineFragments(fragments: readonly SelectionFragment[]): string {
  return joinFragmentTexts(fragments.map((f) => f.filteredText))
}
