/**
 * Small local-only hint layer for domain-specific technical compounds whose literal,
 * word-by-word English meaning diverges from the established Japanese term used in
 * satellite/remote-sensing academic writing (e.g. "whiskbroom scanning radiometer" is not a
 * mine-clearing device; "sun synchronous orbit" is not a made-up Chinese-looking rendering).
 *
 * This is a HINT layer, not a dictionary: matching a phrase here never forces a translation
 * by string-replacement, and a phrase NOT listed here is still handled entirely by the LLM's
 * own contextual judgment (see the general "technical compound" principle in
 * grammarAnalysisPrompt.ts). Lookup is a plain local substring scan -- no network/LLM call.
 */
export interface TechnicalTermHint {
  /** Case-insensitive phrase to match against the sentence, at word boundaries. */
  phrase: string
  /** A reference Japanese reading offered to the model as background knowledge only. */
  suggestedJapanese: string
}

export interface MatchedGlossaryHint extends TechnicalTermHint {
  start: number
  end: number
}

/**
 * Deliberately a handful of established terms needed for regression coverage, not a large
 * hand-built dictionary -- the LLM is expected to generalize to compounds not listed here.
 */
export const TECHNICAL_TERM_GLOSSARY: readonly TechnicalTermHint[] = [
  { phrase: 'whiskbroom scanning radiometer', suggestedJapanese: 'ウィスクブルーム走査式放射計' },
  { phrase: 'sun synchronous orbit', suggestedJapanese: '太陽同期軌道' },
  { phrase: 'sun-synchronous orbit', suggestedJapanese: '太陽同期軌道' },
  { phrase: 'equatorial crossing times', suggestedJapanese: '赤道通過時刻' },
  { phrase: 'equatorial crossing time', suggestedJapanese: '赤道通過時刻' },
]

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[a-z0-9]/i.test(ch)
}

/** Finds every glossary phrase actually present in `sentence`, at word boundaries, in source
 * order. Longer/more specific phrases are listed first in TECHNICAL_TERM_GLOSSARY so their
 * matches naturally take priority when a shorter phrase is also a substring of them. */
export function findGlossaryHints(sentence: string): MatchedGlossaryHint[] {
  const lower = sentence.toLowerCase()
  const matches: MatchedGlossaryHint[] = []
  for (const entry of TECHNICAL_TERM_GLOSSARY) {
    const phraseLower = entry.phrase.toLowerCase()
    let fromIndex = 0
    for (;;) {
      const idx = lower.indexOf(phraseLower, fromIndex)
      if (idx === -1) break
      const end = idx + phraseLower.length
      const beforeOk = idx === 0 || !isWordChar(lower[idx - 1])
      const afterOk = end === lower.length || !isWordChar(lower[end])
      if (beforeOk && afterOk) {
        matches.push({ ...entry, start: idx, end })
      }
      fromIndex = idx + 1
    }
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end)
  return matches
}
