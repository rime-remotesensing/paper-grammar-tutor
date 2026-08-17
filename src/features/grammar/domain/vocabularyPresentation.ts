import type { VocabularyItem, VocabularyPartOfSpeech } from '../schemas/grammarAnalysis.schema.ts'
import { resolveSpanAfter } from '../../../utils/spanMatch.ts'
import type { SourceSpan } from './treeReadingMatching.ts'

export interface GroundedVocabularyItem extends VocabularyItem {
  start: number
  end: number
}

const BASIC_FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'as', 'at', 'by', 'from', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
])

const PART_OF_SPEECH_LABEL: Record<VocabularyPartOfSpeech, string> = {
  noun: '名詞',
  verb: '動詞',
  adjective: '形容詞',
  adverb: '副詞',
  nounPhrase: '名詞句',
  verbPhrase: '動詞句',
  adjectivePhrase: '形容詞句',
  adverbialPhrase: '副詞句',
  other: 'その他',
}

export function vocabularyPartOfSpeechLabel(partOfSpeech: VocabularyPartOfSpeech): string {
  return PART_OF_SPEECH_LABEL[partOfSpeech]
}

/** Keeps source order while deterministically removing standalone function words that a
 * small model occasionally puts in the vocabulary array despite the prompt. */
export function prepareVocabularyForDisplay(items: readonly VocabularyItem[]): VocabularyItem[] {
  return items.filter((item) => !BASIC_FUNCTION_WORDS.has(item.word.trim().toLowerCase()) && !looksLikeNonVocabularyChunk(item))
}

/** Narrow safety net for small-model output that is structurally valid but belongs to the
 * Reading/Expression channels rather than Vocabulary. It never rejects ordinary content
 * nouns, verbs, adjectives, adverbs, or technical noun phrases. */
function looksLikeNonVocabularyChunk(item: VocabularyItem): boolean {
  const normalized = item.word.trim().toLowerCase().replace(/[.,;:]$/, '')
  if (/\[equation(?:_\d+)?\]/.test(normalized)) return true
  if (/^[a-z]$/.test(normalized) || /^[A-Z][a-z]$/.test(item.word.trim())) return true
  if (/\s/.test(normalized) && /\b(?:is|are|was|were)\b/.test(normalized)) return true
  if (item.partOfSpeech === 'verbPhrase') {
    if (/^(?:can|could|may|might|must|should|would|is|are|was|were|be)\b/.test(normalized)) return true
    if (/\b(?:for|in|on|to|of|with|as|from|into)$/.test(normalized)) return true
  }
  if (
    (item.partOfSpeech === 'adverbialPhrase' || item.partOfSpeech === 'adjectivePhrase') &&
    /^(?:is|are|was|were|be|in|on|to|of|for|at|by|from|with)\b/.test(normalized)
  ) return true
  if (item.partOfSpeech === 'nounPhrase') {
    if (/^(?:this|that|these|those|is|are|was|were|be|of|in|on|to|for)\b/.test(normalized)) return true
    if (/\b(?:and|or)\b/.test(normalized)) return true
    if (/,/.test(item.word) || /\brespectively$/.test(normalized)) return true
    if (/^(?:a|an|the)\b/.test(normalized) && !/\b(?:of|for)$/.test(normalized)) return true
  }
  return /^[a-z]\s+(?:and|or)\s+[a-z]$/.test(normalized)
}

/** Grounds source-ordered vocabulary against the same normalized sentence used by Tree
 * and ReadingGuide. Ungroundable items are omitted rather than attached semantically. */
export function groundVocabularyForDisplay(
  items: readonly VocabularyItem[],
  sentence: string,
): GroundedVocabularyItem[] {
  const grounded: GroundedVocabularyItem[] = []
  let nextStart = 0

  for (const item of prepareVocabularyForDisplay(items)) {
    const resolved = resolveSpanAfter(sentence, item.word, nextStart)
    if (!resolved.resolved) continue
    grounded.push({
      ...item,
      word: resolved.text,
      partOfSpeech: normalizeSingleTokenPartOfSpeech(resolved.text, item.partOfSpeech),
      start: resolved.start,
      end: resolved.end,
    })
    nextStart = resolved.end
  }

  return ensureRequiredRespectivelyVocabulary(grounded, sentence)
}

/** Product-required narrow recovery for an interpretation-changing academic relation word.
 * qwen occasionally omits it in long sentences even under an explicit prompt. This does not
 * infer coordination or pairings: the exact token in normalizedText remains the sole span
 * authority, and an already generated occurrence is never duplicated. */
function ensureRequiredRespectivelyVocabulary(
  grounded: readonly GroundedVocabularyItem[],
  sentence: string,
): GroundedVocabularyItem[] {
  const recovered = [...grounded]
  const occurrence = /\brespectively\b/gi
  for (const match of sentence.matchAll(occurrence)) {
    const start = match.index
    const end = start + match[0].length
    if (recovered.some((item) => item.start === start && item.end === end)) continue
    recovered.push({
      word: sentence.slice(start, end),
      contextualMeaning: 'それぞれ、各々その順に',
      partOfSpeech: 'adverb',
      start,
      end,
    })
  }
  return recovered.sort((left, right) => left.start - right.start || left.end - right.end)
}

/** A one-token item cannot be a phrase. Correct only this structurally impossible coarse
 * label; all genuine linguistic choices remain model metadata. */
function normalizeSingleTokenPartOfSpeech(
  text: string,
  partOfSpeech: VocabularyPartOfSpeech,
): VocabularyPartOfSpeech {
  if (/\s/.test(text.trim())) return partOfSpeech
  if (partOfSpeech === 'nounPhrase') return 'noun'
  if (partOfSpeech === 'verbPhrase') return 'verb'
  if (partOfSpeech === 'adjectivePhrase') return 'adjective'
  if (partOfSpeech === 'adverbialPhrase') return 'adverb'
  return partOfSpeech
}

/** Includes vocabulary contained by the Tree node, plus boundary-crossing phrases when
 * at least half of the vocabulary span overlaps. Text equality is never consulted. */
export function findVocabularyForTreeNode(
  treeSpan: SourceSpan,
  vocabulary: readonly GroundedVocabularyItem[],
): GroundedVocabularyItem[] {
  if (!validSpan(treeSpan)) return []
  return vocabulary.filter((item) => {
    if (!validSpan(item)) return false
    if (treeSpan.start <= item.start && item.end <= treeSpan.end) return true
    const intersection = Math.max(0, Math.min(treeSpan.end, item.end) - Math.max(treeSpan.start, item.start))
    return intersection >= Math.ceil((item.end - item.start) / 2)
  })
}

function validSpan(span: SourceSpan): boolean {
  return Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.end > span.start
}
