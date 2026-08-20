import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { selectCurrentPageByScroll, type PageGeometry } from '../../src/features/pdf/domain/currentPageTracking.ts'

/**
 * Prototype 2.6G2.7C track A -- deterministic scroll-geometry current-page selection.
 * `selectCurrentPageByScroll` replaces the IntersectionObserver-based approach entirely (two
 * prior attempts, 2.7A and 2.7B, were both still ultimately gated by IO's own callback timing
 * and both failed live). This model has no callback/timing dependency: given a content-
 * coordinate geometry snapshot (offsetTop/offsetHeight, comparable directly against
 * scrollTop) and the current scrollTop/clientHeight, it deterministically picks the page whose
 * own vertical center is nearest the viewport's vertical center (A10 items 1-8).
 */
describe('Prototype 2.6G2.7C -- selectCurrentPageByScroll', () => {
  it('(A10.1) viewport at document top -> page 1', () => {
    // Page 1 occupies content [0, 800); at scrollTop 0 with a 800px-tall viewport, its
    // center (400) exactly matches the viewport center (400).
    const pages: PageGeometry[] = [
      { pageNumber: 1, offsetTop: 0, offsetHeight: 800 },
      { pageNumber: 2, offsetTop: 800, offsetHeight: 800 },
    ]
    expect(selectCurrentPageByScroll(pages, 0, 800)).toBe(1)
  })

  it('(A10.2) viewport center falls inside page 2 -> page 2', () => {
    const pages: PageGeometry[] = [
      { pageNumber: 1, offsetTop: 0, offsetHeight: 800 },
      { pageNumber: 2, offsetTop: 800, offsetHeight: 800 },
      { pageNumber: 3, offsetTop: 1600, offsetHeight: 800 },
    ]
    // scrollTop 750, clientHeight 800 -> viewport center = 1150, inside page 2's [800,1600).
    expect(selectCurrentPageByScroll(pages, 750, 800)).toBe(2)
  })

  it('(A10.3) exactly between two pages resolves deterministically (repeated calls agree)', () => {
    const pages: PageGeometry[] = [
      { pageNumber: 4, offsetTop: 0, offsetHeight: 800 },
      { pageNumber: 5, offsetTop: 800, offsetHeight: 800 },
    ]
    // viewport center sits exactly on the page 4/5 boundary (800) -- an exact tie.
    const first = selectCurrentPageByScroll(pages, 400, 800)
    const second = selectCurrentPageByScroll(pages, 400, 800)
    const third = selectCurrentPageByScroll(pages, 400, 800)
    expect(first).toBe(second)
    expect(second).toBe(third)
  })

  it('(A10.4) scroll sequence 1 -> 5 -> 14 -> 1 resolves correctly at every step', () => {
    // 29 uniform 800px pages, content coordinates page N = [(N-1)*800, N*800).
    const pageHeight = 800
    const pages: PageGeometry[] = Array.from({ length: 29 }, (_, i) => ({
      pageNumber: i + 1,
      offsetTop: i * pageHeight,
      offsetHeight: pageHeight,
    }))
    const clientHeight = 800
    const centerOf = (pageNumber: number) => (pageNumber - 1) * pageHeight // scrollTop that centers this page exactly

    expect(selectCurrentPageByScroll(pages, centerOf(1), clientHeight)).toBe(1)
    expect(selectCurrentPageByScroll(pages, centerOf(5), clientHeight)).toBe(5)
    expect(selectCurrentPageByScroll(pages, centerOf(14), clientHeight)).toBe(14)
    // Live-equivalent regression: the exact bug report was "scrolled back to the top but the
    // indicator stayed on a much later page" -- confirm the return-to-top step independently.
    expect(selectCurrentPageByScroll(pages, centerOf(1), clientHeight)).toBe(1)
  })

  it('(A10.5) last page is selected correctly once scrolled to the document end', () => {
    const pages: PageGeometry[] = Array.from({ length: 29 }, (_, i) => ({
      pageNumber: i + 1,
      offsetTop: i * 800,
      offsetHeight: 800,
    }))
    // Scrolled to the very bottom: scrollTop = totalHeight - clientHeight.
    const scrollTop = 29 * 800 - 800
    expect(selectCurrentPageByScroll(pages, scrollTop, 800)).toBe(29)
  })

  it('(A10.6) a zoom change that grows every page height still selects the geometrically correct page', () => {
    // Same document at 2x zoom: page heights double, content coordinates scale accordingly.
    const pages: PageGeometry[] = [
      { pageNumber: 1, offsetTop: 0, offsetHeight: 1600 },
      { pageNumber: 2, offsetTop: 1600, offsetHeight: 1600 },
      { pageNumber: 3, offsetTop: 3200, offsetHeight: 1600 },
    ]
    // Viewport center now needs to be recomputed against the new (doubled) coordinates.
    expect(selectCurrentPageByScroll(pages, 1600 + 700, 800)).toBe(2)
  })

  it('(A10.7) a resize that changes the container height (e.g. stacked/side-by-side switch) recalculates correctly', () => {
    const pages: PageGeometry[] = [
      { pageNumber: 1, offsetTop: 0, offsetHeight: 800 },
      { pageNumber: 2, offsetTop: 800, offsetHeight: 800 },
      { pageNumber: 3, offsetTop: 1600, offsetHeight: 800 },
    ]
    // Same scrollTop, but the container shrinks (e.g. stacked mode's smaller max-height) --
    // the viewport center moves, and the selected page must move with it.
    const tall = selectCurrentPageByScroll(pages, 800, 800) // center 1200 -> page 2
    const short = selectCurrentPageByScroll(pages, 800, 200) // center 900 -> still page 2 (close)
    const veryShort = selectCurrentPageByScroll(pages, 1600, 100) // center 1650 -> page 3
    expect(tall).toBe(2)
    expect(short).toBe(2)
    expect(veryShort).toBe(3)
  })

  it('(A10.8) a newly-loaded document starts at real page 1 (fresh single-page snapshot)', () => {
    const pages: PageGeometry[] = [{ pageNumber: 1, offsetTop: 0, offsetHeight: 800 }]
    expect(selectCurrentPageByScroll(pages, 0, 800)).toBe(1)
  })

  it('(A10.9) lazy canvas mounting does not affect current-page selection -- a page not yet rendered still has real wrapper geometry (placeholder size)', () => {
    // Page 2's canvas hasn't rendered yet, but its lightweight wrapper still reports a real
    // (placeholder-estimated) offsetTop/offsetHeight -- selection only ever needs the wrapper.
    const pages: PageGeometry[] = [
      { pageNumber: 1, offsetTop: 0, offsetHeight: 800 },
      { pageNumber: 2, offsetTop: 800, offsetHeight: 800 }, // unrendered placeholder geometry
    ]
    expect(selectCurrentPageByScroll(pages, 800, 800)).toBe(2)
  })

  it('a page closer to center wins over a page with more raw overlap but off-center', () => {
    const pages: PageGeometry[] = [
      { pageNumber: 1, offsetTop: 0, offsetHeight: 750 },
      { pageNumber: 2, offsetTop: 750, offsetHeight: 100 },
    ]
    expect(selectCurrentPageByScroll(pages, 0, 800)).toBe(1)
  })

  it('returns null (caller keeps previous page) for an empty geometry snapshot', () => {
    expect(selectCurrentPageByScroll([], 0, 800)).toBeNull()
  })

  it('source order is irrelevant -- selection depends only on geometry, not array position', () => {
    const forward: PageGeometry[] = [
      { pageNumber: 1, offsetTop: 0, offsetHeight: 100 },
      { pageNumber: 2, offsetTop: 100, offsetHeight: 800 },
    ]
    const reversed = [...forward].reverse()
    expect(selectCurrentPageByScroll(forward, 0, 800)).toBe(selectCurrentPageByScroll(reversed, 0, 800))
  })

  it('(A10.10 counterpart) selection is a pure function of geometry -- calling it never mutates the input snapshot', () => {
    const pages: PageGeometry[] = [{ pageNumber: 1, offsetTop: 0, offsetHeight: 800 }]
    const before = JSON.parse(JSON.stringify(pages))
    selectCurrentPageByScroll(pages, 0, 800)
    selectCurrentPageByScroll(pages, 400, 200)
    expect(pages).toEqual(before)
  })
})

