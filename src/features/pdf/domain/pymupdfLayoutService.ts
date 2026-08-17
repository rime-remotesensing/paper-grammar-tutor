import { PYMUPDF_HEALTH_TIMEOUT_MS, PYMUPDF_LAYOUT_SERVICE_URL, PYMUPDF_REGISTER_TIMEOUT_MS, PYMUPDF_SELECTION_TIMEOUT_MS } from '../../../config/settings'
import {
  pymupdfHealthSchema,
  pymupdfRegisterResponseSchema,
  pymupdfSelectionResponseSchema,
  type PymupdfSelectionResponse,
} from '../schemas/pymupdfLayout.schema'
import {
  checkPymupdfHealth,
  closeDocument,
  registerDocument,
  requestSelectionResolution,
  SelectionResolutionError,
  type SelectionEndpointInput,
} from './pymupdfLayoutClient'

export interface PymupdfAvailability {
  available: boolean
  reason: string | null
}

/** Never cached — a stopped/restarted service must be detected on the very next check, same
 * "explicit fallback" discipline as `checkPaddleAvailability` (Prototype 1.4B). */
export async function checkPymupdfAvailability(): Promise<PymupdfAvailability> {
  try {
    const raw = await checkPymupdfHealth(PYMUPDF_LAYOUT_SERVICE_URL, PYMUPDF_HEALTH_TIMEOUT_MS)
    const parsed = pymupdfHealthSchema.safeParse(raw)
    if (!parsed.success) return { available: false, reason: 'health応答の形式が不正です。' }
    if (parsed.data.status !== 'ok') return { available: false, reason: 'サービスの状態がokではありません。' }
    return { available: true, reason: null }
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : 'health checkに失敗しました。' }
  }
}

/**
 * Registers `pdfBytes` with the layout service and returns its `documentId`, or `null` if
 * registration failed for any reason (service down, invalid PDF, timeout) — every
 * cross-block selection on this document will be unavailable until a later successful
 * register call (item 25: internal "cross-block reconstruction unavailable" state, no retry
 * loop or connection-status UI as heavy as the Ollama/Paddle ones).
 */
export async function registerDocumentWithLayoutService(pdfBytes: ArrayBuffer): Promise<{ documentId: string; numPages: number } | null> {
  try {
    const raw = await registerDocument(PYMUPDF_LAYOUT_SERVICE_URL, pdfBytes, PYMUPDF_REGISTER_TIMEOUT_MS)
    const parsed = pymupdfRegisterResponseSchema.safeParse(raw)
    if (!parsed.success) return null
    return parsed.data
  } catch {
    return null
  }
}

export async function closeLayoutDocument(documentId: string): Promise<void> {
  await closeDocument(PYMUPDF_LAYOUT_SERVICE_URL, documentId, PYMUPDF_REGISTER_TIMEOUT_MS)
}

/**
 * Resolves a selection's start/end endpoints against the layout service. Throws (never
 * returns a best-guess fallback) on any failure — network error, timeout, or a response
 * that fails schema validation — so the caller's explicit-failure UX (item 6/37/38: no
 * silent fallback to the retired custom heuristic) always has a clear signal to act on.
 */
export async function resolveSelectionWithLayoutService(
  documentId: string,
  start: SelectionEndpointInput,
  end: SelectionEndpointInput,
  signal?: AbortSignal,
): Promise<PymupdfSelectionResponse> {
  const raw = await requestSelectionResolution(PYMUPDF_LAYOUT_SERVICE_URL, documentId, start, end, PYMUPDF_SELECTION_TIMEOUT_MS, signal)
  const parsed = pymupdfSelectionResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`レイアウトサービスの応答を検証できませんでした: ${parsed.error.issues.map((i) => i.message).join('; ')}`)
  }
  return parsed.data
}

export type { SelectionEndpointInput }
export { SelectionResolutionError }
