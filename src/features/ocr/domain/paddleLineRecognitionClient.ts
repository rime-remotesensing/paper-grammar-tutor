/**
 * Talks to the local `services/paddle_ocr` process's `POST /ocr/lines` endpoint over
 * HTTP — nothing else (Prototype 1.5D). Same separation as paddleOcrClient.ts: no
 * caching, no DTO validation, no cropping/alignment logic. Every request targets
 * 127.0.0.1 only.
 */

/**
 * POSTs one or more pre-cropped line images as `multipart/form-data` (never base64,
 * matching the existing /ocr/page client) to `/ocr/lines`, all under the same `files`
 * field name so the service processes them as one batch request rather than one HTTP
 * round trip per line (Prototype 1.5D item 12). Callers (paddleHighResService.ts) are
 * responsible for schema validation; this function's only job is the HTTP round trip.
 * `crops` must already be in top-to-bottom reading order — the response has no bbox to
 * re-derive it from.
 */
export async function requestLineRecognition(baseUrl: string, crops: readonly Blob[], timeoutMs: number): Promise<unknown> {
  const formData = new FormData()
  crops.forEach((blob, i) => formData.append('files', blob, `line-${i}.png`))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${baseUrl}/ocr/lines`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`高解像度再認識の実行に失敗しました（HTTP ${response.status}）。`)
    }
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}
