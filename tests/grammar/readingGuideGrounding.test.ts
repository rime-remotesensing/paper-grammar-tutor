import { describe, expect, it } from 'vitest'
import { groundReadingGuide } from '../../src/features/grammar/domain/readingGuideGrounding'
import type { TreeReadingTarget } from '../../src/features/grammar/domain/treeReadingTargets'
import type { LlmReadingGuide } from '../../src/features/grammar/schemas/readingGuide.schema'

const SENTENCE = 'The method is based on data and is based on observations.'
const TARGETS: TreeReadingTarget[] = [
  {
    targetId: 'tree-0', nodeKey: '0:10:subject', authoritativeStart: 0, authoritativeEnd: 10,
    interactionStart: 0, interactionEnd: 10, displayText: 'The method', authorityText: 'The method',
    interactionText: 'The method', role: 'subject', parentTargetId: null, parentDisplayText: null,
  },
  {
    targetId: 'tree-0-0', nodeKey: '11:35:predicate', authoritativeStart: 11, authoritativeEnd: 35,
    interactionStart: 11, interactionEnd: 35, displayText: 'is based on data', authorityText: 'is based on data',
    interactionText: 'is based on data', role: 'predicate', parentTargetId: 'tree-0', parentDisplayText: 'The method',
  },
]

function guide(overrides: Partial<LlmReadingGuide> = {}): LlmReadingGuide {
  return {
    readingSteps: [{ targetId: 'tree-0', guidance: 'まず主語をひとまとまりで受け取る。' }],
    expressions: [],
    ...overrides,
  }
}

describe('groundReadingGuide — Tree-authoritative notes', () => {
  it('keeps only requested target IDs without deriving source offsets', () => {
    const result = groundReadingGuide(guide(), SENTENCE, TARGETS)
    expect(result.readingGuide.readingSteps).toEqual([
      { targetId: 'tree-0', guidance: 'まず主語をひとまとまりで受け取る。' },
    ])
    expect(result.invalidTargetIds).toEqual([])
  })

  it('drops and reports unknown target IDs while preserving valid notes', () => {
    const result = groundReadingGuide(guide({ readingSteps: [
      { targetId: 'unknown', guidance: '表示しない。' },
      { targetId: 'tree-0-0', guidance: '後ろの対象まで一続きに読む。' },
    ] }), SENTENCE, TARGETS)
    expect(result.invalidTargetIds).toEqual(['unknown'])
    expect(result.readingGuide.readingSteps.map(({ targetId }) => targetId)).toEqual(['tree-0-0'])
  })

  it('drops all duplicated IDs as ambiguous and drops Simplified-Chinese guidance', () => {
    const result = groundReadingGuide(guide({ readingSteps: [
      { targetId: 'tree-0', guidance: '最初の有効な説明。' },
      { targetId: 'tree-0', guidance: '重複。' },
      { targetId: 'tree-0-0', guidance: '先确认主语。' },
    ] }), SENTENCE, TARGETS)
    expect(result.readingGuide.readingSteps).toEqual([])
    expect(result.duplicateTargetIds).toEqual(['tree-0'])
  })
})

describe('groundReadingGuide — persistent Expressions', () => {
  it('grounds reusable expressions sentence-wide', () => {
    const result = groundReadingGuide(guide({ expressions: [
      { text: 'is based on', pattern: 'be based on ~', meaning: '〜に基づく', function: 'on以下を根拠として結ぶ。' },
    ] }), SENTENCE, TARGETS)
    expect(result.readingGuide.expressions[0]).toMatchObject({ text: 'is based on', start: 11, end: 22 })
  })

  it('grounds repeated expressions to successive occurrences', () => {
    const expression = { text: 'is based on', pattern: 'be based on ~', meaning: '〜に基づく', function: '根拠を示す。' }
    const result = groundReadingGuide(guide({ expressions: [expression, expression] }), SENTENCE, TARGETS)
    expect(result.readingGuide.expressions.map(({ start }) => start)).toEqual([
      SENTENCE.indexOf('is based on'), SENTENCE.lastIndexOf('is based on'),
    ])
  })

  it('drops fabricated, incomplete, elementary, or wrong-language expressions', () => {
    const result = groundReadingGuide(guide({ expressions: [
      { text: 'missing phrase', pattern: 'missing ~', meaning: '捏造', function: '捏造' },
      { text: 'is based on', pattern: '', meaning: '〜に基づく', function: '根拠' },
      { text: 'is based on', pattern: 'be + past participle', meaning: '〜される', function: '受動態' },
      { text: 'is based on', pattern: 'be based on ~', meaning: '〜に基づく', function: '使用动词说明。' },
    ] }), SENTENCE, TARGETS)
    expect(result.readingGuide.expressions).toEqual([])
  })

  it('drops a be-based-on pattern attached to unrelated text or citation-bearing teaching', () => {
    const result = groundReadingGuide(guide({ expressions: [
      { text: 'The method', pattern: 'be based on ~', meaning: '〜に基づく', function: '誤対応。' },
      { text: 'is based on', pattern: 'be based on ~', meaning: '〜に基づく', function: 'Smith et al. 2020を参照。' },
    ] }), SENTENCE, TARGETS)
    expect(result.readingGuide.expressions).toEqual([])
  })
})

