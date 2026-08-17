import { describe, expect, it } from 'vitest'
import { groundReadingGuide } from '../../src/features/grammar/domain/readingGuideGrounding'
import type { LlmReadingGuide } from '../../src/features/grammar/schemas/readingGuide.schema'

const PRIMARY_SENTENCE =
  'Data was recorded every 1 nm in the 0.4 to 0.8 μm region and every 4 nm from 0.8 to 2.5 μm.'

function step(text: string, cue = 'cue', explanation = 'explanation') {
  return { text, cue, explanation }
}

function baseLlmGuide(overrides: Partial<LlmReadingGuide> = {}): LlmReadingGuide {
  return {
    readingSteps: [step('Data'), step('was recorded')],
    connections: [],
    expressions: [],
    readingAdvice: [],
    ...overrides,
  }
}

describe('groundReadingGuide — readingSteps source grounding (unchanged since 2.1)', () => {
  it('resolves each readingStep to its exact position in the sentence', () => {
    const result = groundReadingGuide(baseLlmGuide(), PRIMARY_SENTENCE)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.readingGuide.readingSteps).toEqual([
      { text: 'Data', cue: 'cue', explanation: 'explanation', start: 0, end: 4 },
      { text: 'was recorded', cue: 'cue', explanation: 'explanation', start: 5, end: 17 },
    ])
  })

  it('rejects a readingStep whose text is not an exact substring of the sentence', () => {
    const guide = baseLlmGuide({ readingSteps: [step('Data'), step('was recorded well')] })
    const result = groundReadingGuide(guide, PRIMARY_SENTENCE)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toContain('was recorded well')
  })

  it('rejects steps given in reversed source order', () => {
    const guide = baseLlmGuide({ readingSteps: [step('every 1 nm'), step('Data')] })
    const result = groundReadingGuide(guide, PRIMARY_SENTENCE)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toContain('順序')
  })
})

describe('groundReadingGuide — Prototype 2.3C: no sentenceCore / structureBranches at all', () => {
  it('does not require a sentenceCore argument and never produces a structureBranches field', () => {
    const result = groundReadingGuide(baseLlmGuide(), PRIMARY_SENTENCE)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect('structureBranches' in result.readingGuide).toBe(false)
  })
})

describe('groundReadingGuide — blank-field tolerance (unchanged since 2.2)', () => {
  it('keeps a readingStep even when its cue and explanation are blank', () => {
    const guide = baseLlmGuide({ readingSteps: [{ text: 'Data', cue: '', explanation: '' }] })
    const result = groundReadingGuide(guide, PRIMARY_SENTENCE)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.readingGuide.readingSteps).toEqual([{ text: 'Data', cue: '', explanation: '', start: 0, end: 4 }])
  })

  it('drops a connection whose text or explanation is blank', () => {
    const guide = baseLlmGuide({
      connections: [
        { text: 'Data', explanation: '' },
        { text: '', explanation: 'something' },
        { text: 'was recorded', explanation: '受動態。' },
      ],
    })
    const result = groundReadingGuide(guide, PRIMARY_SENTENCE)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.readingGuide.connections).toEqual([{ text: 'was recorded', explanation: '受動態。' }])
  })

  it('drops an expression with a blank pattern/meaning/function even if text resolves', () => {
    const guide = baseLlmGuide({
      expressions: [
        { text: 'was recorded', pattern: '', meaning: '〜される', function: '受動態。' },
        { text: 'every 1 nm', pattern: 'every + number + unit', meaning: '〜ごとに', function: '間隔。' },
      ],
    })
    const result = groundReadingGuide(guide, PRIMARY_SENTENCE)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.readingGuide.expressions).toHaveLength(1)
    expect(result.readingGuide.expressions[0]?.text).toBe('every 1 nm')
  })

  it('drops blank readingAdvice entries', () => {
    const guide = baseLlmGuide({ readingAdvice: ['まず主語を確認する。', '', '   '] })
    const result = groundReadingGuide(guide, PRIMARY_SENTENCE)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.readingGuide.readingAdvice).toEqual(['まず主語を確認する。'])
  })
})

describe('groundReadingGuide — expression grounding (unchanged since 2.2)', () => {
  it('keeps useful grounded usage while suppressing a generic passive label', () => {
    const guide = baseLlmGuide({
      expressions: [
        { text: 'was recorded', pattern: 'be + past participle', meaning: '〜される', function: '受動態。' },
        { text: 'every 1 nm', pattern: 'every + number + unit', meaning: '〜ごとに', function: '間隔。' },
        { text: 'from 0.8 to 2.5 μm', pattern: 'from A to B', meaning: 'AからBまで', function: '範囲。' },
      ],
    })
    const result = groundReadingGuide(guide, PRIMARY_SENTENCE)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.readingGuide.expressions.map((e) => e.pattern)).toEqual(['every + number + unit', 'from A to B'])
  })

  it('drops an expression whose text is not actually in the sentence, without failing the guide', () => {
    const guide = baseLlmGuide({
      expressions: [
        { text: 'was recorded', pattern: 'be + past participle', meaning: '〜される', function: '受動態。' },
        { text: 'not only this but also that', pattern: 'not only A but also B', meaning: 'AだけでなくBも', function: 'invented' },
      ],
    })
    const result = groundReadingGuide(guide, PRIMARY_SENTENCE)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.readingGuide.expressions).toHaveLength(0)
  })

  it('grounds repeated expressions to successive source occurrences', () => {
    const sentence = 'The method is based on data and the estimate is based on observations.'
    const guide = baseLlmGuide({
      readingSteps: [step('The method'), step('is based on data'), step('and the estimate'), step('is based on observations')],
      expressions: [
        { text: 'is based on', pattern: 'be based on ~', meaning: '〜に基づく', function: '根拠を示す。' },
        { text: 'is based on', pattern: 'be based on ~', meaning: '〜に基づく', function: '根拠を示す。' },
      ],
    })
    const result = groundReadingGuide(guide, sentence)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.readingGuide.expressions.map(({ start }) => start)).toEqual([
      sentence.indexOf('is based on'),
      sentence.lastIndexOf('is based on'),
    ])
  })

  it('suppresses elementary structure notes while keeping preposition-dependent usage', () => {
    const sentence = 'The method can be rotated and is based on observations where x is the input.'
    const guide = baseLlmGuide({
      readingSteps: [step('The method'), step('can be rotated'), step('and is based on observations'), step('where x is the input')],
      expressions: [
        { text: 'can be rotated', pattern: 'can be ~', meaning: '回転できる', function: '受動態。' },
        { text: 'is based on', pattern: 'be based on ~', meaning: '〜に基づく', function: 'on以下を根拠とする。' },
        { text: 'where x is the input', pattern: 'where X is Y', meaning: 'xは入力', function: 'where節。' },
      ],
    })
    const result = groundReadingGuide(guide, sentence)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.readingGuide.expressions.map(({ text }) => text)).toEqual(['is based on'])
  })
})