/**
 * A10 items 10-12 are structural/integration properties of PdfViewer.tsx itself (no
 * navigation side effect from current-page state; no Previous/Next controls; the page count
 * stays visible) -- this codebase has no component-rendering test harness (no jsdom/RTL), so
 * these are verified against the component's actual source text, the same technique already
 * used elsewhere in this codebase for source-level structural invariants.
 */
describe('Prototype 2.6G2.7D -- reproduces the real wrong-scroll-authority bug class', () => {
  it('a non-scrolling container (scrollTop always 0, clientHeight == full content height) makes selection collapse onto the middle page regardless of true scroll position -- the exact live symptom', () => {
    // 29 uniform 800px pages, 23200px of total content. This models what the PRE-2.7D code
    // actually measured: `.pdf-scroll-container` has no `overflow` of its own, so its
    // `scrollTop` is always 0 (a non-scrolling element cannot have a nonzero scroll offset)
    // and its `clientHeight` equals its own full un-clipped content height (23200), not the
    // ~800px visible window `.pdf-canvas-area` actually clips to.
    const pageHeight = 800
    const totalPages = 29
    const pages: PageGeometry[] = Array.from({ length: totalPages }, (_, i) => ({
      pageNumber: i + 1,
      offsetTop: i * pageHeight,
      offsetHeight: pageHeight,
    }))
    const wronglyMeasuredScrollTop = 0 // always 0 on a non-scrolling element
    const wronglyMeasuredClientHeight = totalPages * pageHeight // the element's own full height

    // Regardless of where the reader ACTUALLY is (simulated by which page's real geometry we
    // fed in -- irrelevant here since the wrong measurement never changes with real scroll),
    // the computed "viewport center" is a constant near the middle of the whole document.
    const selected = selectCurrentPageByScroll(pages, wronglyMeasuredScrollTop, wronglyMeasuredClientHeight)
    // 23200/2 = 11600, which falls inside page 15's content span [11200, 12000) -- matching
    // the exact live-reported "15 / 29" (and, in an earlier run, "14 / 29") symptom: a
    // constant near the document's middle page, never responsive to real scrolling.
    expect(selected).toBe(15)
  })

  it('the SAME geometry, measured correctly (real scrollTop/clientHeight from the actual scrolling viewport), tracks true position -- proving the defect was the measurement source, not the selection algorithm', () => {
    const pageHeight = 800
    const pages: PageGeometry[] = Array.from({ length: 29 }, (_, i) => ({
      pageNumber: i + 1,
      offsetTop: i * pageHeight,
      offsetHeight: pageHeight,
    }))
    const realClientHeight = 800 // the actual ~75vh-capped visible window, not the full document
    // Scrolled so page 1 is fully in view (the live-reported state: title page visible).
    expect(selectCurrentPageByScroll(pages, 0, realClientHeight)).toBe(1)
  })
})

