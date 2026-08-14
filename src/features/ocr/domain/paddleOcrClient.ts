/**
 * Talks to the local `services/paddle_ocr` process over HTTP — nothing else. No caching,
 * no spatial-extraction logic (see paddleOcrService.ts and paddleAdapter.ts for those).
 * Every request targets 127.0.0.1 only; this client never has a configurable remote host.
 */

import { paddleHealthSchema } from '../schemas/paddleOcr.schema'

export interface PaddleAvailability {
  available: boolean
  reason: string | null
}

/**
 * Fetches `/health` and applies the full "actually usable" definition (Prototype 1.4B) —
 * not just HTTP 200. A service that responds but reports `gpuAvailable: false` or
 * `modelLoaded: false` (or a device other than "gpu") must be treated the same as
 * unreachable: this project's whole reason for using PaddleOCR as the primary engine is
 * its GPU-speed accuracy, and silently accepting a degraded/CPU response here would be
 * exactly the silent-fallback failure mode this design is meant to avoid.
 */
export async function checkPaddleHealth(baseUrl: string, timeoutMs: number): Promise<PaddleAvailability> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await fetch(`${baseUrl}/health`, { signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) {
      return { available: false, reason: `health check returned HTTP ${response.status}` }
    }
    const body: unknown = await response.json()
    const parsed = paddleHealthSchema.safeParse(body)
    if (!parsed.success) {
      return { available: false, reason: 'health応答の形式が不正です。' }
    }
    const health = parsed.data
    if (health.status !== 'ok') return { available: false, reason: 'サービスの状態がokではありません。' }
    if (health.gpuAvailable !== true) return { available: false, reason: 'GPUが利用できません。' }
    if (health.modelLoaded !== true) return { available: false, reason: 'モデルが読み込まれていません。' }
    if (health.device !== 'gpu') return { available: false, reason: 'GPUデバイスが選択されていません。' }
    return { available: true, reason: null }
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : 'health checkに失敗しました。' }
  }
}

/**
 * POSTs the page canvas as `multipart/form-data` (never base64 — see docs/design-notes.md,
 * Prototype 1.4B) to `/ocr/page` and returns the parsed-but-unvalidated JSON body.
 * Callers (paddleOcrService.ts) are responsible for schema validation; this function's
 * only job is the HTTP round trip.
 */
export async function requestPaddleOcr(baseUrl: string, canvas: HTMLCanvasElement, timeoutMs: number): Promise<unknown> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('ページ画像の生成に失敗しました。')

  const formData = new FormData()
  formData.append('file', blob, 'page.png')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${baseUrl}/ocr/page`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`高精度OCRの実行に失敗しました（HTTP ${response.status}）。`)
    }
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}