describe('groundReadingGuide — connections pass through ungrounded', () => {
  it('keeps connections as-is (not grounding-validated)', () => {
    const guide = baseLlmGuide({
      connections: [{ text: 'every 1 nm ... and every 4 nm ...', explanation: '2つの条件が並列。' }],
    })
    const result = groundReadingGuide(guide, PRIMARY_SENTENCE)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.readingGuide.connections).toEqual(guide.connections)
  })
})

describe('groundReadingGuide — Prototype 2.3P: Simplified-Chinese contamination guard (item 2/4)', () => {
  it('blanks a readingStep cue/explanation containing Simplified-Chinese characters instead of dropping the step (order-safety)', () => {
    const guide = baseLlmGuide({
      readingSteps: [
        { text: 'Data', cue: 'どうなった？', explanation: '文の主语。' }, // 主语 instead of 主語
        { text: 'was recorded', cue: '过去のこと？', explanation: '受動態。' }, // 过去 instead of 過去
      ],
    })
    const result = groundReadingGuide(guide, PRIMARY_SENTENCE)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.readingGuide.readingSteps[0]).toMatchObject({ cue: 'どうなった？', explanation: '' })
    expect(result.readingGuide.readingSteps[1]).toMatchObject({ cue: '', explanation: '受動態。' })
    // The step itself is never dropped -- order/coverage stays intact.
    expect(result.readingGuide.readingSteps).toHaveLength(2)
  })

  it('drops an expression whose pattern contains Simplified-Chinese characters even though text/meaning/function all resolve fine', () => {
    const guide = baseLlmGuide({
      expressions: [
        { text: 'was recorded', pattern: '主语 + 动词', meaning: '〜される', function: '受動態。' },
        { text: 'every 1 nm', pattern: 'every + number + unit', meaning: '〜ごとに', function: '間隔。' },
      ],
    })
    const result = groundReadingGuide(guide, PRIMARY_SENTENCE)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.readingGuide.expressions).toHaveLength(1)
    expect(result.readingGuide.expressions[0]?.text).toBe('every 1 nm')
  })

  it('drops an expression whose meaning or function (not just pattern) contains Simplified-Chinese characters', () => {
    const guide = baseLlmGuide({
      expressions: [
        { text: 'was recorded', pattern: 'be + past participle', meaning: '〜される', function: '过去分词で受動態を示す。' },
      ],
    })
    const result = groundReadingGuide(guide, PRIMARY_SENTENCE)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.readingGuide.expressions).toHaveLength(0)
  })

  it('drops a connection whose explanation contains Simplified-Chinese characters', () => {
    const guide = baseLlmGuide({
      connections: [
        { text: 'Data ... was recorded', explanation: '主语と述语の关系。' },
        { text: 'was recorded', explanation: '受動態。' },
      ],
    })
    const result = groundReadingGuide(guide, PRIMARY_SENTENCE)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.readingGuide.connections).toEqual([{ text: 'was recorded', explanation: '受動態。' }])
  })

  it('drops a readingAdvice entry containing Simplified-Chinese characters', () => {
    const guide = baseLlmGuide({ readingAdvice: ['まず主語を確認する。', '先确认主语和动词。'] })
    const result = groundReadingGuide(guide, PRIMARY_SENTENCE)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.readingGuide.readingAdvice).toEqual(['まず主語を確認する。'])
  })

  it('never flags correct pure-kanji Japanese grammar terminology (item 4 regression guard)', () => {
    const guide = baseLlmGuide({
      readingSteps: [{ text: 'Data', cue: '何について？', explanation: '文の主語。' }],
      expressions: [{ text: 'was recorded', pattern: 'be + 過去分詞', meaning: '〜される', function: '受動態を示す。' }],
      connections: [{ text: 'Data ... was recorded', explanation: '主語と述語の関係。' }],
      readingAdvice: ['まず主語と動詞を確認し、現在完了かどうかを見極める。'],
    })
    const result = groundReadingGuide(guide, PRIMARY_SENTENCE)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.readingGuide.readingSteps[0]).toMatchObject({ cue: '何について？', explanation: '文の主語。' })
    expect(result.readingGuide.expressions).toHaveLength(1)
    expect(result.readingGuide.connections).toHaveLength(1)
    expect(result.readingGuide.readingAdvice).toHaveLength(1)
  })
})
