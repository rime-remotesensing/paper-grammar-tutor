import { z } from 'zod'

/**
 * Validates the `services/paddle_ocr` `POST /ocr/lines` response (Prototype 1.5I —
 * backed by the same full det+rec page pipeline `/ocr/page` uses, not a separate
 * recognition-only model; see paddleHighResService.ts). Unlike `paddlePageResultSchema`,
 * there is no bbox here — line identity is carried purely by response-array order,
 * matching the order the crop images were uploaded in.
 *
 * `text`/`confidence` are only populated when `detectionCount === 1` (exactly one text
 * region detected in that line's crop). `detectionCount !== 1` (0 or multiple) means the
 * service could not trust a result for that line — callers must treat it as a failure
 * for that line, never guess by concatenating multiple regions.
 */
export const paddleLineRecognitionResultSchema = z.object({
  text: z.string().nullable(),
  confidence: z.number().nullable(),
  detectionCount: z.number().int(),
})
export type PaddleLineRecognitionResult = z.infer<typeof paddleLineRecognitionResultSchema>

export const paddleLinesResultSchema = z.object({
  lines: z.array(paddleLineRecognitionResultSchema),
  timingMs: z.record(z.string(), z.number()).optional(),
})
export type PaddleLinesResult = z.infer<typeof paddleLinesResultSchema>
