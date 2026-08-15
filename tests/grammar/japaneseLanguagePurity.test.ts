import { describe, expect, it } from 'vitest'
import { containsSimplifiedChineseCharacters } from '../../src/features/grammar/domain/japaneseLanguagePurity'

// Prototype 2.3P item 4 — this detector must NOT use "contains kanji" as its signal (that
// would reject correct Japanese grammar terminology). It checks for specific Han characters
// that are Simplified-Chinese-only forms, never valid in standard Japanese orthography.

describe('containsSimplifiedChineseCharacters', () => {
  it('flags genuine Simplified-Chinese contamination found in live diagnosis', () => {
    expect(containsSimplifiedChineseCharacters('主語 + 动词')).toBe(true) // 动词 instead of 動詞
    expect(containsSimplifiedChineseCharacters('that/which + 过去分词')).toBe(true) // 过去分词 instead of 過去分詞
    expect(containsSimplifiedChineseCharacters('まず主語と述语を確認し')).toBe(true) // 述语 instead of 述語
  })

  it('does NOT flag correct pure-kanji Japanese grammar terminology (item 4)', () => {
    expect(containsSimplifiedChineseCharacters('関係節')).toBe(false)
    expect(containsSimplifiedChineseCharacters('目的語')).toBe(false)
    expect(containsSimplifiedChineseCharacters('現在完了')).toBe(false)
    expect(containsSimplifiedChineseCharacters('主語 + 動詞')).toBe(false)
    expect(containsSimplifiedChineseCharacters('that + have + 過去分詞')).toBe(false)
    expect(containsSimplifiedChineseCharacters('述語')).toBe(false)
  })

  it('does not flag ordinary Japanese sentences with hiragana/katakana', () => {
    expect(containsSimplifiedChineseCharacters('文の主語。')).toBe(false)
    expect(containsSimplifiedChineseCharacters('受動態で記録されたことを示す。')).toBe(false)
  })

  it('does not flag terse noun-only Japanese labels with no kana (the false-positive shape a naive hiragana-absence check produced during diagnosis)', () => {
    expect(containsSimplifiedChineseCharacters('現在進行形+関係節')).toBe(false)
    expect(containsSimplifiedChineseCharacters('第6版')).toBe(false)
    expect(containsSimplifiedChineseCharacters('側面、要素（複数）')).toBe(false)
  })

  it('does not flag an empty string', () => {
    expect(containsSimplifiedChineseCharacters('')).toBe(false)
  })

  it('flags a single contaminated character even inside an otherwise-Japanese sentence', () => {
    expect(containsSimplifiedChineseCharacters('これは现在の状態を示す。')).toBe(true) // 现 instead of 現
  })
})
