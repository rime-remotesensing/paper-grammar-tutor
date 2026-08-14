/**
 * Guards an async flow (OCR request) against a slow, in-flight call applying its result
 * after something newer has superseded it — a newer selection, or a newly loaded PDF
 * document. `next()` is called when a request starts; the caller checks `isCurrent(id)`
 * right before committing that request's result to UI state, and skips the commit if a
 * later `next()` call has since moved the guard past it.
 */
export function createRequestGuard() {
  let current = 0
  return {
    next(): number {
      current += 1
      return current
    },
    isCurrent(id: number): boolean {
      return id === current
    },
  }
}