describe('groundReadingGuide — B6 audit invariants', () => {
  it('drops every ambiguous duplicate note and reports its target ID', () => {
    const result = groundReadingGuide(guide({ readingSteps: [
      { targetId: 'tree-0', guidance: '最初の説明。' },
      { targetId: 'tree-0', guidance: '競合する説明。' },
    ] }), SENTENCE, TARGETS)
    expect(result.readingGuide.readingSteps).toEqual([])
    expect(result.duplicateTargetIds).toEqual(['tree-0'])
  })

  it('drops blank guidance without invalidating a different valid target', () => {
    const result = groundReadingGuide(guide({ readingSteps: [
      { targetId: 'tree-0', guidance: '   ' },
      { targetId: 'tree-0-0', guidance: '述部を根拠まで続けて読む。' },
    ] }), SENTENCE, TARGETS)
    expect(result.readingGuide.readingSteps).toEqual([
      { targetId: 'tree-0-0', guidance: '述部を根拠まで続けて読む。' },
    ])
  })

  it('drops Simplified-Chinese guidance without disturbing valid Japanese guidance', () => {
    const result = groundReadingGuide(guide({ readingSteps: [
      { targetId: 'tree-0', guidance: '先确认主语。' },
      { targetId: 'tree-0-0', guidance: '述部をひとまとまりで読む。' },
    ] }), SENTENCE, TARGETS)
    expect(result.readingGuide.readingSteps.map(({ targetId }) => targetId)).toEqual(['tree-0-0'])
  })

  it('accepts returned target IDs in a different order without fuzzy remapping', () => {
    const result = groundReadingGuide(guide({ readingSteps: [
      { targetId: 'tree-0-0', guidance: '述部。' },
      { targetId: 'tree-0', guidance: '主語。' },
    ] }), SENTENCE, TARGETS)
    expect(result.readingGuide.readingSteps.map(({ targetId }) => targetId)).toEqual(['tree-0-0', 'tree-0'])
    expect(result.invalidTargetIds).toEqual([])
  })

  it('allows a useful requested target to be omitted as an explicit subset response', () => {
    const result = groundReadingGuide(guide({
      readingSteps: [{ targetId: 'tree-0', guidance: '主語。' }],
    }), SENTENCE, TARGETS)
    expect(result.readingGuide.readingSteps).toHaveLength(1)
    expect(result.readingGuide.readingSteps.some(({ targetId }) => targetId === 'tree-0-0')).toBe(false)
  })

  it.each(['pattern', 'meaning', 'function'] as const)(
    'drops an Expression with blank %s',
    (field) => {
      const expression = {
        text: 'is based on', pattern: 'be based on ~', meaning: '〜に基づく', function: '根拠を結ぶ。',
        [field]: ' ',
      }
      expect(groundReadingGuide(guide({ expressions: [expression] }), SENTENCE, TARGETS)
        .readingGuide.expressions).toEqual([])
    },
  )

  it('keeps pure-kanji Japanese terminology in otherwise valid guidance', () => {
    const result = groundReadingGuide(guide({
      readingSteps: [{ targetId: 'tree-0', guidance: '主節述部確認' }],
    }), SENTENCE, TARGETS)
    expect(result.readingGuide.readingSteps).toEqual([{ targetId: 'tree-0', guidance: '主節述部確認' }])
  })
})

/**
 * Prototype 2.6G2.7B track B: the pre-existing suite above already exercises
 * groundExpressions with "be based on ~" as its only pattern -- these tests exist to prove
 * the grounding pipeline itself is pattern-agnostic (never a "be based on"-only mechanism),
 * covering the other required expression classes (B5) and the inflection-normalization
 * model (B6/B7: the LLM normalizes `pattern`, `text` stays the literal grounded substring --
 * grounding must never require the normalized `pattern` to equal `text`).
 */
