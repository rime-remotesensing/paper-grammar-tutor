import { z } from 'zod'

/**
 * Validates `services/pymupdf_layout` local service responses before anything downstream
 * trusts them (Prototype 2.4B-R8, matching the same discipline as
 * `features/ocr/schemas/paddleOcr.schema.ts`). A wrong service version, a stale process, or
 * a malformed response fails validation rather than letting a selection be built from bad
 * data.
 */

export const pymupdfHealthSchema = z.object({
  status: z.string(),
  engine: z.string(),
  serviceVersion: z.string(),
})
export type PymupdfHealth = z.infer<typeof pymupdfHealthSchema>

export const pymupdfRegisterResponseSchema = z.object({
  documentId: z.string().min(1),
  numPages: z.number().int().positive(),
})
export type PymupdfRegisterResponse = z.infer<typeof pymupdfRegisterResponseSchema>

export const pymupdfFragmentSchema = z.object({
  pageNumber: z.number().int().positive(),
  text: z.string(),
})
export type PymupdfFragment = z.infer<typeof pymupdfFragmentSchema>

export const pymupdfSelectionResponseSchema = z.object({
  startBlockId: z.string(),
  endBlockId: z.string(),
  // Prototype 2.5E: structural fact only (same PyMuPDF block) -- no longer the sole
  // routing signal. `reconstructedText` non-null means "use this text" regardless of
  // sameBlock (a same-block selection whose native Range text would be missing a
  // recovered glyph gets its own repaired reconstructedText); sameBlock=true with
  // reconstructedText=null is the fast, unaffected common case (native Range text).
  sameBlock: z.boolean(),
  reconstructedText: z.string().nullable(),
  fragments: z.array(pymupdfFragmentSchema),
})
export type PymupdfSelectionResponse = z.infer<typeof pymupdfSelectionResponseSchema>

export const pymupdfCloseResponseSchema = z.object({
  closed: z.boolean(),
})
export type PymupdfCloseResponse = z.infer<typeof pymupdfCloseResponseSchema>
