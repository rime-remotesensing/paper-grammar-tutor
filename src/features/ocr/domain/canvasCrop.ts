import type { PixelRect } from './ocrTypes'

/** Expands `rect` by `paddingPx` on every side, then clamps to `[0, width] x [0, height]`
 * (Prototype 1.5D item 13 — page-boundary clamp, so a line near a page edge never
 * requests a crop outside the actual rendered canvas). */
export function padAndClampRect(rect: PixelRect, paddingPx: number, canvasWidth: number, canvasHeight: number): PixelRect {
  return {
    left: Math.max(0, rect.left - paddingPx),
    top: Math.max(0, rect.top - paddingPx),
    right: Math.min(canvasWidth, rect.right + paddingPx),
    bottom: Math.min(canvasHeight, rect.bottom + paddingPx),
  }
}

/** Crops `rect` out of `canvas` and returns it as a PNG Blob, ready to upload — the same
 * `canvas.toBlob('image/png')` pattern the existing full-page OCR client uses (never
 * base64). */
export async function cropCanvasToPngBlob(canvas: HTMLCanvasElement, rect: PixelRect): Promise<Blob> {
  const width = Math.round(rect.right - rect.left)
  const height = Math.round(rect.bottom - rect.top)
  const cropCanvas = document.createElement('canvas')
  cropCanvas.width = width
  cropCanvas.height = height
  const ctx = cropCanvas.getContext('2d')
  if (!ctx) throw new Error('crop用canvasを初期化できませんでした。')
  ctx.drawImage(canvas, rect.left, rect.top, width, height, 0, 0, width, height)

  const blob = await new Promise<Blob | null>((resolve) => cropCanvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('crop画像の生成に失敗しました。')
  return blob
}
