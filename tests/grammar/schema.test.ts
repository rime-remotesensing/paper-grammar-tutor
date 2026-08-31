import { describe, expect, it } from 'vitest'
import { llmGrammarAnalysisSchema } from '../../src/features/grammar/schemas/grammarAnalysis.schema'
import { GRAMMAR_ANALYSIS_JSON_SCHEMA } from '../../src/features/grammar/schemas/grammarAnalysis.jsonSchema'
import { validAnalysisFixture } from '../fixtures/validAnalysisFixture'

describe('llmGrammarAnalysisSchema', () => {
  it('accepts a well-formed analysis', () => {
    const result = llmGrammarAnalysisSchema.safeParse(validAnalysisFixture)
    expect(result.success).toBe(true)
  })

  it('rejects a payload missing a required field', () => {
    const { sentenceCoreSet: _sentenceCoreSet, ...withoutSentenceCoreSet } = validAnalysisFixture
    const result = llmGrammarAnalysisSchema.safeParse(withoutSentenceCoreSet)
    expect(result.success).toBe(false)
  })

  it('rejects an invalid enum value for a clause grammaticalRole', () => {
    const invalid = {
      ...validAnalysisFixture,
      clauses: [{ ...validAnalysisFixture.clauses[0], grammaticalRole: 'indirectObject' }],
    }
    const result = llmGrammarAnalysisSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('accepts null for indirectObject and a filled object together (SVOO shape)', () => {
    const svoo = {
      ...validAnalysisFixture,
      sentenceCoreSet: { ...validAnalysisFixture.sentenceCoreSet, predicateCores: [{
        ...validAnalysisFixture.sentenceCoreSet.predicateCores[0],
        indirectObject: { text: 'users', start: 0, end: 5 }, object: { text: 'feedback', start: 6, end: 14 },
      }] },
    }
    const result = llmGrammarAnalysisSchema.safeParse(svoo)
    expect(result.success).toBe(true)
  })

  it('rejects a confidence value outside [0, 1]', () => {
    const invalid = { ...validAnalysisFixture, confidence: 1.5 }
    const result = llmGrammarAnalysisSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('accepts confidence at the boundary values 0 and 1', () => {
    expect(llmGrammarAnalysisSchema.safeParse({ ...validAnalysisFixture, confidence: 0 }).success).toBe(true)
    expect(llmGrammarAnalysisSchema.safeParse({ ...validAnalysisFixture, confidence: 1 }).success).toBe(true)
  })

  it('rejects a confidence value below 0', () => {
    const invalid = { ...validAnalysisFixture, confidence: -0.1 }
    const result = llmGrammarAnalysisSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('accepts null for optional sentence-core spans', () => {
    const withNulls = {
      ...validAnalysisFixture,
      sentenceCoreSet: { ...validAnalysisFixture.sentenceCoreSet, predicateCores: [{
        ...validAnalysisFixture.sentenceCoreSet.predicateCores[0], object: null, complement: null,
      }] },
    }
    const result = llmGrammarAnalysisSchema.safeParse(withNulls)
    expect(result.success).toBe(true)
  })

  it('no longer defines chunks or readingHint anywhere in the LLM-facing schemas', () => {
    // Zod's z.object() silently strips unknown keys by default, so even if an old/stale
    // model response still included these keys, they must never survive into the parsed
    // result -- proving the app-facing type genuinely has no such property, not just an
    // optional one.
    const legacyShapedPayload = {
      ...validAnalysisFixture,
      chunks: [{ span: { text: 'x', start: 0, end: 1 }, order: 0 }],
      readingHint: ['some hint'],
    }
    const result = llmGrammarAnalysisSchema.safeParse(legacyShapedPayload)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty('chunks')
      expect(result.data).not.toHaveProperty('readingHint')
    }

    // The JSON Schema handed to Ollama's structured-output `format` must not ask the model
    // to generate these fields at all -- this is the actual output-token reduction lever,
    // not just app-side stripping after the fact.
    expect(GRAMMAR_ANALYSIS_JSON_SCHEMA.properties).not.toHaveProperty('chunks')
    expect(GRAMMAR_ANALYSIS_JSON_SCHEMA.properties).not.toHaveProperty('readingHint')
    expect(GRAMMAR_ANALYSIS_JSON_SCHEMA.required).not.toContain('chunks')
    expect(GRAMMAR_ANALYSIS_JSON_SCHEMA.required).not.toContain('readingHint')
  })

  it('still requires modifiers, clauses, phrases, vocabulary, and referenceTranslation', () => {
    expect(GRAMMAR_ANALYSIS_JSON_SCHEMA.required).toEqual(
      expect.arrayContaining(['sentenceCoreSet', 'modifiers', 'clauses', 'phrases', 'vocabulary', 'referenceTranslation']),
    )
    expect(GRAMMAR_ANALYSIS_JSON_SCHEMA.properties).toHaveProperty('modifiers')
    expect(GRAMMAR_ANALYSIS_JSON_SCHEMA.properties).toHaveProperty('clauses')
    expect(GRAMMAR_ANALYSIS_JSON_SCHEMA.properties).toHaveProperty('phrases')
    expect(GRAMMAR_ANALYSIS_JSON_SCHEMA.properties).toHaveProperty('vocabulary')
    expect(GRAMMAR_ANALYSIS_JSON_SCHEMA.properties).toHaveProperty('referenceTranslation')
  })
})