describe('Prototype 2.6G2.7B track B — general expression-class grounding (not a be-based-on-only path)', () => {
  it('grounds a predicate + preposition expression ("result from ~")', () => {
    const sentence = 'The observed differences result from changes in land cover.'
    const result = groundReadingGuide(guide({ expressions: [
      { text: 'result from', pattern: 'result from ~', meaning: '〜に由来する', function: 'from 以下を発生源として結びつける。' },
    ] }), sentence, [])
    expect(result.readingGuide.expressions[0]).toMatchObject({ text: 'result from', pattern: 'result from ~' })
  })

  it('grounds a passive/participial + preposition expression ("be associated with ~")', () => {
    const sentence = 'The results are associated with rainfall intensity.'
    const result = groundReadingGuide(guide({ expressions: [
      { text: 'are associated with', pattern: 'be associated with ~', meaning: '〜に関連している', function: 'with 以下を関連付ける。' },
    ] }), sentence, [])
    expect(result.readingGuide.expressions[0]).toMatchObject({ text: 'are associated with', pattern: 'be associated with ~' })
  })

  it('grounds a fixed prepositional academic phrase ("in terms of ~")', () => {
    const sentence = 'The model performs well in terms of accuracy.'
    const result = groundReadingGuide(guide({ expressions: [
      { text: 'in terms of', pattern: 'in terms of ~', meaning: '〜の観点で', function: '評価の基準となる観点を示す。' },
    ] }), sentence, [])
    expect(result.readingGuide.expressions[0]).toMatchObject({ text: 'in terms of', pattern: 'in terms of ~' })
  })

  it('grounds a common academic passive/use construction ("be widely used in ~")', () => {
    const sentence = 'This approach is widely used in remote sensing studies.'
    const result = groundReadingGuide(guide({ expressions: [
      { text: 'is widely used in', pattern: 'be widely used in ~', meaning: '〜で広く使用されている', function: 'in 以下を利用の場として示す。' },
    ] }), sentence, [])
    expect(result.readingGuide.expressions[0]).toMatchObject({ text: 'is widely used in', pattern: 'be widely used in ~' })
  })

  it.each([
    ['was based on', 'be based on ~'],
    ['are based on', 'be based on ~'],
    ['were associated with', 'be associated with ~'],
    ['is associated with', 'be associated with ~'],
    ['resulted from', 'result from ~'],
    ['was widely used in', 'be widely used in ~'],
    ['are widely used in', 'be widely used in ~'],
  ])('normalizes the inflected surface form %s to the same base learning pattern %s', (text, pattern) => {
    const sentence = `A sentence where the model ${text} something relevant.`
    const result = groundReadingGuide(guide({ expressions: [
      { text, pattern, meaning: '〜という意味', function: '関係を示す。' },
    ] }), sentence, [])
    expect(result.readingGuide.expressions[0]).toMatchObject({ text, pattern })
  })

  it('the normalized learning pattern need not literally equal the grounded source text (B7)', () => {
    const sentence = 'The observed differences resulted from changes in land cover.'
    const result = groundReadingGuide(guide({ expressions: [
      { text: 'resulted from', pattern: 'result from ~', meaning: '〜に由来する', function: '原因を示す。' },
    ] }), sentence, [])
    const [expression] = result.readingGuide.expressions
    expect(expression.text).toBe('resulted from')
    expect(expression.pattern).toBe('result from ~')
    expect(expression.text).not.toBe(expression.pattern)
    // Source truth (the real grounded span) is preserved separately from the pedagogical form.
    expect(expression.start).toBe(sentence.indexOf('resulted from'))
    expect(expression.end).toBe(sentence.indexOf('resulted from') + 'resulted from'.length)
  })

  it('an ordinary negative-control sentence with no fixed academic collocation stays empty', () => {
    const sentence = 'The sensor recorded temperature every hour.'
    const result = groundReadingGuide(guide({ expressions: [] }), sentence, [])
    expect(result.readingGuide.expressions).toEqual([])
  })

  it('does not deduplicate two genuinely different expressions occurring once each (no false merge)', () => {
    const sentence = 'The model is based on satellite data and performs well in terms of accuracy.'
    const result = groundReadingGuide(guide({ expressions: [
      { text: 'is based on', pattern: 'be based on ~', meaning: '〜に基づく', function: '根拠を示す。' },
      { text: 'in terms of', pattern: 'in terms of ~', meaning: '〜の観点で', function: '評価基準を示す。' },
    ] }), sentence, [])
    expect(result.readingGuide.expressions.map((e) => e.pattern)).toEqual(['be based on ~', 'in terms of ~'])
  })

  it('rejects an exact-duplicate span even across two different patterns claimed for it (no double-counting one occurrence)', () => {
    const sentence = 'The results are associated with rainfall intensity.'
    const result = groundReadingGuide(guide({ expressions: [
      { text: 'are associated with', pattern: 'be associated with ~', meaning: '〜に関連している', function: '関連を示す。' },
      { text: 'are associated with', pattern: 'be linked to ~', meaning: '重複主張。', function: '重複。' },
    ] }), sentence, [])
    expect(result.readingGuide.expressions).toHaveLength(1)
  })

  it('expressions remain sentence-wide regardless of which (or no) Tree targets are supplied (B11)', () => {
    const sentence = 'The results are associated with rainfall intensity.'
    const withNoTargets = groundReadingGuide(guide({ expressions: [
      { text: 'are associated with', pattern: 'be associated with ~', meaning: '〜に関連している', function: '関連を示す。' },
    ] }), sentence, [])
    const withUnrelatedTarget = groundReadingGuide(guide({ expressions: [
      { text: 'are associated with', pattern: 'be associated with ~', meaning: '〜に関連している', function: '関連を示す。' },
    ] }), sentence, TARGETS)
    expect(withNoTargets.readingGuide.expressions).toEqual(withUnrelatedTarget.readingGuide.expressions)
  })
})
