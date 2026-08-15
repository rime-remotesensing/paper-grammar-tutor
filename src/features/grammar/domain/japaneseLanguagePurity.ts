/**
 * Prototype 2.3P — detects Simplified-Chinese-specific Han characters in a user-facing
 * Japanese explanation string. Item 4's explicit constraint: "漢字を含む -> Chinese" is
 * FORBIDDEN as a detection strategy, since correct Japanese grammar terminology is often
 * pure-kanji with no hiragana/katakana at all ("関係節", "目的語", "現在完了", "側面",
 * "複数"). A hiragana/katakana-absence check was tried during diagnosis and produced
 * exactly that failure mode (multiple false positives on legitimate terse labels) while
 * ALSO missing real contamination in a field it didn't scan.
 *
 * Instead, this checks for specific Han characters whose Simplified-Chinese form is a
 * DIFFERENT Unicode code point from the Japanese kanji used for the same word — i.e. a
 * character that cannot legitimately appear in correct Japanese text at all, regardless of
 * hiragana/katakana context. Live diagnosis (2.3P item 5, 20 runs on the target sentence)
 * empirically found: "动词" (Chinese) instead of "動詞", "过去分词" (Chinese) instead of
 * "過去分詞", "述语" (Chinese) instead of "述語" — each pulled from
 * `expressions.pattern`/`readingAdvice`. The set below starts from those confirmed
 * offenders and extends to other Simplified forms highly likely to appear in this app's
 * specific domain (grammar/tense/clause terminology), NOT a general-purpose CJK
 * simplification table — this is deliberately narrow and documented as such rather than
 * claimed exhaustive.
 */
const SIMPLIFIED_CHINESE_ONLY_CHARACTERS = new Set([
  '动', // 動 (verb: 动词/動詞)
  '过', // 過 (past: 过去/過去)
  '语', // 語 (language/word: 语法/語法, 主语/主語)
  '词', // 詞 (word/part of speech: 词组/詞句)
  '现', // 現 (present: 现在/現在)
  '强', // 強 (emphasis: 强调/強調)
  '变', // 変 (change: 变化/変化)
  '单', // 単 (single: 单词/単語)
  '复', // 複 (plural: 复数/複数)
  '从', // 従 (from/subordinate: 从句/従属節)
  '这', // (this — Japanese never uses this character)
  '时', // 時 (time: 时态/時制)
  '态', // 態 (voice/aspect: 时态/態)
  '谓', // 謂 (predicate: 谓语/述語)
  '宾', // (object: 宾语 — Japanese uses 目的語, unrelated characters)
  '达', // 達 (achieve/plural marker)
  '术', // 術 (technique)
  '应', // 応 (should/respond)
  '门', // 門 (gate)
  '车', // 車 (vehicle)
  '长', // 長 (long)
  '汉', // 漢 (Han/Chinese)
  '义', // 義 (meaning)
  '习', // 習 (practice)
])
// Deliberately NOT included: 与 (and/with) — also a valid, if uncommon, Japanese character
// (与える root); including it risked a false positive this simple per-character scan can't
// safely resolve without more context than a single field's worth of short label text gives.

/** True when `text` contains at least one character that only exists in Simplified Chinese
 * orthography, never in standard Japanese. Deliberately does NOT flag pure-kanji Japanese
 * text on its own (item 4) — every character in the set above is a genuine, unambiguous
 * Simplified-Chinese-only form for its relevant meaning in this app's grammar-explanation
 * domain. */
export function containsSimplifiedChineseCharacters(text: string): boolean {
  for (const ch of text) {
    if (SIMPLIFIED_CHINESE_ONLY_CHARACTERS.has(ch)) return true
  }
  return false
}
