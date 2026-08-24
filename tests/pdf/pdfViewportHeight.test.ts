import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  PDF_VIEWPORT_MIN_HEIGHT,
  clampPdfViewportHeight,
  computeDefaultPdfViewportHeight,
  computePdfViewportMaxHeight,
  readStoredPdfViewportHeight,
  writeStoredPdfViewportHeight,
} from '../../src/features/pdf/domain/pdfViewportHeight.ts'

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    _store: store,
  }
}

describe('Prototype 2.6G2.10 -- computePdfViewportMaxHeight', () => {
  it('is 90% of windowInnerHeight when above the minimum', () => {
    expect(computePdfViewportMaxHeight(1000)).toBeCloseTo(900)
    expect(computePdfViewportMaxHeight(2000)).toBe(1800)
  })

  it('never drops below the minimum height, even for a very short window', () => {
    expect(computePdfViewportMaxHeight(200)).toBe(PDF_VIEWPORT_MIN_HEIGHT)
  })
})

describe('Prototype 2.6G2.10 -- clampPdfViewportHeight', () => {
  it('passes through a value already within [min, max]', () => {
    expect(clampPdfViewportHeight(600, 1000)).toBe(600)
  })

  it('clamps below the minimum up to PDF_VIEWPORT_MIN_HEIGHT', () => {
    expect(clampPdfViewportHeight(100, 1000)).toBe(PDF_VIEWPORT_MIN_HEIGHT)
  })

  it('clamps above the maximum down to computePdfViewportMaxHeight', () => {
    expect(clampPdfViewportHeight(5000, 1000)).toBe(computePdfViewportMaxHeight(1000))
  })

  it('falls back to the default for a non-finite input (never NaN/Infinity)', () => {
    expect(clampPdfViewportHeight(Number.NaN, 1000)).toBe(computeDefaultPdfViewportHeight(1000))
    expect(clampPdfViewportHeight(Number.POSITIVE_INFINITY, 1000)).toBe(computeDefaultPdfViewportHeight(1000))
  })
})

describe('Prototype 2.6G2.10 -- computeDefaultPdfViewportHeight', () => {
  it('is approximately 75% of the window height for an ordinary desktop window', () => {
    expect(computeDefaultPdfViewportHeight(900)).toBeCloseTo(675)
  })

  it('never exceeds the max bound for a very tall window', () => {
    expect(computeDefaultPdfViewportHeight(3000)).toBe(2250)
  })

  it('never drops below the min bound for a short window', () => {
    expect(computeDefaultPdfViewportHeight(300)).toBe(PDF_VIEWPORT_MIN_HEIGHT)
  })
})

describe('Prototype 2.6G2.10 -- readStoredPdfViewportHeight / writeStoredPdfViewportHeight', () => {
  it('round-trips a written value', () => {
    const storage = fakeStorage()
    writeStoredPdfViewportHeight(700, storage)
    expect(readStoredPdfViewportHeight(1000, storage)).toBe(700)
  })

  it('falls back to the default when nothing is stored', () => {
    const storage = fakeStorage()
    expect(readStoredPdfViewportHeight(900, storage)).toBe(computeDefaultPdfViewportHeight(900))
  })

  it('falls back to the default for a corrupt/non-numeric stored value', () => {
    const storage = fakeStorage({ 'paperGrammarTutor.pdfViewportHeight': 'not-a-number' })
    expect(readStoredPdfViewportHeight(900, storage)).toBe(computeDefaultPdfViewportHeight(900))
  })

  it('clamps a stored value that no longer fits the current window (e.g. moved to a smaller monitor)', () => {
    const storage = fakeStorage({ 'paperGrammarTutor.pdfViewportHeight': '5000' })
    expect(readStoredPdfViewportHeight(1000, storage)).toBe(computePdfViewportMaxHeight(1000))
  })

  it('returns the computed default and never throws when storage is unavailable', () => {
    expect(readStoredPdfViewportHeight(900, null)).toBe(computeDefaultPdfViewportHeight(900))
    expect(() => writeStoredPdfViewportHeight(700, null)).not.toThrow()
  })

  it('never throws when storage itself throws (private-browsing quota, etc.)', () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error('quota')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(readStoredPdfViewportHeight(900, throwingStorage)).toBe(computeDefaultPdfViewportHeight(900))
    expect(() => writeStoredPdfViewportHeight(700, throwingStorage)).not.toThrow()
  })
})

