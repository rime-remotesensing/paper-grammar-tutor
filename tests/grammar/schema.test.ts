import { describe, expect, it } from 'vitest'
import { llmGrammarAnalysisSchema } from '../../src/features/grammar/schemas/grammarAnalysis.schema'
import { validAnalysisFixture } from '../fixtures/validAnalysisFixture'

describe('llmGrammarAnalysisSchema', () => {
  it('accepts a well-formed analysis', () => {
    const result = llmGrammarAnalysisSchema.safeParse(validAnalysisFixture)
    expect(result.success).toBe(true)
  })

  it('rejects a payload missing a required field', () => {
    const { sentenceCore: _sentenceCore, ...withoutSentenceCore } = validAnalysisFixture
    const result = llmGrammarAnalysisSchema.safeParse(withoutSentenceCore)
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
      sentenceCore: {
        ...validAnalysisFixture.sentenceCore,
        indirectObject: { text: 'users', start: 0, end: 5 },
        object: { text: 'feedback', start: 6, end: 14 },
      },
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
      sentenceCore: {
        ...validAnalysisFixture.sentenceCore,
        object: null,
        complement: null,
      },
    }
    const result = llmGrammarAnalysisSchema.safeParse(withNulls)
    expect(result.success).toBe(true)
  })
})
