import { describe, expect, it } from 'vitest'
import { classifyPageLines, extractPageLines, normalizeLineText, type PageLine, type RawTextItem } from '../../src/features/pdf/domain/pageTextClassifier'

// Prototype 2.4A item 40 — header/footer/page-number classification tests.

function item(str: string, y: number, height = 10, hasEOL = false, x = 0, width = 50): RawTextItem {
  return { str, transform: [1, 0, 0, 1, x, y], height, width, hasEOL }
}

const PAGE_HEIGHT = 792 // a typical US-letter PDF page height in points
const PAGE_WIDTH = 612 // a typical US-letter PDF page width in points

describe('extractPageLines', () => {
  it('groups items into lines using hasEOL, joining with a single space', () => {
    const items = [item('Hello', 700, 10, false), item('World', 700, 10, true), item('Second', 650, 10, true)]
    const lines = extractPageLines(items, PAGE_HEIGHT)
    expect(lines.map((l) => l.text)).toEqual(['Hello World', 'Second'])
  })

  it('computes yTop/yBottom as top-down fractions (y increases upward in PDF space)', () => {
    // A line at y=782..792 (height 10) sits right at the very top of a 792pt page.
    const lines = extractPageLines([item('Top line', 782, 10, true)], PAGE_HEIGHT)
    expect(lines[0].yTop).toBeCloseTo(0, 2)
    expect(lines[0].yBottom).toBeCloseTo(0.0126, 2)
  })

  it('skips a flush with no accumulated text', () => {
    const lines = extractPageLines([item('', 700, 10, true)], PAGE_HEIGHT)
    expect(lines).toEqual([])
  })

  it('flushes a trailing line even without a final hasEOL', () => {
    const lines = extractPageLines([item('No trailing EOL', 700, 10, false)], PAGE_HEIGHT)
    expect(lines).toEqual([
      {
        text: 'No trailing EOL',
        yTop: expect.any(Number),
        yBottom: expect.any(Number),
        xStart: expect.any(Number),
        xEnd: expect.any(Number),
        fontHeight: expect.any(Number),
      },
    ])
  })

  it('computes xStart/xEnd as normalized (0-1) horizontal extent (item 6)', () => {
    const lines = extractPageLines([item('Left col', 700, 10, true, 43, 200)], PAGE_HEIGHT, PAGE_WIDTH)
    expect(lines[0].xStart).toBeCloseTo(43 / PAGE_WIDTH, 3)
    expect(lines[0].xEnd).toBeCloseTo((43 + 200) / PAGE_WIDTH, 3)
  })

  it('computes fontHeight as the median item height within the line (item 6/R5B)', () => {
    const lines = extractPageLines([item('Body text', 700, 9.96, true)], PAGE_HEIGHT)
    expect(lines[0].fontHeight).toBeCloseTo(9.96, 2)
  })
})

describe('normalizeLineText', () => {
  it('trims, collapses whitespace, and lowercases', () => {
    expect(normalizeLineText('  L. Giglio  et   al.  ')).toBe('l. giglio et al.')
  })
})

function line(text: string, yTop: number, yBottom = yTop + 0.02): PageLine {
  return { text, yTop, yBottom, xStart: 0, xEnd: 0.5, fontHeight: 9.96 }
}

