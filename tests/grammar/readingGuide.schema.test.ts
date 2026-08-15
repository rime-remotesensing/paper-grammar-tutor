import { describe, expect, it } from 'vitest'
import { llmReadingGuideSchema } from '../../src/features/grammar/schemas/readingGuide.schema'
import { READING_GUIDE_JSON_SCHEMA } from '../../src/features/grammar/schemas/readingGuide.jsonSchema'

// Prototype 2.3C: structureBranches (Prototype 2.2B/2.2C's fixed-depth attachment tree) is
// removed entirely from ReadingGuide — structure is now a separate, dedicated LLM call
// (predicateStructure.schema.ts). This file only covers what remains: readingSteps,
// connections, expressions, readingAdvice.

const VALID_LLM_READING_GUIDE = {
  readingSteps: [
    { text: 'Data', cue: '何について？', explanation: 'この文の主語。まず話題の中心をつかむ。' },
    { text: 'was recorded', cue: 'どうなった？', explanation: 'Dataに起きたこと。be+過去分詞の受動態。' },
  ],
  connections: [{ text: 'Data と was recorded', explanation: '主語と動詞の関係。' }],
  expressions: [
    { text: 'was recorded', pattern: 'be + past participle', meaning: '〜される', function: '受動態。' },
  ],
  readingAdvice: ['まず主語と動詞を確定してから、後ろの情報を追加として読む。'],
}

describe('llmReadingGuideSchema', () => {
  it('accepts a valid response', () => {
    expect(llmReadingGuideSchema.safeParse(VALID_LLM_READING_GUIDE).success).toBe(true)
  })

  it('rejects a readingSteps entry missing a required field', () => {
    const invalid = { ...VALID_LLM_READING_GUIDE, readingSteps: [{ text: 'Data', cue: '何について？' }] }
    expect(llmReadingGuideSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects an empty readingSteps array (at least one step is required)', () => {
    const invalid = { ...VALID_LLM_READING_GUIDE, readingSteps: [] }
    expect(llmReadingGuideSchema.safeParse(invalid).success).toBe(false)
  })

  it('accepts a readingStep with just text/cue/explanation', () => {
    const minimalStep = { ...VALID_LLM_READING_GUIDE, readingSteps: [{ text: 'Data', cue: '何について？', explanation: '主語。' }] }
    expect(llmReadingGuideSchema.safeParse(minimalStep).success).toBe(true)
  })

  it('rejects a malformed expression missing the "function" field', () => {
    const invalid = {
      ...VALID_LLM_READING_GUIDE,
      expressions: [{ text: 'was recorded', pattern: 'be + past participle', meaning: '〜される' }],
    }
    expect(llmReadingGuideSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects a missing top-level field (readingAdvice)', () => {
    const { readingAdvice: _readingAdvice, ...invalid } = VALID_LLM_READING_GUIDE
    expect(llmReadingGuideSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects a non-array connections field', () => {
    const invalid = { ...VALID_LLM_READING_GUIDE, connections: 'not an array' }
    expect(llmReadingGuideSchema.safeParse(invalid).success).toBe(false)
  })

  it('accepts an empty expressions/connections/readingAdvice array (a simple sentence may have none)', () => {
    const valid = { ...VALID_LLM_READING_GUIDE, expressions: [], connections: [], readingAdvice: [] }
    expect(llmReadingGuideSchema.safeParse(valid).success).toBe(true)
  })
})

describe('READING_GUIDE_JSON_SCHEMA — no structural tree fields at all (Prototype 2.3C)', () => {
  it('never declares structureBranches/attachTo/parent/parentIndex/nodeId', () => {
    const serialized = JSON.stringify(READING_GUIDE_JSON_SCHEMA)
    expect(serialized).not.toContain('structureBranches')
    expect(serialized).not.toContain('attachTo')
    expect(serialized).not.toContain('"parent"')
    expect(serialized).not.toContain('"parentIndex"')
    expect(serialized).not.toContain('"nodeId"')
  })

  it('never uses $ref (no recursive schema shape)', () => {
    const serialized = JSON.stringify(READING_GUIDE_JSON_SCHEMA)
    expect(serialized).not.toContain('$ref')
  })

  it('required fields are exactly readingSteps/connections/expressions/readingAdvice', () => {
    expect(READING_GUIDE_JSON_SCHEMA.required).toEqual(['readingSteps', 'connections', 'expressions', 'readingAdvice'])
  })
})