describe('Prototype 2.6G2.7D -- PdfViewer.tsx scroll-authority source invariants', () => {
  const source = readFileSync(new URL('../../src/features/pdf/components/PdfViewer.tsx', import.meta.url), 'utf-8')

  it('scrollViewportRef is attached to .pdf-canvas-area (the element with overflow:auto in App.css), not .pdf-scroll-container', () => {
    expect(source).toMatch(/className="pdf-canvas-area"\s+ref=\{scrollViewportRef\}/)
    expect(source).not.toMatch(/className="pdf-scroll-container"\s+ref=\{scrollViewportRef\}/)
  })

  it('recomputeCurrentPage reads scrollTop/clientHeight from scrollViewportRef, never from scrollContainerRef', () => {
    const fnBody = source.slice(
      source.indexOf('const recomputeCurrentPage = useCallback'),
      source.indexOf('const applyFitWidthScale = useCallback'),
    )
    expect(fnBody).toContain('scrollViewportRef.current')
    expect(fnBody).not.toContain('scrollContainerRef.current')
  })

  it('applyFitWidthScale reads clientWidth from scrollViewportRef, never from scrollContainerRef', () => {
    const start = source.indexOf('const applyFitWidthScale = useCallback')
    const end = source.indexOf('// A2/A3: scroll-driven')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const fnBody = source.slice(start, end)
    expect(fnBody).toContain('scrollViewportRef.current')
    expect(fnBody).not.toContain('scrollContainerRef.current')
  })

  it('the scroll event listener and ResizeObserver are attached to scrollViewportRef, never scrollContainerRef', () => {
    const start = source.indexOf('// A2/A3: scroll-driven')
    const end = source.indexOf('}, [status, numPages, applyFitWidthScale, recomputeCurrentPage])')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const effectBody = source.slice(start, end)
    expect(effectBody).toMatch(/viewport\.addEventListener\('scroll'/)
    expect(effectBody).toMatch(/resizeObserver\.observe\(viewport\)/)
    expect(effectBody).not.toContain('scrollContainerRef')
  })
})

describe('Prototype 2.6G2.7C -- PdfViewer.tsx structural invariants (A10.10-12)', () => {
  const source = readFileSync(new URL('../../src/features/pdf/components/PdfViewer.tsx', import.meta.url), 'utf-8')

  it('(A10.10) current-page state never drives navigation -- setCurrentPageNumber never appears alongside a scrollTo/scrollIntoView call', () => {
    expect(source).not.toMatch(/scrollIntoView|scrollTo\(/)
  })

  it('(A10.11) no Previous/Next page-navigation controls remain', () => {
    // The doc comment above the indicator legitimately MENTIONS 前へ/次へ (explaining they
    // were removed) -- what must not exist is an actual rendered button labelled with them.
    expect(source).not.toMatch(/>\s*前へ\s*</)
    expect(source).not.toMatch(/>\s*次へ\s*</)
  })

  it('(A10.12) the page count is rendered together with the current page number', () => {
    expect(source).toContain('{currentPageNumber} / {numPages}')
  })
})