describe('classifyPageLines — item 40 scenarios', () => {
  it('A: a running header repeated (same text, same position) on 3 pages -> REPEATED_HEADER', () => {
    const headerText = 'L. Giglio et al. / Remote Sensing of Environment 178 (2016) 31-41'
    const current = [line(headerText, 0.03)]
    const neighbors = [
      { pageDistance: -2, lines: [line(headerText, 0.03)] },
      { pageDistance: -1, lines: [line(headerText, 0.03)] },
      { pageDistance: 1, lines: [line(headerText, 0.03)] },
    ]
    const result = classifyPageLines(current, neighbors)
    expect(result[0].classification).toBe('REPEATED_HEADER')
  })

  it('B: a unique page-top body line (no repetition elsewhere) -> BODY/UNKNOWN, kept', () => {
    const current = [line('The proposed method was evaluated using several datasets.', 0.03)]
    const neighbors = [
      { pageDistance: -1, lines: [line('An entirely different opening sentence here.', 0.03)] },
      { pageDistance: 1, lines: [line('Yet another unrelated line at the top.', 0.03)] },
    ]
    const result = classifyPageLines(current, neighbors)
    expect(['BODY', 'UNKNOWN']).toContain(result[0].classification)
  })

  it('C: a section heading at page top with no repetition -> kept (never REPEATED_HEADER)', () => {
    const current = [line('3. Results', 0.03)]
    const neighbors = [
      { pageDistance: -1, lines: [line('2. Methods', 0.03)] },
      { pageDistance: 1, lines: [line('4. Discussion', 0.03)] },
    ]
    const result = classifyPageLines(current, neighbors)
    expect(result[0].classification).not.toBe('REPEATED_HEADER')
  })

  it('D: a table caption at page top with no repetition -> kept', () => {
    const current = [line('Table 1. Summary of active fire products.', 0.03)]
    const neighbors = [
      { pageDistance: -1, lines: [line('Figure 2. Detection accuracy by region.', 0.03)] },
      { pageDistance: 1, lines: [line('An unrelated body sentence.', 0.03)] },
    ]
    const result = classifyPageLines(current, neighbors)
    expect(result[0].classification).not.toBe('REPEATED_HEADER')
    expect(result[0].classification).not.toBe('REPEATED_FOOTER')
  })

  it('E: a repeated footer -> REPEATED_FOOTER', () => {
    const footerText = 'Journal of Remote Sensing'
    const current = [line(footerText, 0.95)]
    const neighbors = [
      { pageDistance: -1, lines: [line(footerText, 0.95)] },
      { pageDistance: 1, lines: [line(footerText, 0.95)] },
    ]
    const result = classifyPageLines(current, neighbors)
    expect(result[0].classification).toBe('REPEATED_FOOTER')
  })

  it('F: isolated sequential page numbers across neighbor pages -> PAGE_NUMBER', () => {
    const current = [line('33', 0.96)]
    const neighbors = [
      { pageDistance: -1, lines: [line('32', 0.96)] },
      { pageDistance: 1, lines: [line('34', 0.96)] },
    ]
    const result = classifyPageLines(current, neighbors)
    expect(result[0].classification).toBe('PAGE_NUMBER')
  })

  it('G: an isolated NON-sequential number -> kept, never PAGE_NUMBER (false-positive protection)', () => {
    const current = [line('7', 0.96)]
    const neighbors = [
      { pageDistance: -1, lines: [line('Table 1', 0.96)] },
      { pageDistance: 1, lines: [line('discussion continues here', 0.96)] },
    ]
    const result = classifyPageLines(current, neighbors)
    expect(result[0].classification).not.toBe('PAGE_NUMBER')
  })

  it('a line entirely outside the margin bands is always BODY, regardless of repetition', () => {
    const repeatedMidPageText = 'This sentence happens to repeat verbatim in the middle of the page.'
    const current = [line(repeatedMidPageText, 0.5)]
    const neighbors = [
      { pageDistance: -1, lines: [line(repeatedMidPageText, 0.5)] },
      { pageDistance: 1, lines: [line(repeatedMidPageText, 0.5)] },
    ]
    const result = classifyPageLines(current, neighbors)
    expect(result[0].classification).toBe('BODY')
  })

  it('requires at least 2 repeating neighbors -- exactly 1 match is not enough (item 15.C "複数ページ")', () => {
    const headerText = 'Running Header Text'
    const current = [line(headerText, 0.03)]
    const neighbors = [{ pageDistance: -1, lines: [line(headerText, 0.03)] }]
    const result = classifyPageLines(current, neighbors)
    expect(result[0].classification).not.toBe('REPEATED_HEADER')
  })

  it('a Y-position mismatch on the neighbor page does not count as a repeat', () => {
    const headerText = 'Running Header Text'
    const current = [line(headerText, 0.03)]
    const neighbors = [
      { pageDistance: -1, lines: [line(headerText, 0.5)] }, // same text, wrong position
      { pageDistance: 1, lines: [line(headerText, 0.5)] },
    ]
    const result = classifyPageLines(current, neighbors)
    expect(result[0].classification).not.toBe('REPEATED_HEADER')
  })
})
