/**
 * Prototype 2.6G2.10 -- user-adjustable PDF viewport height.
 *
 * `.pdf-canvas-area` (the scrolling PDF viewport) previously had a fixed `max-height`
 * (75vh side-by-side / 55vh stacked, in App.css) that the user could never change. This
 * module makes that height an explicit, persisted, user-draggable value instead -- pure
 * functions only (no DOM access beyond the injected `Storage`/`windowInnerHeight`), mirroring
 * `layoutPreference.ts`'s own read/write/safe-fallback shape so both persisted UI
 * preferences follow the same pattern.
 */

const STORAGE_KEY = 'paperGrammarTutor.pdfViewportHeight'

/** Suggested bounds (section spec): never smaller than a genuinely usable reading window. */
export const PDF_VIEWPORT_MIN_HEIGHT = 350

/** The absolute ceiling regardless of window size -- keeps the viewport from growing
 * comically tall on an ultra-wide/ultra-tall monitor. */
const PDF_VIEWPORT_MAX_HEIGHT_CAP = 1100

/** The default height, as a fraction of the current window height, matches the previous
 * fixed `75vh` side-by-side default (Prototype 2.6G2.7A) so a first-time user's viewport
 * starts at approximately the same size as before this feature existed. */
const DEFAULT_HEIGHT_VIEWPORT_RATIO = 0.75

/** `min(window.innerHeight * 0.9, 1100px)` -- never smaller than `PDF_VIEWPORT_MIN_HEIGHT`
 * itself, so a very short window (e.g. a small laptop screen) still yields a usable range
 * rather than an inverted min > max. */
export function computePdfViewportMaxHeight(windowInnerHeight: number): number {
  const capped = Math.min(windowInnerHeight * 0.9, PDF_VIEWPORT_MAX_HEIGHT_CAP)
  return Math.max(capped, PDF_VIEWPORT_MIN_HEIGHT)
}

/** Clamps an arbitrary height (a drag delta, a stored value, anything) into the valid
 * [min, max] range for the current window. */
export function clampPdfViewportHeight(height: number, windowInnerHeight: number): number {
  if (!Number.isFinite(height)) return computeDefaultPdfViewportHeight(windowInnerHeight)
  const max = computePdfViewportMaxHeight(windowInnerHeight)
  return Math.min(Math.max(height, PDF_VIEWPORT_MIN_HEIGHT), max)
}

/** "Approximately the current PDF viewport height" -- the value used both as the very
 * first render's height (before anything is persisted) and as the double-click-to-reset
 * target. */
export function computeDefaultPdfViewportHeight(windowInnerHeight: number): number {
  const raw = windowInnerHeight * DEFAULT_HEIGHT_VIEWPORT_RATIO
  const max = Math.min(windowInnerHeight * 0.9, PDF_VIEWPORT_MAX_HEIGHT_CAP)
  return Math.min(Math.max(raw, PDF_VIEWPORT_MIN_HEIGHT), Math.max(max, PDF_VIEWPORT_MIN_HEIGHT))
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/** Reads the persisted viewport height, clamped to the CURRENT window's valid range (a
 * value persisted on a larger monitor is still safely usable after moving to a smaller
 * one). Any missing/invalid/non-finite stored value falls back to the computed default --
 * never throws, never leaves the viewport unrenderable. Safe to call outside a browser. */
export function readStoredPdfViewportHeight(windowInnerHeight: number, storage: Pick<Storage, 'getItem'> | null = safeLocalStorage()): number {
  if (!storage) return computeDefaultPdfViewportHeight(windowInnerHeight)
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null) return computeDefaultPdfViewportHeight(windowInnerHeight)
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return computeDefaultPdfViewportHeight(windowInnerHeight)
    return clampPdfViewportHeight(parsed, windowInnerHeight)
  } catch {
    // Storage can throw in a locked-down/private-browsing context -- never let a read
    // failure break the viewport; the computed default is always immediately usable.
    return computeDefaultPdfViewportHeight(windowInnerHeight)
  }
}

/** Persists the viewport height. Silently no-ops if storage is unavailable -- persistence
 * is a convenience, never a hard requirement for resizing to work within the session. */
export function writeStoredPdfViewportHeight(height: number, storage: Pick<Storage, 'setItem'> | null = safeLocalStorage()): void {
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, String(Math.round(height)))
  } catch {
    // Ignore -- see readStoredPdfViewportHeight's own note.
  }
}
