import { describe, expect, it } from 'vitest'
import { llmReadingGuideSchema } from '../../src/features/grammar/schemas/readingGuide.schema'
import { READING_GUIDE_JSON_SCHEMA } from '../../src/features/grammar/schemas/readingGuide.jsonSchema'

const VALID = {
  readingSteps: [{ targetId: 'tree-0', guidance: 'ひとまとまりとして読む。' }],
  expressions: [{ text: 'is based on', pattern: 'be based on ~', meaning: '〜に基づく', function: '根拠を結ぶ。' }],
}

describe('Tree-authoritative ReadingGuide schema', () => {
  it('accepts targetId/guidance notes and sentence-wide Expressions', () => {
    expect(llmReadingGuideSchema.safeParse(VALID).success).toBe(true)
  })

  it('allows no note when every target is trivial', () => {
    expect(llmReadingGuideSchema.safeParse({ ...VALID, readingSteps: [] }).success).toBe(true)
  })

  it('rejects model text, cue, explanation, or numeric offsets as note authority', () => {
    expect(llmReadingGuideSchema.safeParse({ ...VALID, readingSteps: [{
      targetId: 'tree-0', guidance: '読む。', text: 'invented', start: 0, end: 8,
    }] }).success).toBe(false)
    expect(llmReadingGuideSchema.safeParse({ ...VALID, readingSteps: [{ targetId: 'tree-0' }] }).success).toBe(false)
  })

  it('requires only readingSteps and expressions in the Ollama JSON schema', () => {
    expect(READING_GUIDE_JSON_SCHEMA.required).toEqual(['readingSteps', 'expressions'])
    expect(READING_GUIDE_JSON_SCHEMA.properties.readingSteps.items.required).toEqual(['targetId', 'guidance'])
  })

  it('rejects an Expression missing a required teaching field', () => {
    expect(llmReadingGuideSchema.safeParse({
      ...VALID,
      expressions: [{ text: 'is based on', pattern: 'be based on ~', meaning: '〜に基づく' }],
    }).success).toBe(false)
  })

  it('rejects a missing top-level expressions field', () => {
    const { expressions: _expressions, ...invalid } = VALID
    expect(llmReadingGuideSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects non-array readingSteps and expressions fields', () => {
    expect(llmReadingGuideSchema.safeParse({ ...VALID, readingSteps: 'tree-0' }).success).toBe(false)
    expect(llmReadingGuideSchema.safeParse({ ...VALID, expressions: {} }).success).toBe(false)
  })

  it('keeps the structured-output schema non-recursive', () => {
    expect(JSON.stringify(READING_GUIDE_JSON_SCHEMA)).not.toContain('$ref')
  })

  it('does not reintroduce legacy model-owned tree or span fields', () => {
    const serialized = JSON.stringify(READING_GUIDE_JSON_SCHEMA)
    for (const field of ['structureBranches', 'attachTo', 'parentIndex', 'nodeId', 'connections', 'readingAdvice']) {
      expect(serialized).not.toContain(field)
    }
  })
})
