import { describe, expect, it } from 'vitest'
import { findVocabularyForTreeNode, groundVocabularyForDisplay, prepareVocabularyForDisplay, vocabularyPartOfSpeechLabel } from '../../src/features/grammar/domain/vocabularyPresentation'
import { vocabularyItemSchema } from '../../src/features/grammar/schemas/grammarAnalysis.schema'

describe('prepareVocabularyForDisplay', () => {
  it('removes standalone function words and preserves content-word source order', () => {
    const result = prepareVocabularyForDisplay([
      { word: 'These', contextualMeaning: 'これらの', partOfSpeech: 'other' },
      { word: 'differences', contextualMeaning: '差異', partOfSpeech: 'noun' },
      { word: 'in', contextualMeaning: '〜に', partOfSpeech: 'other' },
      { word: 'by', contextualMeaning: '〜によって', partOfSpeech: 'other' },
      { word: 'from', contextualMeaning: '〜から', partOfSpeech: 'other' },
      { word: 'accuracy', contextualMeaning: '精度', partOfSpeech: 'noun' },
    ])
    expect(result.map(({ word }) => word)).toEqual(['differences', 'accuracy'])
  })

  it('keeps academically important relational adverbs as vocabulary', () => {
    const result = groundVocabularyForDisplay([
      { word: 'respectively', contextualMeaning: 'それぞれ、各々その順に', partOfSpeech: 'adverb' },
      { word: 'approximately', contextualMeaning: 'およそ', partOfSpeech: 'adverb' },
    ], 'The values were respectively and approximately assigned.')

    expect(result.map(({ word, partOfSpeech }) => ({ word, partOfSpeech }))).toEqual([
      { word: 'respectively', partOfSpeech: 'adverb' },
      { word: 'approximately', partOfSpeech: 'adverb' },
    ])
  })

  it('recovers a source-grounded respectively item when the model omits the required word', () => {
    const sentence = 'a and b are 10 and 20, respectively.'
    const result = groundVocabularyForDisplay([], sentence)

    expect(result).toEqual([{
      word: 'respectively',
      contextualMeaning: 'それぞれ、各々その順に',
      partOfSpeech: 'adverb',
      start: 23,
      end: 35,
    }])
  })

  it('does not duplicate a generated respectively occurrence', () => {
    const result = groundVocabularyForDisplay([{
      word: 'respectively',
      contextualMeaning: 'それぞれ',
      partOfSpeech: 'adverb',
    }], '10 and 20, respectively.')

    expect(result).toHaveLength(1)
    expect(result[0]?.contextualMeaning).toBe('それぞれ')
  })

  it('keeps repeated respectively occurrences distinguishable by source span', () => {
    const result = groundVocabularyForDisplay([], 'respectively, then respectively')

    expect(result.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: 0, end: 12 },
      { start: 19, end: 31 },
    ])
  })

  it('keeps useful multi-word technical terms that contain a function word', () => {
    const result = prepareVocabularyForDisplay([{ word: 'a function of', contextualMeaning: '〜の関数', partOfSpeech: 'nounPhrase' }])
    expect(result).toHaveLength(1)
  })

  it('removes expression/reading chunks without removing unrelated academic vocabulary', () => {
    const result = prepareVocabularyForDisplay([
      { word: 'accounts for', contextualMeaning: '考慮する', partOfSpeech: 'verbPhrase' },
      { word: 'result in', contextualMeaning: '結果となる', partOfSpeech: 'verbPhrase' },
      { word: 'can be rotated', contextualMeaning: '回転できる', partOfSpeech: 'verbPhrase' },
      { word: 'in accuracy', contextualMeaning: '精度に', partOfSpeech: 'adverbialPhrase' },
      { word: 'by 2 K and 5 Pa, respectively', contextualMeaning: 'reading chunk', partOfSpeech: 'adverbialPhrase' },
      { word: 'from the observations', contextualMeaning: 'reading chunk', partOfSpeech: 'adverbialPhrase' },
      { word: 'normalize', contextualMeaning: '正規化する', partOfSpeech: 'verb' },
      { word: 'spatial variability', contextualMeaning: '空間的変動性', partOfSpeech: 'nounPhrase' },
    ])
    expect(result.map(({ word }) => word)).toEqual(['normalize', 'spatial variability'])
  })
  it('removes an overlong coordinated reading chunk', () => {
    const result = prepareVocabularyForDisplay([
      {
        word: 'the y-intercept and slope of the regression line, respectively.',
        contextualMeaning: 'coordinated reading chunk',
        partOfSpeech: 'nounPhrase',
      },
      {
        word: 'regression line',
        contextualMeaning: 'regression line',
        partOfSpeech: 'nounPhrase',
      },
    ])

    expect(result.map(({ word }) => word)).toEqual(['regression line'])
  })

  it('removes noun chunks with surrounding syntax while retaining an established term', () => {
    const result = prepareVocabularyForDisplay([
      { word: 'is the normalized radiance', contextualMeaning: 'reading chunk', partOfSpeech: 'nounPhrase' },
      { word: 'of the regression line', contextualMeaning: 'reading chunk', partOfSpeech: 'nounPhrase' },
      { word: 'These differences', contextualMeaning: 'reading chunk', partOfSpeech: 'nounPhrase' },
      { word: 'a substantial reduction', contextualMeaning: 'reading chunk', partOfSpeech: 'nounPhrase' },
      { word: 'the data', contextualMeaning: 'reading chunk', partOfSpeech: 'nounPhrase' },
      { word: 'slope of the regression line, respectively', contextualMeaning: 'reading chunk', partOfSpeech: 'nounPhrase' },
      { word: 'b', contextualMeaning: 'variable', partOfSpeech: 'noun' },
      { word: 'Ln', contextualMeaning: 'variable', partOfSpeech: 'noun' },
      { word: '[EQUATION_6]', contextualMeaning: 'equation placeholder', partOfSpeech: 'other' },
      { word: 'equation [EQUATION_6]', contextualMeaning: 'equation placeholder phrase', partOfSpeech: 'nounPhrase' },
      { word: 'Lavg is the average of the measured radiance data', contextualMeaning: 'clause', partOfSpeech: 'adjectivePhrase' },
      { word: 'spatial variability', contextualMeaning: 'technical term', partOfSpeech: 'nounPhrase' },
    ])

    expect(result.map(({ word }) => word)).toEqual(['spatial variability'])
  })
})

