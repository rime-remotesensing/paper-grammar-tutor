import { describe, expect, it } from 'vitest'
import { tryParseJson } from '../../src/utils/jsonExtract'

describe('tryParseJson', () => {
  it('parses plain JSON', () => {
    const result = tryParseJson('{"a": 1}')
    expect(result).toEqual({ value: { a: 1 } })
  })

  it('strips markdown code fences', () => {
    const result = tryParseJson('```json\n{"a": 1}\n```')
    expect(result).toEqual({ value: { a: 1 } })
  })

  it('strips stray prose around the JSON object', () => {
    const result = tryParseJson('Here is the result:\n{"a": 1}\nHope that helps!')
    expect(result).toEqual({ value: { a: 1 } })
  })

  it('reports an error for unparsable text', () => {
    const result = tryParseJson('not json at all')
    expect('error' in result).toBe(true)
  })
})
