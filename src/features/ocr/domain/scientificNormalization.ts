import { toPixelRect, matchWordsToRects } from './ocrGeometry'
import type { EmbeddedScientificToken, OcrWord } from './ocrTypes'

/**
 * Rule A and Rule B: two narrowly-scoped, independent "candidate" transforms for
 * scientific notation that OCR and/or the embedded PDF text layer commonly garble (see
 * docs/design-notes.md, Prototype 1.2D/1.2E). Both are candidate-only — never applied to
 * the sentence textarea automatically, and never merged with each other or with the raw
 * embedded/OCR text. Precision is prioritized over recall throughout: when in doubt, both
 * rules produce no candidate rather than guess.
 */

function extractDigits(text: string): string {
  return text.replace(/\D/g, '')
}

// --- Rule A: embedded-guided decimal middle-dot candidate -----------------------------

export interface RuleAResult {
  /** The modified normalized-embedded-text candidate, or null if no token qualified. */
  text: string | null
  changed: boolean
}

/**
 * For each `EmbeddedScientificToken` (a `digit·digit` substring the embedded PDF text
 * layer itself contains, with its own tight geometry — see
 * pdfViewerState.findDigitMiddotMatches), cross-validates it against whatever OCR word(s)
 * spatially occupy that same position. Only replaces "·" with "." when the OCR word's own
 * digit sequence matches the embedded token's digit sequence exactly.
 *
 * The trigger authority is always the embedded text's own literal "·" — this function
 * never invents a decimal point from an OCR-only hyphen. A real hyphen/range in the
 * embedded text (e.g. "2-5", "1775-1795") never produces an `EmbeddedScientificToken` in
 * the first place, so it can never reach this function at all.
 */
export function applyRuleA(
  normalizedEmbeddedText: string,
  tokens: readonly EmbeddedScientificToken[],
  ocrWords: readonly OcrWord[],
  tolerancePx: number,
  ocrCanvasWidth: number,
  ocrCanvasHeight: number,
): RuleAResult {
  let result = normalizedEmbeddedText
  let changed = false

  for (const token of tokens) {
    const pixelRects = token.rects.map((r) => toPixelRect(r, ocrCanvasWidth, ocrCanvasHeight))
    const matched = matchWordsToRects(pixelRects, ocrWords, tolerancePx)
    const ocrDigits = extractDigits(matched.map((w) => w.text).join(''))
    const embeddedDigits = extractDigits(token.text)
    if (ocrDigits.length === 0 || ocrDigits !== embeddedDigits) continue

    const idx = result.indexOf(token.text)
    if (idx === -1) continue // normalization (hyphenation-fix/newline-join) moved it — skip rather than guess
    const normalizedToken = token.text.replace('·', '.')
    result = result.slice(0, idx) + normalizedToken + result.slice(idx + token.text.length)
    changed = true
  }

  return { text: changed ? result : null, changed }
}

// --- Rule B: exact "um" -> "μm" OCR candidate ------------------------------------------

// Deliberately narrow: only tokens actually observed to precede a genuine "um" unit
// reading during the Prototype 1.2D/1.2E validation (Reno: "1", "2.5", "0.8", "0-8",
// "2-5"; Elsevier: "4-", from Tesseract splitting "4-μm" into ["4-", "um"]). Extending
// this to a fully general "looks numeric" regex was explicitly avoided per the
// precision-over-recall requirement.
const NUMERIC_QUANTITY_PATTERNS: readonly RegExp[] = [
  /^\d+$/, // "1"
  /^\d+\.\d+$/, // "2.5", "0.8"
  /^\d+-\d+$/, // "0-8", "2-5" (OCR's hyphen-as-decimal-separator artifact)
  /^\d+·\d+$/, // "0·8" (embedded middle-dot form, defensive)
  /^\d+(\.\d+)?-$/, // "4-", "0.86-" (trailing hyphen from a split hyphenated compound)
]

export function isNumericQuantityToken(text: string): boolean {
  return NUMERIC_QUANTITY_PATTERNS.some((pattern) => pattern.test(text))
}

export interface RuleBResult {
  words: OcrWord[]
  changed: boolean
}

// A handful of ASCII closing-punctuation characters actually observed getting fused onto
// the end of an OCR "um" token by Tesseract's own tokenizer (sentence-final periods,
// list/clause punctuation, closing brackets from a parenthesized unit). Deliberately not
// a general punctuation class — only what's been confirmed necessary.
const TRAILING_PUNCTUATION = '.,;:)\\]'

// Case A: the whole OCR word is "um" plus at most one of the allowed trailing punctuation
// characters (or nothing) — e.g. "um", "um.", "um,", "um)". The numeric-quantity check on
// the *preceding* word still applies, exactly as before.
const EXACT_UM_PATTERN = new RegExp(`^um([${TRAILING_PUNCTUATION}])?$`)

// Case B: the whole OCR word is a numeric prefix, a literal "-", "um", and optionally one
// trailing punctuation character — e.g. "0.86-um", "4-um", "0.86-um.". The numeric
// quantity lives inside this same token (Tesseract fused "4-μm" into one word), so there
// is no separate preceding-word check here. The prefix shape (`\d+` or `\d+.\d+`) is a
// deliberately narrow subset of isNumericQuantityToken's shapes — just enough to cover
// the fixtures actually observed (Elsevier: "0.86-um", "4-um") — so a coincidental match
// like "foo-um" or "test-um" (no digit prefix) is never touched.
const NUMERIC_UM_SAME_WORD_PATTERN = new RegExp(`^(\\d+(?:\\.\\d+)?)-um([${TRAILING_PUNCTUATION}])?$`)

/**
 * Walks an OCR word sequence (already spatially matched to the user's selection — see
 * ocrGeometry.matchWordsToRects) and replaces the "um" portion of a word with "μm" only
 * when Tesseract has explicitly recognized the ASCII letters "u" and "m" as a unit — in
 * one of two forms actually observed during Prototype 1.2D/1.2E/1.2 review:
 *
 * - Case A: the word is exactly "um" (optionally with one fused trailing punctuation
 *   character, e.g. "um." at the end of a sentence) and the *previous* word looks like a
 *   numeric quantity ("2-5 um." -> "2-5 μm.").
 * - Case B: the word itself is a numeric prefix + "-" + "um" (Tesseract fused the whole
 *   hyphenated unit into one token, e.g. "0.86-um" -> "0.86-μm"), optionally with one
 *   trailing punctuation character.
 *
 * Visually similar misreadings (ym, jum, pm, yum, Jim, 11m) are never touched in either
 * case, and neither is a coincidental "-um"/"um" appearing inside an ordinary English word
 * (spectrum, maximum, datum) or a non-numeric hyphenated word (foo-um) — Rule B does not
 * guess at what the OCR engine "probably meant".
 */
export function applyRuleB(words: readonly OcrWord[]): RuleBResult {
  let changed = false
  const result = words.map((word, i) => {
    const exactMatch = EXACT_UM_PATTERN.exec(word.text)
    if (exactMatch) {
      const previous = words[i - 1]
      if (!previous || !isNumericQuantityToken(previous.text)) return word
      changed = true
      return { ...word, text: `μm${exactMatch[1] ?? ''}` }
    }

    const sameWordMatch = NUMERIC_UM_SAME_WORD_PATTERN.exec(word.text)
    if (sameWordMatch) {
      const [, prefix, punctuation] = sameWordMatch
      changed = true
      return { ...word, text: `${prefix}-μm${punctuation ?? ''}` }
    }

    return word
  })
  return { words: changed ? result : [...words], changed }
}