describe('vocabulary part-of-speech labels and validation', () => {
  it.each([
    ['noun', '名詞'],
    ['verb', '動詞'],
    ['adjective', '形容詞'],
    ['adverb', '副詞'],
    ['nounPhrase', '名詞句'],
    ['verbPhrase', '動詞句'],
    ['adjectivePhrase', '形容詞句'],
    ['adverbialPhrase', '副詞句'],
    ['other', 'その他'],
  ] as const)('maps %s to %s', (value, label) => {
    expect(vocabularyPartOfSpeechLabel(value)).toBe(label)
  })

  it('rejects an unknown POS so the existing GrammarAnalysis repair path handles it', () => {
    expect(vocabularyItemSchema.safeParse({
      word: 'radiance',
      contextualMeaning: '放射輝度',
      partOfSpeech: 'NN',
    }).success).toBe(false)
  })
})

describe('grounded contextual vocabulary', () => {
  const sentence = 'alpha beta gamma'
  const items = [
    { word: 'alpha', contextualMeaning: 'A', partOfSpeech: 'noun' as const },
    { word: 'beta', contextualMeaning: 'B', partOfSpeech: 'noun' as const },
    { word: 'gamma', contextualMeaning: 'C', partOfSpeech: 'noun' as const },
  ]

  it('grounds vocabulary in source order and keeps all items when no Tree node is active', () => {
    const grounded = groundVocabularyForDisplay(items, sentence)
    expect(grounded.map(({ word, start, end }) => ({ word, start, end }))).toEqual([
      { word: 'alpha', start: 0, end: 5 },
      { word: 'beta', start: 6, end: 10 },
      { word: 'gamma', start: 11, end: 16 },
    ])
    expect(grounded.map(({ partOfSpeech }) => partOfSpeech)).toEqual(['noun', 'noun', 'noun'])
  })

  it('normalizes single-token phrase labels to word-level parts of speech', () => {
    const grounded = groundVocabularyForDisplay([
      { word: 'normalize', contextualMeaning: 'normalize', partOfSpeech: 'verbPhrase' },
      { word: 'substantial', contextualMeaning: 'substantial', partOfSpeech: 'adjectivePhrase' },
      { word: 'reduction', contextualMeaning: 'reduction', partOfSpeech: 'nounPhrase' },
      { word: 'respectively', contextualMeaning: 'respectively', partOfSpeech: 'adverbialPhrase' },
    ], 'normalize substantial reduction respectively')

    expect(grounded.map(({ partOfSpeech }) => partOfSpeech)).toEqual([
      'verb',
      'adjective',
      'noun',
      'adverb',
    ])
  })

  it('selects only vocabulary contained by the active Tree span', () => {
    const grounded = groundVocabularyForDisplay(items, sentence)
    expect(findVocabularyForTreeNode({ start: 6, end: 10 }, grounded)).toEqual([
      { word: 'beta', contextualMeaning: 'B', partOfSpeech: 'noun', start: 6, end: 10 },
    ])
  })

  it('includes a boundary-crossing phrase only when at least half its span overlaps', () => {
    const phrase = [{ word: 'beta gamma', contextualMeaning: 'B C', partOfSpeech: 'nounPhrase' as const, start: 6, end: 16 }]
    expect(findVocabularyForTreeNode({ start: 10, end: 16 }, phrase)).toEqual(phrase)
    expect(findVocabularyForTreeNode({ start: 14, end: 16 }, phrase)).toEqual([])
  })

  it('grounds repeated vocabulary to separate occurrences and selects the second by offset', () => {
    const repeated = groundVocabularyForDisplay([
      { word: 'signal', contextualMeaning: '信号', partOfSpeech: 'noun' },
      { word: 'signal', contextualMeaning: '信号', partOfSpeech: 'noun' },
    ], 'signal and signal')
    expect(repeated.map(({ start }) => start)).toEqual([0, 11])
    expect(findVocabularyForTreeNode({ start: 11, end: 17 }, repeated).map(({ start }) => start)).toEqual([11])
  })

  it('returns an empty list when the active span has no grounded vocabulary', () => {
    const grounded = groundVocabularyForDisplay(items, sentence)
    expect(findVocabularyForTreeNode({ start: 5, end: 6 }, grounded)).toEqual([])
  })
})

describe('Prototype 2.6G2.8M2.2a Track B -- synthetic math token exclusion (item 9)', () => {
  it('excludes a vocabulary entry that grounds entirely inside a MATH_EXPR synthetic run', async () => {
    const { shieldRelationalMathRuns } = await import('../../src/features/grammar/domain/mathRunProjection')
    const { projectionFromSource } = await import('../../src/features/grammar/domain/textProjection')
    const source = 'the result was k = 0.5 in this case.'
    const projection = shieldRelationalMathRuns(projectionFromSource(source), source)
    const items = [{ word: 'MATH_EXPR', contextualMeaning: '数学式', partOfSpeech: 'noun' as const }]
    const grounded = groundVocabularyForDisplay(items, projection.text, projection)
    expect(grounded).toEqual([])
  })

  it('keeps an ordinary vocabulary entry unaffected when projection has no synthetic runs at all', () => {
    const grounded = groundVocabularyForDisplay(
      [{ word: 'alpha', contextualMeaning: 'A', partOfSpeech: 'noun' as const }],
      'alpha beta gamma',
      undefined,
    )
    expect(grounded.map(({ word }) => word)).toEqual(['alpha'])
  })
})
