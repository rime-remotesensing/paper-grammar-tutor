import type { SentenceCore } from '../schemas/grammarAnalysis.schema.ts'

/**
 * Prototype 2.3I — production port of the Prototype 2.3G/2.3H spike's pure gate helper,
 * unchanged. TRIGGER ONLY (item 9): true means "the focused complement verifier should be
 * asked", nothing more — this function never reads or writes a core itself. All conditions
 * ANDed:
 * 1. derived pattern === 'SVOC'
 * 2. object and complement both present
 * 3. both grounded (start/end >= 0)
 * 4. complement starts at/after object ends
 * 5. a literal comma sits in the source between object's end and complement's start
 * 6. the complement's own first token ends in "ing" (surface only — no verb dictionary)
 *
 * Validated in Prototype 2.3G/2.3H: target sentence 20/20 (then 30/30 through the full
 * verifier) true; true-SVOC/gerund/no-comma negative controls 0 false triggers across 90+
 * runs.
 */
export function isSuspiciousCommaIngComplement(originalText: string, sentenceCore: SentenceCore): boolean {
  if (sentenceCore.pattern !== 'SVOC') return false
  const object = sentenceCore.object
  const complement = sentenceCore.complement
  if (!object || !complement) return false
  if (object.start < 0 || object.end < 0 || complement.start < 0 || complement.end < 0) return false
  if (complement.start < object.end) return false
  const gap = originalText.slice(object.end, complement.start)
  if (!gap.includes(',')) return false
  return /^[a-zA-Z]+ing\b/.test(complement.text.trim())
}
