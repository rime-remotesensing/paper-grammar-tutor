import { describe, expect, it } from 'vitest'
import { getModelSizeAdvisory, parseModelSizeB } from '../../src/features/grammar/domain/modelSizeAdvisory'

describe('parseModelSizeB', () => {
  it('parses a size from common naming conventions', () => {
    expect(parseModelSizeB('qwen2.5:3b-instruct')).toBe(3)
    expect(parseModelSizeB('qwen2.5:7b-instruct')).toBe(7)
    expect(parseModelSizeB('qwen2.5:14b-instruct')).toBe(14)
    expect(parseModelSizeB('llama3:70b')).toBe(70)
  })

  it('returns null when no size pattern is present', () => {
    expect(parseModelSizeB('my-custom-model')).toBeNull()
  })
})

describe('getModelSizeAdvisory', () => {
  it('warns for models below the advisory threshold', () => {
    expect(getModelSizeAdvisory('qwen2.5:3b-instruct')).toMatch(/3B級モデル/)
  })

  it('does not warn for 7B or larger models', () => {
    expect(getModelSizeAdvisory('qwen2.5:7b-instruct')).toBeNull()
    expect(getModelSizeAdvisory('qwen2.5:14b-instruct')).toBeNull()
  })

  it('does not warn when the size cannot be determined', () => {
    expect(getModelSizeAdvisory('my-custom-model')).toBeNull()
  })
})
