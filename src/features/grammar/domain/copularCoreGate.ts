import type { Span } from '../schemas/grammarAnalysis.schema.ts'

/**
 * Prototype 2.5W — production port of the Prototype 2.5V spike's copular-core suspicion
 * gate, ported closely. Two independent signals, either firing the gate — never a final
 * grammatical decision, only "suspicious enough to verify" (Prototype 2.5V item 14): the
 * actual subject/verb/complement answer always comes from FocusedCopularCoreRepairer.
 *
 * Validated in Prototype 2.5V: 20/20 on the exact CASE A target sentence (via signal 1
 * alone), 15/15 zero false triggers on passive controls ("is applied"/"are normalized"/
 * "is based"), 5/5 correct triggers on a coordinated-copula control (via signal 2).
 *
 * IMPORTANT (Prototype 2.5W item 5/item 6 of this file's own report): signal 2 (Stage-2
 * divergence) requires a grounded Stage-2 main-predicate span, which is NOT available at
 * the point Stage 1's core is finalized in the current orchestration (Stage 2/
 * PredicateStructure only runs later, on a separate "英語の語順で読む" click — see
 * readingSupportOrchestrator.ts). Wiring signal 2 live would require either an extra
 * duplicate PredicateStructure call (explicitly forbidden) or reordering when Stage 2 runs
 * (a larger rewrite, not authorized this phase). This function still implements and exports
 * signal 2 so it stays testable/documented and ready for a future phase that makes a
 * grounded Stage-2 hint available earlier — the current production call site
 * (analyzeSentenceWithComplementVerification.ts) only ever passes `stage2MainPredicate:
 * null`, so only signal 1 is ever live today. Signal 1 alone was sufficient for 20/20 on
 * the real live-acceptance target, so this does not block CASE A's live acceptance.
 */

const BARE_COPULA = /^(is|are|was|were|been|being|be)\b/i

/** Rough closed set for distinguishing "is APPLIED" (passive) from "is A FUNCTION"
 * (copular NP complement) without a POS tagger -- common irregular past participles seen in
 * academic prose. Deliberately conservative/narrow (Prototype 2.5V item 14): this only
 * decides whether to VERIFY, never the final grammatical answer. Do not casually expand
 * beyond what the validated 2.5V spike used (Prototype 2.5W item 16). */
const COMMON_IRREGULAR_PARTICIPLES = new Set([
  'applied', 'based', 'defined', 'used', 'given', 'shown', 'known', 'found', 'made', 'taken',
  'written', 'done', 'seen', 'measured', 'normalized', 'calculated', 'derived', 'obtained',
  'introduced', 'described', 'observed', 'presented', 'estimated', 'computed', 'determined',
])

export interface CopularGateResult {
  fire: boolean
  verbShapeFired: boolean
  divergesFromStage2: boolean
  reason: string
}

/** Signal 1: the raw Stage-1 verb shape itself looks suspicious. */
function verbShapeSuspicious(verbText: string | null, objectText: string | null): { fire: boolean; reason: string } {
  if (!verbText) return { fire: false, reason: 'no verb' }
  const trimmed = verbText.trim()
  if (!BARE_COPULA.test(trimmed)) return { fire: false, reason: 'verb does not start with a be-form' }
  const words = trimmed.split(/\s+/)
  if (words.length === 1) {
    if (objectText) return { fire: true, reason: 'bare be-verb with object slot filled (classic O-vs-C shape)' }
    return { fire: false, reason: 'bare be-verb, no object -- likely already SVC or SV, nothing to check' }
  }
  const second = words[1]?.toLowerCase().replace(/[.,;:]$/, '')
  const looksPassive = /ed$/.test(second ?? '') || COMMON_IRREGULAR_PARTICIPLES.has(second ?? '')
  if (looksPassive) return { fire: false, reason: `second word "${second}" looks like a passive/perfect participle` }
  return { fire: true, reason: `multi-word be-verb "${trimmed}" does not look passive (verb over-capture shape)` }
}

function spansOverlap(a: Span, b: { start: number; end: number }): boolean {
  if (a.start < 0 || b.start < 0) return false
  return Math.max(a.start, b.start) < Math.min(a.end, b.end)
}

/**
 * Signal 2: a grounded Stage-2 main-predicate span exists but doesn't overlap Stage-1's own
 * core.verb span at all -- evidence Stage 1 anchored on the wrong clause entirely (a
 * genuinely passive-looking verb like "is introduced" that signal 1 alone can't flag,
 * because Stage 1 picked the SECOND coordinated predicate as if it were the whole core).
 * `stage2MainPredicate` is null whenever no such hint is available (the normal case today
 * -- see this file's own top-of-file doc comment).
 */
export function evaluateCopularGate(
  coreVerb: Span | null,
  coreObject: Span | null,
  stage2MainPredicate: Span | null,
): CopularGateResult {
  const verbShape = verbShapeSuspicious(coreVerb?.text ?? null, coreObject?.text ?? null)
  const divergesFromStage2 = !!(stage2MainPredicate && coreVerb && !spansOverlap(coreVerb, stage2MainPredicate))
  return {
    fire: verbShape.fire || divergesFromStage2,
    verbShapeFired: verbShape.fire,
    divergesFromStage2,
    reason: divergesFromStage2 && !verbShape.fire ? 'Stage-2 main predicate does not overlap Stage-1 core.verb' : verbShape.reason,
  }
}
