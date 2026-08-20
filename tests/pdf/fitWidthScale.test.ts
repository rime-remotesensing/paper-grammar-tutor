import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { computeFitWidthScale } from '../../src/features/pdf/domain/fitWidthScale.ts'

const MIN_SCALE = 0.5
const MAX_SCALE = 3

describe('Prototype 2.6G2.7C part B -- computeFitWidthScale', () => {
  it('computes scale so the page scale-1 width fills the available width', () => {
    // A 600px-wide page (scale 1) in a 900px pane -> scale 1.5.
    expect(computeFitWidthScale(900, 600, MIN_SCALE, MAX_SCALE)).toBeCloseTo(1.5)
  })

  it('never returns a fixed magic default (e.g. 300%) -- always derived from the actual measurements', () => {
    expect(computeFitWidthScale(1200, 400, MIN_SCALE, MAX_SCALE)).toBeCloseTo(3) // clamped, not literally "3 because 300% is the default"
    expect(computeFitWidthScale(450, 900, MIN_SCALE, MAX_SCALE)).toBeCloseTo(0.5)
    expect(computeFitWidthScale(660, 600, MIN_SCALE, MAX_SCALE)).toBeCloseTo(1.1) // a genuinely different pane width yields a genuinely different scale
  })

  it('clamps to the maximum scale for a very narrow page in a very wide pane', () => {
    expect(computeFitWidthScale(5000, 100, MIN_SCALE, MAX_SCALE)).toBe(MAX_SCALE)
  })

  it('clamps to the minimum scale for a very wide page in a very narrow pane', () => {
    expect(computeFitWidthScale(50, 2000, MIN_SCALE, MAX_SCALE)).toBe(MIN_SCALE)
  })

  it('falls back to minScale (never zero/negative/NaN) when available width is not yet measurable', () => {
    expect(computeFitWidthScale(0, 600, MIN_SCALE, MAX_SCALE)).toBe(MIN_SCALE)
    expect(computeFitWidthScale(-10, 600, MIN_SCALE, MAX_SCALE)).toBe(MIN_SCALE)
  })

  it('falls back to minScale (never zero/negative/NaN/Infinity) when base page width is not yet known', () => {
    expect(computeFitWidthScale(900, 0, MIN_SCALE, MAX_SCALE)).toBe(MIN_SCALE)
    expect(Number.isFinite(computeFitWidthScale(900, 0, MIN_SCALE, MAX_SCALE))).toBe(true)
  })

  it('recomputes to a different scale when the available (pane) width changes -- e.g. after a resize/layout switch', () => {
    const wide = computeFitWidthScale(1400, 600, MIN_SCALE, MAX_SCALE)
    const narrow = computeFitWidthScale(700, 600, MIN_SCALE, MAX_SCALE)
    expect(wide).toBeGreaterThan(narrow)
  })
})

/**
 * The default mode, manual-zoom-disables-fit, fit-button-restores-fit, and text-layer/render
 * scale unification requirements are integration properties of PdfViewer.tsx (no component
 * render harness in this codebase -- see currentPageTracking.test.ts's own structural-
 * invariant tests for the same technique) -- verified against the component's actual source.
 */
describe('Prototype 2.6G2.7C part B -- PdfViewer.tsx zoom-mode integration invariants', () => {
  const source = readFileSync(new URL('../../src/features/pdf/components/PdfViewer.tsx', import.meta.url), 'utf-8')

  it('a newly-loaded document defaults zoomMode to fit-width', () => {
    expect(source).toMatch(/useState<ZoomMode>\('fit-width'\)/)
    expect(source).toMatch(/setZoomMode\('fit-width'\)\s*\n\s*zoomModeRef\.current = 'fit-width'/)
  })

  it('clicking 縮小/拡大 switches to manual zoom mode', () => {
    const shrinkMatch = />\s*縮小\s*</.exec(source)
    const growMatch = />\s*拡大\s*</.exec(source)
    expect(shrinkMatch).not.toBeNull()
    expect(growMatch).not.toBeNull()
    expect(source.slice(shrinkMatch!.index - 400, shrinkMatch!.index)).toContain("setZoomMode('manual')")
    expect(source.slice(growMatch!.index - 400, growMatch!.index)).toContain("setZoomMode('manual')")
  })

  it('幅に合わせる restores fit-width mode and forces an immediate recompute', () => {
    const fitMatch = />\s*幅に合わせる\s*</.exec(source)
    expect(fitMatch).not.toBeNull()
    const fitButtonArea = source.slice(fitMatch!.index - 400, fitMatch!.index)
    expect(fitButtonArea).toContain("setZoomMode('fit-width')")
    expect(fitButtonArea).toContain('applyFitWidthScale(true)')
  })

  it('an ordinary resize does not override a manual zoom choice (fit-width application is gated on zoomModeRef)', () => {
    expect(source).toContain("if (!force && zoomModeRef.current !== 'fit-width') return")
  })

  it('the same `scale` state feeds PdfPageView -- no independent CSS-only scaling path exists for canvas vs. text layer', () => {
    expect(source).toMatch(/<PdfPageView[\s\S]{0,300}scale=\{scale\}/)
    expect(source).not.toMatch(/transform:\s*scale\(/)
  })
})
