import { z } from 'zod'

/**
 * Validates the `services/paddle_ocr` local service's `POST /ocr/page` response before
 * anything downstream trusts it (Prototype 1.4B). The service already reshapes
 * PaddleOCR's own version-specific object into this stable DTO, but the HTTP boundary
 * itself is untrusted — a wrong service version, a stale process, or a malformed
 * response should fail validation rather than let a candidate be built from bad data.
 */
export const paddleBboxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()])
export type PaddleBbox = z.infer<typeof paddleBboxSchema>

export const paddleWordSchema = z.object({
  text: z.string(),
  confidence: z.number().nullable().optional(),
  bbox: paddleBboxSchema,
})
export type PaddleWord = z.infer<typeof paddleWordSchema>

export const paddleLineSchema = z.object({
  text: z.string(),
  confidence: z.number(),
  bbox: paddleBboxSchema,
  words: z.array(paddleWordSchema),
})
export type PaddleLine = z.infer<typeof paddleLineSchema>

export const paddlePageResultSchema = z.object({
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  lines: z.array(paddleLineSchema),
  timingMs: z.record(z.string(), z.number()).optional(),
})
export type PaddlePageResult = z.infer<typeof paddlePageResultSchema>

export const paddleHealthSchema = z.object({
  status: z.string(),
  model: z.string(),
  device: z.string(),
  gpuAvailable: z.boolean(),
  modelLoaded: z.boolean(),
  error: z.string().nullable(),
})
export type PaddleHealth = z.infer<typeof paddleHealthSchema>
