import { describe, expect, it } from 'vitest'
import { buildFilteredFragmentText, buildNuisancePredicate, combineFragments, type SelectionFragment } from '../../src/features/pdf/domain/crossPageSelection'
import type { PdfSelectionResult } from '../../src/features/pdf/domain/pdfViewerState'

// Prototype 2.4A item 43 — header/page-number filtering within a selection fragment, plus
// item 41's multi-fragment join, exercised through the actual production pipeline function.

function selection(overrides: Partial<PdfSelectionResult> = {}): PdfSelectionResult {
  return {
    rawText: '',
    normalizedText: '',
    pageNumber: 2,
    ocrRects: [],
    scientificTokens: [],
    ...overrides,
  }
}

describe('buildFilteredFragmentText — item 43', () => {
  it('strips a header line and a page-number line, keeping only the body line', () => {
    const rawText = 'L. Giglio et al. / Remote Sensing of Environment 178 (2016) 31-41\n32\nindependent datasets collected during the summer.'
    const isNuisance = (normalized: string) =>
      normalized === 'l. giglio et al. / remote sensing of environment 178 (2016) 31-41' || normalized === '32'
    expect(buildFilteredFragmentText(rawText, isNuisance)).toBe('independent datasets collected during the summer.')
  })

  it('keeps everything when nothing is classified as nuisance (clean user selection, item 25)', () => {
    const rawText = 'independent datasets collected during the summer.'
    expect(buildFilteredFragmentText(rawText, () => false)).toBe('independent datasets collected during the summer.')
  })

  it('joins wrap-hyphenation across a filtered boundary via the existing normalizer', () => {
    const rawText = '32\nindependent data-\nsets collected.'
    const isNuisance = (normalized: string) => normalized === '32'
    expect(buildFilteredFragmentText(rawText, isNuisance)).toBe('independent datasets collected.')
  })

  it('does not strip a line that merely resembles nuisance text but was not classified as such', () => {
    const rawText = '3. Results\nindependent datasets collected during the summer.'
    expect(buildFilteredFragmentText(rawText, () => false)).toBe('3. Results independent datasets collected during the summer.')
  })
})

describe('buildNuisancePredicate', () => {
  it('flags only REPEATED_HEADER/REPEATED_FOOTER/PAGE_NUMBER, never BODY/UNKNOWN', () => {
    const predicate = buildNuisancePredicate([
      { text: 'Running Header', classification: 'REPEATED_HEADER' },
      { text: '32', classification: 'PAGE_NUMBER' },
      { text: 'Footer text', classification: 'REPEATED_FOOTER' },
      { text: 'Table 1', classification: 'UNKNOWN' },
      { text: 'body sentence', classification: 'BODY' },
    ])
    expect(predicate('running header')).toBe(true)
    expect(predicate('32')).toBe(true)
    expect(predicate('footer text')).toBe(true)
    expect(predicate('table 1')).toBe(false)
    expect(predicate('body sentence')).toBe(false)
  })

  it('Prototype 2.4B: matches the same header even when spacing around punctuation differs between the classifier text and the raw selection text', () => {
    // Discovered via live-data simulation against a real Elsevier/MDPI PDF (item 51):
    // extractPageLines joins pdf.js text items with a literal space between every pair
    // ("Remote Sens. 2016 , 8 , 535"), but a real browser Range.toString() over the same
    // items produces no artificial space before punctuation ("Remote Sens. 2016, 8, 535").
    // Both are the same header; the predicate must recognize both spellings.
    const predicate = buildNuisancePredicate([{ text: 'Remote Sens. 2016 , 8 , 535 2 of 13', classification: 'REPEATED_HEADER' }])
    expect(predicate('remote sens. 2016 , 8 , 535 2 of 13')).toBe(true) // classifier's own spacing
    expect(predicate('remote sens. 2016, 8, 535 2 of 13')).toBe(true) // raw-selection spacing
  })

  it('does not turn the whitespace-insensitive fallback into a fuzzy match across genuinely different text', () => {
    const predicate = buildNuisancePredicate([{ text: 'Remote Sens. 2016, 8, 535', classification: 'REPEATED_HEADER' }])
    expect(predicate('a completely unrelated body sentence')).toBe(false)
  })
})

describe('combineFragments', () => {
  it('joins two page fragments into one sentence', () => {
    const fragments: SelectionFragment[] = [
      { pageNumber: 5, selection: selection({ pageNumber: 5 }), filteredText: 'The proposed method was evaluated using several' },
      { pageNumber: 6, selection: selection({ pageNumber: 6 }), filteredText: 'independent datasets collected during the summer.' },
    ]
    expect(combineFragments(fragments)).toBe(
      'The proposed method was evaluated using several independent datasets collected during the summer.',
    )
  })

  it('supports three fragments (item 5: not limited to two pages)', () => {
    const fragments: SelectionFragment[] = [
      { pageNumber: 5, selection: selection(), filteredText: 'The proposed method' },
      { pageNumber: 6, selection: selection(), filteredText: 'was evaluated using several' },
      { pageNumber: 7, selection: selection(), filteredText: 'independent datasets collected during the summer.' },
    ]
    expect(combineFragments(fragments)).toBe(
      'The proposed method was evaluated using several independent datasets collected during the summer.',
    )
  })

  it('returns an empty string for zero fragments', () => {
    expect(combineFragments([])).toBe('')
  })
})
