import { z } from 'zod'

/** Prototype 2.6B6: the application supplies final-Tree target IDs. The model writes only
 * guidance and never echoes source text or invents offsets. */
export const readingStepSchema = z.object({
  targetId: z.string().min(1),
  guidance: z.string(),
}).strict()
export type LlmReadingStep = z.infer<typeof readingStepSchema>

export interface ReadingNote {
  targetId: string
  guidance: string
}

export const expressionSchema = z.object({
  text: z.string().min(1),
  pattern: z.string(),
  meaning: z.string(),
  function: z.string(),
}).strict()
export type LlmExpression = z.infer<typeof expressionSchema>

export const resolvedExpressionSchema = expressionSchema.extend({
  start: z.number().int(),
  end: z.number().int(),
})
export type Expression = z.infer<typeof resolvedExpressionSchema>

export const llmReadingGuideSchema = z.object({
  readingSteps: z.array(readingStepSchema),
  expressions: z.array(expressionSchema),
}).strict()
export type LlmReadingGuide = z.infer<typeof llmReadingGuideSchema>

export interface ReadingGuide {
  readingSteps: ReadingNote[]
  expressions: Expression[]
}

/** Legacy B5 span type retained only for deterministic safety-regression tests and any
 * migration fallback. Tree-authoritative production lookup does not consume it. */
export interface ResolvedReadingStep {
  text: string
  cue: string
  explanation: string
  start: number
  end: number
}
