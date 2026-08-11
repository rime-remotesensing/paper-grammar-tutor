import { describe, expect, it } from 'vitest'
import { GRAMMAR_ANALYSIS_JSON_SCHEMA } from '../../src/features/grammar/schemas/grammarAnalysis.jsonSchema'
import { llmGrammarAnalysisSchema } from '../../src/features/grammar/schemas/grammarAnalysis.schema'
import { validAnalysisFixture } from '../fixtures/validAnalysisFixture'

// Regression coverage for the structured-output robustness fix: the JSON Schema passed
// to Ollama's `format` field must declare the same confidence range as the Zod schema
// that validates the response afterwards. Before this fix, the JSON Schema only said
// `{ type: 'number' }` with no bounds, so Ollama's constrained decoding had no reason
// to keep the model from emitting a value outside [0, 1] — only Zod caught it, after
// the fact, as a validation failure with no field-path context.
describe('GRAMMAR_ANALYSIS_JSON_SCHEMA confidence bounds', () => {
  const confidenceSchema = GRAMMAR_ANALYSIS_JSON_SCHEMA.properties.confidence

  it('declares the same [0, 1] range as the Zod schema', () => {
    expect(confidenceSchema.minimum).toBe(0)
    expect(confidenceSchema.maximum).toBe(1)
  })

  it.each([0, 1])('confidence=%d is within JSON Schema bounds and accepted by Zod', (value) => {
    expect(value).toBeGreaterThanOrEqual(confidenceSchema.minimum)
    expect(value).toBeLessThanOrEqual(confidenceSchema.maximum)
    const result = llmGrammarAnalysisSchema.safeParse({ ...validAnalysisFixture, confidence: value })
    expect(result.success).toBe(true)
  })

  it.each([-0.1, 1.1])('confidence=%d is outside JSON Schema bounds and rejected by Zod', (value) => {
    const withinBounds = value >= confidenceSchema.minimum && value <= confidenceSchema.maximum
    expect(withinBounds).toBe(false)
    const result = llmGrammarAnalysisSchema.safeParse({ ...validAnalysisFixture, confidence: value })
    expect(result.success).toBe(false)
  })
})
