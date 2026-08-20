/**
 * Prototype 2.6G2.7C track A: current-page tracking is now a deterministic function of the
 * actual scroll position, computed directly from live DOM geometry -- not derived from
 * IntersectionObserver callback state at all. Two prior attempts (2.7A's naive rebuild-from-
 * `entries`, 2.7B's persistent-snapshot merge) were both still ultimately gated by
 * IntersectionObserver's own callback timing, which the spec explicitly does NOT guarantee to
 * be synchronized with scroll/paint -- callbacks can be coalesced or delayed by the browser at
 * its own pace, so even a structurally-correct snapshot model can still lag behind what's
 * actually on screen during fast scrolling. This function has no callback-timing dependency at
 * all: given a fresh geometry snapshot (built by the caller, live, on every scroll/resize/zoom
 * event via requestAnimationFrame throttling -- see PdfViewer.tsx), it deterministically picks
 * one page. Pure and DOM-free so the selection rule itself is independently testable.
 */

export interface PageGeometry {
  pageNumber: number
  /** Distance from the top of the scroll container's own content (i.e. comparable directly
   * against `scrollTop`) -- NOT a viewport-relative rect. Computed live by the caller as
   * `pageRect.top - containerRect.top + container.scrollTop`, so it is correct regardless of
   * how far the container has scrolled and is never persisted/cached across scroll events. */
  offsetTop: number
  offsetHeight: number
}

/**
 * Selects "the page the reader is actually viewing" from a live geometry snapshot: the page
 * whose own vertical center is nearest the viewport's vertical center
 * (`scrollTop + clientHeight / 2`), both expressed in the same content-coordinate space.
 * Deterministic (no randomness, no dependency on iteration/discovery order) and stable under
 * repeated calls against unchanged geometry. Returns null only when `pages` is empty (e.g. a
 * document with no page wrappers yet mounted) -- the caller should keep the previous page
 * number in that case.
 */
export function selectCurrentPageByScroll(
  pages: readonly PageGeometry[],
  scrollTop: number,
  clientHeight: number,
): number | null {
  if (pages.length === 0) return null
  const viewportCenter = scrollTop + clientHeight / 2
  let best: { pageNumber: number; distance: number } | null = null
  for (const page of pages) {
    const pageCenter = page.offsetTop + page.offsetHeight / 2
    const distance = Math.abs(pageCenter - viewportCenter)
    if (best === null || distance < best.distance) best = { pageNumber: page.pageNumber, distance }
  }
  return best ? best.pageNumber : null
}