/**
 * No component render harness in this codebase -- same source-invariant technique
 * `fitWidthScale.test.ts`/`currentPageTracking.test.ts` already use for PdfViewer.tsx.
 */
describe('Prototype 2.6G2.10 -- PdfViewer.tsx resize-handle integration invariants', () => {
  const source = readFileSync(new URL('../../src/features/pdf/components/PdfViewer.tsx', import.meta.url), 'utf-8')

  it('.pdf-canvas-area gets its height from viewportHeight state, not a hardcoded value', () => {
    expect(source).toMatch(/className="pdf-canvas-area"\s+ref=\{scrollViewportRef\}\s+style=\{\{\s*height:\s*`\$\{viewportHeight\}px`\s*\}\}/)
  })

  it('the resize handle is rendered directly after .pdf-canvas-area, never inside it', () => {
    const canvasAreaOpen = source.indexOf('className="pdf-canvas-area"')
    const canvasAreaClose = source.indexOf('</div>', canvasAreaOpen)
    const handleIndex = source.indexOf('className="pdf-viewport-resize-handle"')
    expect(canvasAreaOpen).toBeGreaterThan(-1)
    expect(handleIndex).toBeGreaterThan(canvasAreaClose)
  })

  it('dragging the resize handle only ever calls setViewportHeight, never setScale/setZoomMode -- height and zoom stay fully independent', () => {
    const start = source.indexOf('const handleViewportResizePointerDown')
    const end = source.indexOf('const docRef = useRef<PDFDocumentProxy | null>(null)')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const block = source.slice(start, end)
    expect(block).toContain('setViewportHeight')
    expect(block).not.toContain('setScale')
    expect(block).not.toContain('setZoomMode')
  })

  it('resize drag uses pointer capture on the handle itself, not a window-level listener pair', () => {
    const start = source.indexOf('const handleViewportResizePointerDown')
    const end = source.indexOf('const docRef = useRef<PDFDocumentProxy | null>(null)')
    const block = source.slice(start, end)
    expect(block).toContain('setPointerCapture')
    expect(block).toContain('releasePointerCapture')
    expect(block).not.toMatch(/window\.addEventListener\('pointermove'/)
  })

  it('double-click resets to the computed default height and persists it', () => {
    const start = source.indexOf('const handleViewportResizeDoubleClick')
    const end = source.indexOf('const docRef = useRef<PDFDocumentProxy | null>(null)')
    expect(start).toBeGreaterThan(-1)
    const block = source.slice(start, end)
    expect(block).toContain('computeDefaultPdfViewportHeight(window.innerHeight)')
    expect(block).toContain('writeStoredPdfViewportHeight')
  })

  it('the height dragged/persisted is clamped through clampPdfViewportHeight, never applied raw', () => {
    const start = source.indexOf('const handleViewportResizePointerMove')
    const end = source.indexOf('const handleViewportResizePointerUp')
    const block = source.slice(start, end)
    expect(block).toContain('clampPdfViewportHeight(')
  })
})

describe('Prototype 2.6G2.10 -- App.css invariants', () => {
  const css = readFileSync(new URL('../../src/App.css', import.meta.url), 'utf-8')

  it('.pdf-canvas-area no longer has a fixed vh max-height (replaced by the inline, user-adjustable height)', () => {
    const start = css.indexOf('.pdf-canvas-area {')
    const end = css.indexOf('}', start)
    const rule = css.slice(start, end)
    expect(rule).not.toMatch(/max-height\s*:\s*\d/)
    expect(rule).toContain('overflow: auto')
  })

  it('the resize handle uses an ns-resize cursor', () => {
    const start = css.indexOf('.pdf-viewport-resize-handle {')
    const end = css.indexOf('}', start)
    expect(start).toBeGreaterThan(-1)
    expect(css.slice(start, end)).toContain('cursor: ns-resize')
  })
})
