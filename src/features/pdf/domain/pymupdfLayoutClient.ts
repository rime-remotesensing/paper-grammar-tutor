/**
 * Talks to the local `services/pymupdf_layout` process over HTTP — nothing else. No
 * validation, no document-lifecycle bookkeeping (see pymupdfLayoutService.ts for those).
 * Every request targets 127.0.0.1 only; this client never has a configurable remote host —
 * matches `features/ocr/domain/paddleOcrClient.ts`'s own separation of concerns.
 */

export interface SelectionEndpointInput {
  pageNumber: number
  xNorm: number
  yNorm: number
  boundaryText: string
  direction: 'forward' | 'backward'
}

async function withTimeout<T>(signal: AbortSignal | undefined, timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort)
  try {
    return await run(controller.signal)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}

export async function checkPymupdfHealth(baseUrl: string, timeoutMs: number): Promise<unknown> {
  return withTimeout(undefined, timeoutMs, async (signal) => {
    const response = await fetch(`${baseUrl}/health`, { signal })
    if (!response.ok) throw new Error(`health check returned HTTP ${response.status}`)
    return await response.json()
  })
}

/** POSTs the PDF bytes the browser already has in memory (from `file.arrayBuffer()`) as
 * `multipart/form-data` to `/document/register` — a browser File/Blob never exposes a
 * filesystem path, so this is the only way a PDF can reach the service (item 15 of R8). */
export async function registerDocument(baseUrl: string, pdfBytes: ArrayBuffer, timeoutMs: number): Promise<unknown> {
  return withTimeout(undefined, timeoutMs, async (signal) => {
    const formData = new FormData()
    formData.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'document.pdf')
    const response = await fetch(`${baseUrl}/document/register`, { method: 'POST', body: formData, signal })
    if (!response.ok) throw new Error(`document registration returned HTTP ${response.status}`)
    return await response.json()
  })
}

export async function closeDocument(baseUrl: string, documentId: string, timeoutMs: number): Promise<void> {
  try {
    await withTimeout(undefined, timeoutMs, async (signal) => {
      await fetch(`${baseUrl}/document/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
        signal,
      })
    })
  } catch {
    // Best-effort: a failed close just leaves the service holding a handle it will drop
    // when the process restarts. Never surfaced to the user (item 17: cleanup, not a
    // selection-time concern).
  }
}

export async function requestSelectionResolution(
  baseUrl: string,
  documentId: string,
  start: SelectionEndpointInput,
  end: SelectionEndpointInput,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  return withTimeout(signal, timeoutMs, async (innerSignal) => {
    const response = await fetch(`${baseUrl}/layout/selection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId, start, end }),
      signal: innerSignal,
    })
    if (!response.ok) throw new Error(`selection resolution returned HTTP ${response.status}`)
    return await response.json()
  })
}
