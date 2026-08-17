import { describe, expect, it } from 'vitest'
import { findReadingStepsForTreeNode } from '../../src/features/grammar/domain/treeReadingMatching'
import { prepareExpressionsForDisplay } from '../../src/features/grammar/domain/expressionPresentation'
import { findVocabularyForTreeNode, groundVocabularyForDisplay, prepareVocabularyForDisplay } from '../../src/features/grammar/domain/vocabularyPresentation'
import { activeTreeNodeKey, EMPTY_TREE_READING_INTERACTION, reduceTreeReadingInteraction } from '../../src/features/grammar/domain/treeReadingInteraction'
import { buildSourceHighlightSegments } from '../../src/features/grammar/domain/sourceSentenceHighlight'
import type { Expression, ResolvedReadingStep } from '../../src/features/grammar/schemas/readingGuide.schema'

const readingStep: ResolvedReadingStep = {
  text: 'is based on observations',
  cue: '何に基づく？',
  explanation: '「is based」で意味を取り、on observationsを後ろから足す。',
  start: 10,
  end: 34,
}

const basedOn: Expression = {
  text: 'is based on',
  pattern: 'be based on ~',
  meaning: '〜に基づく',
  function: 'onまで含めて一つの語法として覚える。',
  start: 10,
  end: 21,
}

const accountFor: Expression = {
  text: 'accounts for',
  pattern: 'account for ~',
  meaning: '〜を考慮する',
  function: 'for以下を対象として示す。',
  start: 40,
  end: 52,
}

describe('separate ReadingStep / Expression / Vocabulary channels', () => {
  it('same-span competition keeps the ReadingStep contextual and the Expression persistent', () => {
    const contextual = findReadingStepsForTreeNode({ start: 10, end: 34 }, [readingStep])
    const persistentExpressions = prepareExpressionsForDisplay([basedOn])

    expect(contextual).toEqual([readingStep])
    expect(persistentExpressions.map(({ pattern }) => pattern)).toEqual(['be based on ~'])
  })

  it('one Tree span changes source highlight, ReadingStep, and Vocabulary while Expressions stay unchanged', () => {
    const sentence = 'The method is based on observations.'
    const treeSpan = { start: 11, end: 35 }
    const liveStep = { ...readingStep, start: 11, end: 35 }
    const vocabulary = groundVocabularyForDisplay([
      { word: 'method', contextualMeaning: '方法', partOfSpeech: 'noun' as const },
      { word: 'observations', contextualMeaning: '観測', partOfSpeech: 'noun' as const },
    ], sentence)
    const expressionsBefore = prepareExpressionsForDisplay([{ ...basedOn, start: 11, end: 22 }])

    const highlight = buildSourceHighlightSegments(sentence, treeSpan)
    const reading = findReadingStepsForTreeNode(treeSpan, [liveStep])
    const contextualVocabulary = findVocabularyForTreeNode(treeSpan, vocabulary)
    const expressionsAfter = prepareExpressionsForDisplay([{ ...basedOn, start: 11, end: 22 }])

    expect(highlight.active).toBe('is based on observations')
    expect(reading).toEqual([liveStep])
    expect(contextualVocabulary.map(({ word }) => word)).toEqual(['observations'])
    expect(expressionsAfter).toEqual(expressionsBefore)
  })

  it('an expression-only overlap never becomes a reading fallback', () => {
    const contextual = findReadingStepsForTreeNode({ start: 10, end: 21 }, [])
    const persistentExpressions = prepareExpressionsForDisplay([basedOn])

    expect(contextual).toEqual([])
    expect(persistentExpressions).toHaveLength(1)
  })

  it('Expression presentation does not remove unrelated academic vocabulary', () => {
    const expressions = prepareExpressionsForDisplay([accountFor])
    const vocabulary = groundVocabularyForDisplay([
      { word: 'spatial variability', contextualMeaning: '空間的変動性', partOfSpeech: 'nounPhrase' },
    ], 'The method accounts for spatial variability.')

    expect(expressions.map(({ pattern }) => pattern)).toEqual(['account for ~'])
    expect(vocabulary.map(({ word, partOfSpeech }) => ({ word, partOfSpeech }))).toEqual([
      { word: 'spatial variability', partOfSpeech: 'nounPhrase' },
    ])
  })

  it('keeps every persistent expression regardless of the selected Tree node', () => {
    const expressions = [basedOn, accountFor]
    const before = prepareExpressionsForDisplay(expressions)
    findReadingStepsForTreeNode({ start: basedOn.start, end: basedOn.end }, [readingStep])
    const after = prepareExpressionsForDisplay(expressions)

    expect(after).toEqual(before)
    expect(after.map(({ pattern }) => pattern)).toEqual(['be based on ~', 'account for ~'])
  })

  it('keeps vocabulary structurally unchanged across no-selection, hover, pin, override, and Escape', () => {
    const vocabulary = [
      { word: 'observations', contextualMeaning: '観測', partOfSpeech: 'noun' as const },
      { word: 'variability', contextualMeaning: '変動性', partOfSpeech: 'noun' as const },
    ]
    const expected = prepareVocabularyForDisplay(vocabulary)
    let state = EMPTY_TREE_READING_INTERACTION
    const snapshots = [prepareVocabularyForDisplay(vocabulary)]

    state = reduceTreeReadingInteraction(state, { type: 'preview', key: 'a' })
    snapshots.push(prepareVocabularyForDisplay(vocabulary))
    state = reduceTreeReadingInteraction(state, { type: 'togglePin', key: 'a' })
    snapshots.push(prepareVocabularyForDisplay(vocabulary))
    state = reduceTreeReadingInteraction(state, { type: 'preview', key: 'b' })
    snapshots.push(prepareVocabularyForDisplay(vocabulary))
    state = reduceTreeReadingInteraction(state, { type: 'clearPin' })
    snapshots.push(prepareVocabularyForDisplay(vocabulary))

    expect(activeTreeNodeKey(state)).toBe('b')
    expect(snapshots.every((snapshot) => JSON.stringify(snapshot) === JSON.stringify(expected))).toBe(true)
  })

  it('performs hover, pin, override, and Escape as deterministic state changes with zero LLM calls', () => {
    const llmCalls = 0
    let state = reduceTreeReadingInteraction(EMPTY_TREE_READING_INTERACTION, { type: 'preview', key: 'a' })
    state = reduceTreeReadingInteraction(state, { type: 'togglePin', key: 'a' })
    state = reduceTreeReadingInteraction(state, { type: 'preview', key: 'b' })
    state = reduceTreeReadingInteraction(state, { type: 'leave', key: 'b' })
    state = reduceTreeReadingInteraction(state, { type: 'clearPin' })

    expect(activeTreeNodeKey(state)).toBeNull()
    expect(llmCalls).toBe(0)
  })
})
